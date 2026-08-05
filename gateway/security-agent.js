/**
 * Autonomous Security Agent for the APIShield Smart Gateway
 *
 * ## Role in the Architecture
 *
 * The Security Agent is the first line of automated defense in the gateway's
 * autonomous threat-response pipeline. It runs as a background daemon that
 * periodically scans the recent request telemetry stored in Redis, aggregates
 * violations per source IP over a sliding 15-second window, and escalates
 * threats to the Multi-Agent Orchestrator.
 *
 * ## Data Flow (encrypted)
 *
 * ```
 * Gateway telemetry (Redis) ──► Security Agent (scan)
 *        │                             │
 *        │                             ├─► block IP instantly (fail-safe)
 *        │                             └─► encrypt(AES-256-GCM + RSA-OAEP)
 *        │                                     │
 *        └─────────────────────────────────────▼
 *                              telemetry:threat_queue (Redis)
 *                                          │
 *                                          ▼
 *                            Multi-Agent Orchestrator (decrypt)
 * ```
 *
 * Threat events are serialized and encrypted with the shared hybrid AES-RSA
 * scheme ({@link module:gateway/encryption-util}) before being pushed to the
 * Redis threat queue, so payloads are never persisted or read in plaintext by
 * any consumer that lacks the RSA private key.
 *
 * @module gateway/security-agent
 * @requires redis
 * @requires ./encryption-util
 * @requires dotenv
 */

const { createClient } = require('redis');
const { encryptData } = require('./encryption-util');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: REDIS_URL });

/** Polling interval between telemetry scans. */
const SCAN_INTERVAL_MS = 5000;
/** Sliding window used to count violations per IP. */
const VIOLATION_WINDOW_MS = 15000;
/** Maximum number of recent telemetry entries scanned per cycle. */
const TELEMETRY_SCAN_LIMIT = 100;
/** Maximum number of agent decision logs retained. */
const AGENT_LOG_LIMIT = 99;
/** Redis key storing the agent's on/off switch. */
const CONFIG_ACTIVE_KEY = 'config:security_agent_active';

redisClient.on('error', (err) => console.error('Security Agent Redis Client Error', err));
redisClient.on('connect', () => console.log('Security Agent connected to Redis'));

/**
 * Core scan-and-respond cycle.
 *
 * Reads recent gateway telemetry from Redis, aggregates rate-limit (429) and
 * auth-failure (401) violations per source IP over the sliding window, and for
 * every IP that crosses its configured threshold:
 *
 *  1. Encrypts a threat event and pushes it onto `telemetry:threat_queue` for
 *     the Multi-Agent Orchestrator.
 *  2. Immediately blocks the IP (fail-safe) by adding it to `blacklist:ips`.
 *  3. Appends a decision record to `telemetry:agent_logs`.
 *
 * @returns {Promise<void>} Resolves when the scan completes.
 */
async function analyzeAndMitigate() {
  try {
    // 1. Check if agent is enabled
    const activeRaw = await redisClient.get(CONFIG_ACTIVE_KEY);
    if (activeRaw === 'false') {
      return;
    }

    // 2. Fetch config thresholds
    const max429 = parseInt(await redisClient.get('config:max_429_violations') || '5', 10);
    const max401 = parseInt(await redisClient.get('config:max_401_violations') || '5', 10);

    // 3. Fetch recent requests log (capped at TELEMETRY_SCAN_LIMIT)
    const recentLogs = await redisClient.lRange('telemetry:recent_requests', 0, TELEMETRY_SCAN_LIMIT - 1);
    const parsedLogs = recentLogs.map(log => {
      try {
        return JSON.parse(log);
      } catch (err) {
        return null; // Skip malformed entries
      }
    }).filter(Boolean);

    // Get current blacklist to avoid re-blocking
    const blacklist = new Set(await redisClient.sMembers('blacklist:ips'));

    // 4. Calculate violations per IP within the sliding window
    const now = Date.now();
    const ipMetrics = {};

    parsedLogs.forEach(log => {
      const logTime = new Date(log.timestamp).getTime();
      if (Number.isNaN(logTime) || now - logTime > VIOLATION_WINDOW_MS) return; // Skip stale logs
      if (!log.ip || blacklist.has(log.ip)) return; // Skip empty or already blocked IPs

      if (!ipMetrics[log.ip]) {
        ipMetrics[log.ip] = { e429: 0, e401: 0, endpoints: new Set(), keys: new Set() };
      }

      if (log.status === 429) {
        ipMetrics[log.ip].e429 += 1;
      }
      if (log.status === 401) {
        ipMetrics[log.ip].e401 += 1;
      }
      if (log.path) {
        ipMetrics[log.ip].endpoints.add(log.path);
      }
      if (log.keyName) {
        ipMetrics[log.ip].keys.add(log.keyName);
      }
    });

    // 5. Check thresholds and queue threats for the Multi-Agent System
    for (const [ip, metrics] of Object.entries(ipMetrics)) {
      let threatDetected = false;
      let reason = '';
      let violationCount = 0;
      let type = '';

      if (metrics.e429 >= max429) {
        threatDetected = true;
        violationCount = metrics.e429;
        type = 'RATE_LIMIT_ABUSE';
        reason = `IP hit rate limit ${metrics.e429} times in 15s (threshold: ${max429})`;
      } else if (metrics.e401 >= max401) {
        threatDetected = true;
        violationCount = metrics.e401;
        type = 'AUTH_SCAN_SWEEP';
        reason = `IP triggered ${metrics.e401} auth failures in 15s (threshold: ${max401})`;
      }

      if (threatDetected) {
        console.log(`[Autonomous Agent] Threat identified from ${ip}: ${reason}`);

        // Construct raw threat event
        const threatEvent = {
          ip,
          type,
          violationCount,
          reason,
          endpoints: Array.from(metrics.endpoints),
          keys: Array.from(metrics.keys),
          timestamp: new Date().toISOString()
        };

        // Queue the encrypted threat event for the Multi-Agent Orchestrator.
        const encrypted = encryptData(JSON.stringify(threatEvent));
        await redisClient.lPush('telemetry:threat_queue', encrypted);

        // Block IP instantly (fail-safe mitigation)
        await redisClient.sAdd('blacklist:ips', ip);

        // Log autonomous decision
        const agentLog = {
          timestamp: new Date().toISOString(),
          ip,
          action: 'IP_BLOCKED',
          reason,
          severity: 'HIGH'
        };
        await redisClient.lPush('telemetry:agent_logs', JSON.stringify(agentLog));
        await redisClient.lTrim('telemetry:agent_logs', 0, AGENT_LOG_LIMIT);
      }
    }
  } catch (err) {
    console.error('Error in security agent scan loop', err);
  }
}

/**
 * Bootstrap the daemon.
 *
 * Connects to Redis, seeds default configuration values on first run, and
 * schedules {@link analyzeAndMitigate} on a fixed interval.
 *
 * @returns {Promise<void>} Resolves once the daemon is polling.
 */
async function start() {
  await redisClient.connect();

  // Set default config if not initialized
  const active = await redisClient.get(CONFIG_ACTIVE_KEY);
  if (active === null) {
    await redisClient.set(CONFIG_ACTIVE_KEY, 'true');
    await redisClient.set('config:max_429_violations', '5');
    await redisClient.set('config:max_401_violations', '5');
  }

  console.log(`Autonomous Security Agent started, polling logs every ${SCAN_INTERVAL_MS / 1000}s...`);
  setInterval(analyzeAndMitigate, SCAN_INTERVAL_MS);
}

if (require.main === module) {
  start();
}

module.exports = { analyzeAndMitigate, start };
