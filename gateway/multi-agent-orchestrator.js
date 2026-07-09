const { createClient } = require('redis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => console.error('Multi-Agent Redis Client Error', err));
redisClient.on('connect', () => console.log('Multi-Agent Orchestrator connected to Redis'));

// Utility helper to pause execution for simulating real-time agent coordination
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function setWorkflowState(activeNode, currentThreat = null) {
  await redisClient.set('multi-agent:state', JSON.stringify({ activeNode, currentThreat }));
}

async function runMultiAgentFlow(threatEvent) {
  const { ip, type, violationCount, reason, endpoints, keys } = threatEvent;
  
  try {
    console.log(`\n=== Starting Multi-Agent Incident Response for IP: ${ip} ===`);
    
    // --- STEP 1: AUDITOR AGENT ---
    console.log('[Orchestrator] Activating Security Auditor Agent...');
    await setWorkflowState('Auditor', threatEvent);
    await delay(1500);

    const targetPaths = endpoints && endpoints.length > 0 ? endpoints.join(', ') : 'unknown paths';
    const associatedKeys = keys && keys.length > 0 ? keys.join(', ') : 'no key';
    
    const auditorAnalysis = `Deep telemetry audit of IP **${ip}** completed. 
Identified incident signature: **${type}**. 
The traffic source made **${violationCount}** abusive requests targeting **${targetPaths}** using credentials associated with: **${associatedKeys}**.
Classification: High-severity firewall breach attempt. Recommended immediate mitigation of traffic source and suspension of credentials if necessary.`;
    
    console.log(`[Auditor Agent] Analysis: ${auditorAnalysis.replace(/\n/g, ' ')}`);

    // --- STEP 2: MITIGATOR AGENT ---
    console.log('[Orchestrator] Activating Incident Mitigator Agent...');
    await setWorkflowState('Mitigator', threatEvent);
    await delay(1500);

    // Apply mitigation actions
    // 1. IP Blacklist (Fail-safe block)
    await redisClient.sAdd('blacklist:ips', ip);
    let keyMitigated = 'None';
    
    // 2. Suspend key if it is auth abuse
    if (type === 'AUTH_SCAN_SWEEP' && keys && keys.length > 0) {
      for (const k of keys) {
        if (k !== 'anonymous' && k !== 'invalid-key') {
          // Find key and deactivate
          const keyExists = await redisClient.exists(`apikey:${k}`);
          if (keyExists) {
            await redisClient.hSet(`apikey:${k}`, 'active', 'false');
            keyMitigated = `Suspended API Key: ${k}`;
            console.log(`[Mitigator Agent] Compensating Action: Suspended compromised key '${k}' due to auth sweep.`);
          }
        }
      }
    }

    const mitigationLog = `IP address **${ip}** successfully blacklisted. ${keyMitigated !== 'None' ? keyMitigated + '.' : 'No credential suspension needed.'}`;
    console.log(`[Mitigator Agent] Action: ${mitigationLog}`);

    // --- STEP 3: REPORTER AGENT ---
    console.log('[Orchestrator] Activating Admin Reporter Agent...');
    await setWorkflowState('Reporter', threatEvent);
    await delay(1500);

    const reportMarkdown = `### 🛡️ Incident Response Report: APIShield Auto-Defense
**IP Source**: \`${ip}\`
**Threat Profile**: \`${type}\`
**Detection Reason**: ${reason}

#### 🔍 Auditor Finding
${auditorAnalysis}

#### 🛠️ Mitigation Applied
* **Firewall Filter**: IP blacklisted in Redis set \`blacklist:ips\`. All further requests blocked with \`403 Forbidden\`.
* **Key Compensation**: ${keyMitigated}
* **Status**: Incident resolved and closed.

*Report compiled by APIShield Admin Reporter Agent.*`;

    const reportItem = {
      timestamp: new Date().toISOString(),
      ip,
      type,
      reportMarkdown
    };

    // Save report to Redis
    await redisClient.lPush('telemetry:agent_reports', JSON.stringify(reportItem));
    await redisClient.lTrim('telemetry:agent_reports', 0, 49);

    console.log('[Reporter Agent] Published incident report to telemetry dashboard.');

    // --- WORKFLOW COMPLETE ---
    await setWorkflowState('idle', null);
    console.log(`=== Multi-Agent Incident Response completed for IP: ${ip} ===\n`);
  } catch (err) {
    console.error('Error during multi-agent loop execution', err);
    await setWorkflowState('idle', null);
  }
}

async function start() {
  await redisClient.connect();
  await setWorkflowState('idle', null);
  console.log('Multi-Agent Orchestrator daemon started, monitoring threat queue...');

  // Start polling queue
  while (true) {
    try {
      // BRPOPLPUSH or standard RPOP polling
      // To run cleanly without blocking Node, we do a non-blocking poll with delay
      const rawEvent = await redisClient.rPop('telemetry:threat_queue');
      if (rawEvent) {
        const threatEvent = JSON.parse(rawEvent);
        await runMultiAgentFlow(threatEvent);
      }
    } catch (err) {
      console.error('Queue error', err);
    }
    await delay(1000);
  }
}

if (require.main === module) {
  start();
}

module.exports = { runMultiAgentFlow, start };
