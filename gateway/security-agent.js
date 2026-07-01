const { createClient } = require('redis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => console.error('Security Agent Redis Client Error', err));
redisClient.on('connect', () => console.log('Security Agent connected to Redis'));

async function analyzeAndMitigate() {
  try {
    // 1. Check if agent is enabled
    const activeRaw = await redisClient.get('config:security_agent_active');
    if (activeRaw === 'false') {
      return;
    }

    // 2. Fetch config thresholds
    const max429 = parseInt(await redisClient.get('config:max_429_violations') || '5', 10);
    const max401 = parseInt(await redisClient.get('config:max_401_violations') || '5', 10);

    // 3. Fetch recent requests log (capped at 100)
    const recentLogs = await redisClient.lRange('telemetry:recent_requests', 0, 99);
    const parsedLogs = recentLogs.map(log => JSON.parse(log));

    // Get current blacklist to avoid re-blocking
    const blacklist = new Set(await redisClient.sMembers('blacklist:ips'));

    // 4. Calculate violations per IP in the last 15 seconds
    const now = Date.now();
    const WINDOW_MS = 15000;
    const ipMetrics = {};

    parsedLogs.forEach(log => {
      const logTime = new Date(log.timestamp).getTime();
      if (now - logTime > WINDOW_MS) return; // Skip older logs
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

        // Queue threat event for Multi-Agent Orchestrator
        await redisClient.lPush('telemetry:threat_queue', JSON.stringify(threatEvent));

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
        await redisClient.lTrim('telemetry:agent_logs', 0, 99);
      }
    }
  } catch (err) {
    console.error('Error in security agent scan loop', err);
  }
}

async function start() {
  await redisClient.connect();
  
  // Set default config if not initialized
  const active = await redisClient.get('config:security_agent_active');
  if (active === null) {
    await redisClient.set('config:security_agent_active', 'true');
    await redisClient.set('config:max_429_violations', '5');
    await redisClient.set('config:max_401_violations', '5');
  }

  console.log('Autonomous Security Agent started, polling logs every 5s...');
  setInterval(analyzeAndMitigate, 5000);
}

if (require.main === module) {
  start();
}

module.exports = { analyzeAndMitigate, start };
