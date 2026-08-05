/**
 * Multi-Agent Orchestrator for the APIShield Smart Gateway
 *
 * ## Role in the Architecture
 *
 * The Multi-Agent Orchestrator is the coordination brain of the gateway's
 * autonomous incident-response pipeline. It consumes encrypted threat events
 * produced by the {@link module:gateway/security-agent} from the Redis
 * `telemetry:threat_queue` and drives a three-stage agent workflow:
 *
 * ```
 *                    ┌────────────────────────────────────────────┐
 *   threat_queue ──► │  Multi-Agent Orchestrator (this module)    │
 *   (decrypt)        │                                            │
 *                    │  ┌──────────┐   ┌──────────┐   ┌─────────┐ │
 *                    │  │ Auditor  │──►│ Mitigator│──►│Reporter │ │
 *                    │  └──────────┘   └──────────┘   └─────────┘ │
 *                    └────────────────────────────────────────────┘
 *                              │            │            │
 *                        telemetry     blacklist &   incident
 *                        analysis      key suspend   reports
 *                                       (Redis)
 * ```
 *
 * ## Design Decisions
 *
 *  - **State machine**: Each stage is a discrete workflow state persisted to
 *    Redis (`multi-agent:state`) with a TTL so stale state self-heals if the
 *    process dies mid-flow. The developer console visualizes the active stage.
 *  - **Task distribution**: Each agent is an isolated async stage function with
 *    a single responsibility. Stage failures are contained and the orchestrator
 *    guarantees a terminal `idle` state even on error.
 *  - **Fallback protocols**: The threat queue is polled non-blockingly with
 *    exponential backoff on Redis outages; malformed/undecryptable messages are
 *    dropped (logged) instead of blocking the queue forever; a graceful shutdown
 *    drains on SIGINT/SIGTERM.
 *  - **Payload security**: Threat events are decrypted with the shared hybrid
 *    AES-RSA scheme ({@link module:gateway/encryption-util}).
 *
 * @module gateway/multi-agent-orchestrator
 * @requires redis
 * @requires crypto
 * @requires ./encryption-util
 * @requires dotenv
 */

const { createClient } = require('redis');
const crypto = require('crypto');
const { decryptData } = require('./encryption-util');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: REDIS_URL });

/** Finite set of workflow states persisted for the developer console. */
const WORKFLOW_STATES = Object.freeze({
  IDLE: 'idle',
  AUDITOR: 'Auditor',
  MITIGATOR: 'Mitigator',
  REPORTER: 'Reporter'
});

/** TTL (seconds) for the persisted workflow state — self-heals stale state. */
const STATE_TTL_SECONDS = 60;
/** Base delay between queue polls (ms). */
const POLL_INTERVAL_MS = 1000;
/** Upper bound on backoff after consecutive queue errors (ms). */
const MAX_POLL_BACKOFF_MS = 10000;
/** Simulated agent coordination latency per stage (ms). */
const AGENT_STAGE_DELAY_MS = 1500;
/** Maximum number of incident reports retained in Redis. */
const AGENT_REPORT_LIMIT = 49;

/** Namespace used for the threat work queue. */
const THREAT_QUEUE_KEY = 'telemetry:threat_queue';

/** Whether the daemon is still accepting work (false during shutdown). */
let running = true;

redisClient.on('error', (err) => console.error('Multi-Agent Redis Client Error', err));
redisClient.on('connect', () => console.log('Multi-Agent Orchestrator connected to Redis'));

/**
 * Utility helper to pause execution, simulating real-time agent coordination.
 *
 * @param {number} ms - Number of milliseconds to wait.
 * @returns {Promise<void>} Resolves after the delay.
 * @private
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Derive a short, stable identifier for a threat event.
 *
 * @param {{ip: string, type: string, violationCount?: number, timestamp?: string}} threatEvent - The threat event.
 * @returns {string} An 8-character hex digest.
 * @private
 */
function buildThreatId(threatEvent) {
  const { ip, type, violationCount = 0, timestamp = '' } = threatEvent;
  const digest = crypto
    .createHash('sha256')
    .update(`${ip}:${type}:${violationCount}:${timestamp}`)
    .digest('hex');
  return digest.slice(0, 8);
}

/**
 * Persist the current workflow stage to Redis with an expiry.
 *
 * The stored object is a lightweight projection (no full payload) so the
 * developer console can render progress without exposing raw threat data.
 *
 * @param {string} stage - One of {@link WORKFLOW_STATES}.
 * @param {object|null} [threatEvent] - The threat being processed (projected).
 * @returns {Promise<void>} Resolves once state is written.
 */
async function setWorkflowState(stage, threatEvent = null) {
  const state = {
    activeNode: stage,
    currentThreat: threatEvent
      ? { ip: threatEvent.ip, type: threatEvent.type, violationCount: threatEvent.violationCount, timestamp: threatEvent.timestamp }
      : null,
    updatedAt: new Date().toISOString()
  };
  await redisClient.set('multi-agent:state', JSON.stringify(state), { EX: STATE_TTL_SECONDS });
}

/**
 * STAGE 1 — Security Auditor Agent.
 *
 * Analyzes a threat event against the aggregated telemetry and produces a
 * human-readable incident analysis for the final report.
 *
 * @param {object} threatEvent - The decrypted threat event.
 * @returns {Promise<{analysis: string}>} The auditor's findings.
 * @private
 */
async function runAuditorStage(threatEvent) {
  await delay(AGENT_STAGE_DELAY_MS);
  const { ip, type, violationCount, endpoints, keys } = threatEvent;
  const targetPaths = endpoints && endpoints.length > 0 ? endpoints.join(', ') : 'unknown paths';
  const associatedKeys = keys && keys.length > 0 ? keys.join(', ') : 'no key';

  const analysis = `Deep telemetry audit of IP **${ip}** completed.
Identified incident signature: **${type}**.
The traffic source made **${violationCount}** abusive requests targeting **${targetPaths}** using credentials associated with: **${associatedKeys}**.
Classification: High-severity firewall breach attempt. Recommended immediate mitigation of traffic source and suspension of credentials if necessary.`;

  console.log(`[Auditor Agent] Analysis: ${analysis.replace(/\n/g, ' ')}`);
  return { analysis };
}

/**
 * STAGE 2 — Incident Mitigator Agent.
 *
 * Applies compensating controls: blocks the offending IP in the firewall
 * blacklist (fail-safe) and suspends any compromised API keys detected during
 * an authentication-scan event. Suspensions are batched in a single Redis
 * pipeline for atomicity and fewer round trips.
 *
 * @param {object} threatEvent - The decrypted threat event.
 * @returns {Promise<{mitigationLog: string, suspendedKeys: string[]}>} The mitigation outcome.
 * @private
 */
async function runMitigatorStage(threatEvent) {
  await delay(AGENT_STAGE_DELAY_MS);
  const { ip, type, keys } = threatEvent;
  const suspendedKeys = [];

  // 1. IP blacklist (fail-safe block)
  await redisClient.sAdd('blacklist:ips', ip);

  // 2. Suspend compromised keys on auth-scan threats.
  if (type === 'AUTH_SCAN_SWEEP' && Array.isArray(keys) && keys.length > 0) {
    const pipeline = redisClient.multi();
    for (const k of keys) {
      if (k === 'anonymous' || k === 'invalid-key') continue;
      const keyExists = await redisClient.exists(`apikey:${k}`);
      if (keyExists) {
        pipeline.hSet(`apikey:${k}`, 'active', 'false');
        suspendedKeys.push(k);
        console.log(`[Mitigator Agent] Compensating Action: Suspended compromised key '${k}' due to auth sweep.`);
      }
    }
    await pipeline.exec();
  }

  const mitigationLog = `IP address **${ip}** successfully blacklisted.` +
    (suspendedKeys.length
      ? ` Suspended credential(s): ${suspendedKeys.join(', ')}.`
      : ' No credential suspension needed.');

  console.log(`[Mitigator Agent] Action: ${mitigationLog}`);
  return { mitigationLog, suspendedKeys };
}

/**
 * STAGE 3 — Admin Reporter Agent.
 *
 * Compiles the auditor findings and mitigation outcome into a markdown incident
 * report and publishes it to the telemetry feed for the dashboard.
 *
 * @param {object} threatEvent - The decrypted threat event.
 * @param {{analysis: string}} audit - Output of {@link runAuditorStage}.
 * @param {{mitigationLog: string, suspendedKeys: string[]}} mitigation - Output of {@link runMitigatorStage}.
 * @returns {Promise<void>} Resolves once the report is published.
 * @private
 */
async function runReporterStage(threatEvent, audit, mitigation) {
  await delay(AGENT_STAGE_DELAY_MS);
  const { ip, type, reason } = threatEvent;

  const reportMarkdown = `### 🛡️ Incident Response Report: APIShield Auto-Defense
**IP Source**: \`${ip}\`
**Threat Profile**: \`${type}\`
**Detection Reason**: ${reason}

#### 🔍 Auditor Finding
${audit.analysis}

#### 🛠️ Mitigation Applied
* **Firewall Filter**: IP blacklisted in Redis set \`blacklist:ips\`. All further requests blocked with \`403 Forbidden\`.
* **Key Compensation**: ${mitigation.suspendedKeys.length ? mitigation.suspendedKeys.join(', ') : 'None'}
* **Status**: Incident resolved and closed.

*Report compiled by APIShield Admin Reporter Agent.*`;

  const reportItem = {
    timestamp: new Date().toISOString(),
    ip,
    type,
    reportMarkdown
  };

  await redisClient.lPush('telemetry:agent_reports', JSON.stringify(reportItem));
  await redisClient.lTrim('telemetry:agent_reports', 0, AGENT_REPORT_LIMIT);
  console.log('[Reporter Agent] Published incident report to telemetry dashboard.');
}

/**
 * Orchestrate the full three-stage incident response for a single threat.
 *
 * Advances the persisted workflow state through Auditor → Mitigator → Reporter
 * and guarantees a terminal `idle` state on both success and failure.
 *
 * @param {object} threatEvent - The decrypted threat event.
 * @returns {Promise<void>} Resolves when the flow terminates.
 */
async function runMultiAgentFlow(threatEvent) {
  const { ip } = threatEvent;
  const threatId = buildThreatId(threatEvent);

  console.log(`\n=== Starting Multi-Agent Incident Response [${threatId}] for IP: ${ip} ===`);

  try {
    // --- STAGE 1: AUDITOR AGENT ---
    console.log('[Orchestrator] Activating Security Auditor Agent...');
    await setWorkflowState(WORKFLOW_STATES.AUDITOR, threatEvent);
    const audit = await runAuditorStage(threatEvent);

    // --- STAGE 2: MITIGATOR AGENT ---
    console.log('[Orchestrator] Activating Incident Mitigator Agent...');
    await setWorkflowState(WORKFLOW_STATES.MITIGATOR, threatEvent);
    const mitigation = await runMitigatorStage(threatEvent);

    // --- STAGE 3: REPORTER AGENT ---
    console.log('[Orchestrator] Activating Admin Reporter Agent...');
    await setWorkflowState(WORKFLOW_STATES.REPORTER, threatEvent);
    await runReporterStage(threatEvent, audit, mitigation);

    // --- WORKFLOW COMPLETE ---
    await setWorkflowState(WORKFLOW_STATES.IDLE, null);
    console.log(`=== Multi-Agent Incident Response completed for IP: ${ip} [${threatId}] ===\n`);
  } catch (err) {
    console.error(`Error during multi-agent loop execution [${threatId}]`, err);
    // Fallback: always settle to a known idle state so the console is not stuck.
    await setWorkflowState(WORKFLOW_STATES.IDLE, null).catch(() => {});
  }
}

/**
 * Poll the encrypted threat queue and dispatch each event to the workflow.
 *
 * Uses a non-blocking poll so the Node process stays responsive. Consecutive
 * Redis failures trigger exponential backoff (capped), and malformed or
 * undecryptable messages are dropped with a log line rather than stalling the
 * queue.
 *
 * @returns {Promise<void>} Runs until {@link running} flips false.
 * @private
 */
async function processThreatQueue() {
  let consecutiveErrors = 0;

  while (running) {
    try {
      const rawEvent = await redisClient.rPop(THREAT_QUEUE_KEY);

      if (!rawEvent) {
        consecutiveErrors = 0;
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      let threatEvent;
      try {
        const decrypted = decryptData(rawEvent);
        threatEvent = JSON.parse(decrypted);
      } catch (parseErr) {
        // Poison message: log and drop rather than blocking the queue forever.
        console.error('[Orchestrator] Dropping malformed threat event:', parseErr.message);
        continue;
      }

      await runMultiAgentFlow(threatEvent);
      consecutiveErrors = 0;
      await delay(POLL_INTERVAL_MS);
    } catch (err) {
      consecutiveErrors += 1;
      const backoff = Math.min(POLL_INTERVAL_MS * consecutiveErrors, MAX_POLL_BACKOFF_MS);
      console.error(`[Orchestrator] Queue error (attempt ${consecutiveErrors}), retrying in ${backoff}ms:`, err.message);
      await delay(backoff);
    }
  }

  console.log('[Orchestrator] Poll loop stopped.');
}

/**
 * Bootstrap the daemon.
 *
 * Connects to Redis, initializes the workflow state to `idle`, and starts
 * consuming the encrypted threat queue.
 *
 * @returns {Promise<void>} Resolves once the daemon has begun polling.
 */
async function start() {
  await redisClient.connect();
  await setWorkflowState(WORKFLOW_STATES.IDLE, null);
  console.log('Multi-Agent Orchestrator daemon started, monitoring threat queue...');
  await processThreatQueue();
}

/**
 * Gracefully stop the daemon on process signals.
 *
 * @param {string} signal - The OS signal received (e.g. 'SIGINT', 'SIGTERM').
 * @private
 */
function shutdown(signal) {
  console.log(`\n[Orchestrator] Received ${signal}, shutting down gracefully...`);
  running = false;
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  start();
}

module.exports = { runMultiAgentFlow, start, WORKFLOW_STATES };
