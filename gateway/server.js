const express = require('express');
const cors = require('cors');
const { createClient } = require('redis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Enable JSON parser and CORS
app.use(express.json());
app.use(cors());

// Initialize Redis Client
const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Successfully connected to Redis'));

// Core Lua script for atomic token-bucket rate limiting
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2]) -- tokens per millisecond
local now = tonumber(ARGV[3]) -- current time in ms
local requested = 1

local bucket = redis.call('hgetall', key)
local tokens = capacity
local last_updated = now

if #bucket > 0 then
    local data = {}
    for i = 1, #bucket, 2 do
        data[bucket[i]] = bucket[i+1]
    end
    tokens = tonumber(data['tokens'])
    last_updated = tonumber(data['last_updated'])
    
    local elapsed = now - last_updated
    local replenished = elapsed * refill_rate
    tokens = math.min(capacity, tokens + replenished)
end

if tokens >= requested then
    tokens = tokens - requested
    redis.call('hset', key, 'tokens', tokens, 'last_updated', now)
    redis.call('expire', key, 86400) -- Expire after 1 day of inactivity
    return {1, tokens} -- {allowed (true), remaining}
else
    return {0, tokens} -- {blocked (false), remaining}
end
`;

// Helper: Seed default API key in Redis if none exists (for easy local testing)
async function seedDefaultKey() {
  try {
    const defaultKey = 'demo-key-123';
    const keyExists = await redisClient.exists(`apikey:${defaultKey}`);
    if (!keyExists) {
      await redisClient.hSet(`apikey:${defaultKey}`, {
        name: 'Demo Developer',
        limit: '60', // 60 requests per minute
        active: 'true',
        createdAt: new Date().toISOString()
      });
      console.log(`Seeded default API Key: ${defaultKey} (60 req/min)`);
    }
  } catch (err) {
    console.error('Failed to seed default API Key', err);
  }
}

// Telemetry log helper
async function logRequestTelemetry(ip, path, status, keyName = 'anonymous') {
  try {
    const timestamp = new Date().toISOString();
    const logItem = JSON.stringify({ ip, path, status, keyName, timestamp });
    
    // Push to a capped list for dashboard view
    await redisClient.lPush('telemetry:recent_requests', logItem);
    await redisClient.lTrim('telemetry:recent_requests', 0, 99);
    
    // Increment general counters
    await redisClient.incr('telemetry:total_requests');
    await redisClient.incr(`telemetry:endpoint:${path}`);
    if (status === 401) await redisClient.incr('telemetry:unauthorized_requests');
    if (status === 429) await redisClient.incr('telemetry:rate_limited_requests');
  } catch (err) {
    console.error('Telemetry logging error', err);
  }
}

// Middleware: IP Blacklist Check
async function ipBlacklistMiddleware(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  try {
    const isBlocked = await redisClient.sIsMember('blacklist:ips', ip);
    if (isBlocked) {
      await logRequestTelemetry(ip, req.path, 403, 'BLOCKED_IP');
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Your IP address has been blacklisted due to suspicious activity.'
      });
    }
    next();
  } catch (err) {
    console.error('IP Blacklist Middleware Error', err);
    next();
  }
}

// Middleware: API Key Authentication & Rate Limiting
async function apiSecurityMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!apiKey) {
    await logRequestTelemetry(ip, req.path, 401, 'unauthenticated');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API Key missing. Please provide the key in the x-api-key header.'
    });
  }

  try {
    // 1. Validate API Key
    const keyData = await redisClient.hGetAll(`apikey:${apiKey}`);
    if (!keyData || Object.keys(keyData).length === 0 || keyData.active !== 'true') {
      await logRequestTelemetry(ip, req.path, 401, 'invalid-key');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or inactive API Key.'
      });
    }

    // 2. Perform Rate Limiting
    const limitPerMinute = parseInt(keyData.limit, 10) || 60;
    const capacity = limitPerMinute;
    const refillRate = limitPerMinute / (60 * 1000); // tokens per millisecond
    const now = Date.now();
    const rateLimitKey = `rate:limit:${apiKey}`;

    // Execute Lua script atomically
    const result = await redisClient.eval(RATE_LIMIT_LUA, {
      keys: [rateLimitKey],
      arguments: [capacity.toString(), refillRate.toString(), now.toString()]
    });

    const allowed = result[0] === 1;
    const remainingTokens = Math.max(0, Math.floor(result[1]));

    // Set standard headers
    res.setHeader('X-RateLimit-Limit', limitPerMinute);
    res.setHeader('X-RateLimit-Remaining', remainingTokens);

    if (!allowed) {
      await logRequestTelemetry(ip, req.path, 429, keyData.name);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Your limit is ${limitPerMinute} requests per minute.`
      });
    }

    // Pass developer name to downstream context
    req.developerName = keyData.name;
    req.apiKey = apiKey;
    next();
  } catch (err) {
    console.error('Auth & Rate Limiting Middleware Error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'APIShield API Gateway is active and secure.' });
});

// --- MOCK DOWNSTREAM SERVICES HANDLERS ---
function handleDownstreamResource(req, res) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  logRequestTelemetry(ip, '/api/v1/resource', 200, req.developerName);
  res.json({
    status: 'success',
    timestamp: new Date().toISOString(),
    developer: req.developerName,
    data: {
      message: 'Hello! Your request successfully traversed the Shield API Gateway.',
      payload: 'Secure data payload received.',
      endpoints: ['/api/v1/resource', '/api/v1/info']
    }
  });
}

function handleDownstreamInfo(req, res) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  logRequestTelemetry(ip, '/api/v1/info', 200, req.developerName);
  res.json({
    status: 'success',
    timestamp: new Date().toISOString(),
    developer: req.developerName,
    system: {
      gatewayName: 'API Shield Gateway',
      version: '1.0.0',
      uptime: process.uptime()
    }
  });
}

// Downstream routes
app.get('/downstream/resource', handleDownstreamResource);
app.get('/downstream/info', handleDownstreamInfo);

// --- GATEWAY ROUTES ---
// Apply IP Blacklist & API Security Middleware directly to gateway endpoints
app.get('/api/v1/resource', ipBlacklistMiddleware, apiSecurityMiddleware, handleDownstreamResource);
app.get('/api/v1/info', ipBlacklistMiddleware, apiSecurityMiddleware, handleDownstreamInfo);

// --- ADMIN & TELEMETRY ROUTES (For visual dashboard) ---
app.get('/admin/metrics', async (req, res) => {
  try {
    const totalRequests = await redisClient.get('telemetry:total_requests') || 0;
    const rateLimited = await redisClient.get('telemetry:rate_limited_requests') || 0;
    const unauthorized = await redisClient.get('telemetry:unauthorized_requests') || 0;
    
    // Fetch recent logs
    const recentLogs = await redisClient.lRange('telemetry:recent_requests', 0, 49);
    const parsedLogs = recentLogs.map(log => JSON.parse(log));
    
    // Fetch blacklist
    const blacklist = await redisClient.sMembers('blacklist:ips');

    res.json({
      metrics: {
        totalRequests: parseInt(totalRequests, 10),
        rateLimited: parseInt(rateLimited, 10),
        unauthorized: parseInt(unauthorized, 10)
      },
      recentLogs: parsedLogs,
      blacklist
    });
  } catch (err) {
    console.error('Error fetching admin metrics', err);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// Seed an API Key manually (Internal route or for testing)
app.post('/admin/keys', async (req, res) => {
  const { name, limit, apiKey } = req.body;
  if (!name || !limit || !apiKey) {
    return res.status(400).json({ error: 'Missing name, limit or apiKey' });
  }
  try {
    await redisClient.hSet(`apikey:${apiKey}`, {
      name,
      limit: limit.toString(),
      active: 'true',
      createdAt: new Date().toISOString()
    });
    res.status(201).json({ message: 'API Key created successfully', apiKey });
  } catch (err) {
    console.error('Error creating API Key', err);
    res.status(500).json({ error: 'Failed to create API Key' });
  }
});

// Admin endpoint to configure IP blacklisting
app.post('/admin/blacklist', async (req, res) => {
  const { ip, block } = req.body;
  if (!ip) return res.status(400).json({ error: 'Missing IP address' });
  try {
    if (block) {
      await redisClient.sAdd('blacklist:ips', ip);
      res.json({ message: `IP ${ip} blacklisted successfully.` });
    } else {
      await redisClient.sRem('blacklist:ips', ip);
      res.json({ message: `IP ${ip} removed from blacklist.` });
    }
  } catch (err) {
    console.error('Error managing blacklist', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// GET /admin/keys/all - Return all API keys registered in Redis
app.get('/admin/keys/all', async (req, res) => {
  try {
    const keys = await redisClient.keys('apikey:*');
    const keysList = [];
    for (const key of keys) {
      const keyData = await redisClient.hGetAll(key);
      keysList.push({
        apiKey: key.replace('apikey:', ''),
        name: keyData.name,
        limit: parseInt(keyData.limit, 10),
        active: keyData.active === 'true',
        createdAt: keyData.createdAt
      });
    }
    res.json({ keys: keysList });
  } catch (err) {
    console.error('Error fetching all API keys', err);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// POST /admin/keys/status - Enable/disable a developer API key
app.post('/admin/keys/status', async (req, res) => {
  const { apiKey, active } = req.body;
  if (!apiKey || active === undefined) {
    return res.status(400).json({ error: 'Missing apiKey or active status' });
  }
  try {
    const keyExists = await redisClient.exists(`apikey:${apiKey}`);
    if (!keyExists) {
      return res.status(404).json({ error: 'API key not found' });
    }
    await redisClient.hSet(`apikey:${apiKey}`, 'active', active ? 'true' : 'false');
    res.json({ message: `API Key '${apiKey}' active status set to ${active}.` });
  } catch (err) {
    console.error('Error updating API key status', err);
    res.status(500).json({ error: 'Failed to update API key status' });
  }
});

// GET /admin/agent/logs - Return background security agent telemetry logs & config
app.get('/admin/agent/logs', async (req, res) => {
  try {
    const logs = await redisClient.lRange('telemetry:agent_logs', 0, 49);
    const parsedLogs = logs.map(log => JSON.parse(log));
    
    const reports = await redisClient.lRange('telemetry:agent_reports', 0, 49);
    const parsedReports = reports.map(rep => JSON.parse(rep));
    
    const isAgentActive = await redisClient.get('config:security_agent_active') !== 'false';
    const max429Violations = parseInt(await redisClient.get('config:max_429_violations') || '5', 10);
    const max401Violations = parseInt(await redisClient.get('config:max_401_violations') || '5', 10);
    
    // Fetch multi-agent state
    const agentStateRaw = await redisClient.get('multi-agent:state');
    const agentState = agentStateRaw ? JSON.parse(agentStateRaw) : { activeNode: 'idle', currentThreat: null };
    
    res.json({
      logs: parsedLogs,
      reports: parsedReports,
      config: {
        active: isAgentActive,
        max429Violations,
        max401Violations
      },
      agentState
    });
  } catch (err) {
    console.error('Error fetching agent logs', err);
    res.status(500).json({ error: 'Failed to fetch agent logs' });
  }
});

// POST /admin/agent/config - Update background agent configuration parameters
app.post('/admin/agent/config', async (req, res) => {
  const { active, max429Violations, max401Violations } = req.body;
  try {
    if (active !== undefined) {
      await redisClient.set('config:security_agent_active', active ? 'true' : 'false');
    }
    if (max429Violations !== undefined) {
      await redisClient.set('config:max_429_violations', max429Violations.toString());
    }
    if (max401Violations !== undefined) {
      await redisClient.set('config:max_401_violations', max401Violations.toString());
    }
    res.json({ message: 'Agent configuration updated successfully' });
  } catch (err) {
    console.error('Error updating agent config', err);
    res.status(500).json({ error: 'Failed to update agent config' });
  }
});

// POST /admin/chat - AI gateway DevOps co-pilot interface
app.post('/admin/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const totalRequests = await redisClient.get('telemetry:total_requests') || 0;
      const rateLimited = await redisClient.get('telemetry:rate_limited_requests') || 0;
      const unauthorized = await redisClient.get('telemetry:unauthorized_requests') || 0;
      const blacklist = await redisClient.sMembers('blacklist:ips');
      const keys = await redisClient.keys('apikey:*');
      const keysList = [];
      for (const key of keys) {
        const keyData = await redisClient.hGetAll(key);
        keysList.push({
          apiKey: key.replace('apikey:', ''),
          name: keyData.name,
          limit: parseInt(keyData.limit, 10),
          active: keyData.active === 'true'
        });
      }
      
      const contextPrompt = `You are APIShield Admin AI. You assist with managing the API Gateway.
Here is the current system state:
- Total Requests: ${totalRequests}
- Rate-Limited Hits (429): ${rateLimited}
- Unauthorized Hits (401): ${unauthorized}
- Blacklisted IPs: ${JSON.stringify(blacklist)}
- Active API Keys: ${JSON.stringify(keysList)}

You have permission to perform actions by outputting special commands in your response. 
If the user asks to block an IP, output exactly: COMMAND:BLOCK:<ip>
If the user asks to unblock an IP, output exactly: COMMAND:UNBLOCK:<ip>
If the user asks to set/update a key quota limit, output exactly: COMMAND:SETLIMIT:<key>:<limit>
If the user asks to activate/deactivate a key, output exactly: COMMAND:SETKEYSTATUS:<key>:<active_true_or_false>

For example, if the user says "Block IP 192.168.1.10", respond with your explanation and append "COMMAND:BLOCK:192.168.1.10" at the very end of your response.
Keep your response concise and professional. Use markdown formatting.`;

      const result = await model.generateContent([
        { text: contextPrompt },
        { text: `User message: ${message}` }
      ]);
      
      let reply = result.response.text();
      let commandExecuted = null;
      
      if (reply.includes('COMMAND:BLOCK:')) {
        const match = reply.match(/COMMAND:BLOCK:([^\s\n\r]+)/);
        if (match && match[1]) {
          const ip = match[1];
          await redisClient.sAdd('blacklist:ips', ip);
          commandExecuted = `Blacklisted IP: ${ip}`;
          reply = reply.replace(/COMMAND:BLOCK:[^\s\n\r]+/, `\n*(Executed: Blocked IP ${ip})*`);
        }
      } else if (reply.includes('COMMAND:UNBLOCK:')) {
        const match = reply.match(/COMMAND:UNBLOCK:([^\s\n\r]+)/);
        if (match && match[1]) {
          const ip = match[1];
          await redisClient.sRem('blacklist:ips', ip);
          commandExecuted = `Restored access for IP: ${ip}`;
          reply = reply.replace(/COMMAND:UNBLOCK:[^\s\n\r]+/, `\n*(Executed: Unblocked IP ${ip})*`);
        }
      } else if (reply.includes('COMMAND:SETLIMIT:')) {
        const match = reply.match(/COMMAND:SETLIMIT:([^\s\n\r:]+):(\d+)/);
        if (match && match[1] && match[2]) {
          const key = match[1];
          const limit = match[2];
          const exists = await redisClient.exists(`apikey:${key}`);
          if (exists) {
            await redisClient.hSet(`apikey:${key}`, 'limit', limit);
            commandExecuted = `Updated quota limit for ${key} to ${limit}`;
            reply = reply.replace(/COMMAND:SETLIMIT:[^\s\n\r]+/, `\n*(Executed: Set rate limit of ${key} to ${limit} req/min)*`);
          } else {
            reply += `\n*(Failed: Key ${key} does not exist)*`;
          }
        }
      } else if (reply.includes('COMMAND:SETKEYSTATUS:')) {
        const match = reply.match(/COMMAND:SETKEYSTATUS:([^\s\n\r:]+):([^\s\n\r:]+)/);
        if (match && match[1] && match[2]) {
          const key = match[1];
          const status = match[2] === 'true';
          const exists = await redisClient.exists(`apikey:${key}`);
          if (exists) {
            await redisClient.hSet(`apikey:${key}`, 'active', status ? 'true' : 'false');
            commandExecuted = `Set status of key ${key} to ${status}`;
            reply = reply.replace(/COMMAND:SETKEYSTATUS:[^\s\n\r]+/, `\n*(Executed: Key ${key} is now ${status ? 'Active' : 'Inactive'})*`);
          } else {
            reply += `\n*(Failed: Key ${key} does not exist)*`;
          }
        }
      }
      
      return res.json({ reply, mode: 'ai', commandExecuted });
    } catch (err) {
      console.error('Error invoking Gemini API, falling back to NLP pattern matching', err);
    }
  }
  
  // Fallback deterministic NLP Router
  const normalizedMsg = message.toLowerCase();
  let reply = '';
  let commandExecuted = null;
  
  if (normalizedMsg.includes('block') || normalizedMsg.includes('blacklist')) {
    const ipMatch = message.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) {
      const ip = ipMatch[0];
      await redisClient.sAdd('blacklist:ips', ip);
      commandExecuted = `Blacklisted IP: ${ip}`;
      reply = `### 🛡️ Firewall Block Executed\nI have added **${ip}** to the gateway IP blacklist. All incoming traffic from this source will be blocked with a \`403 Forbidden\` status.`;
    } else {
      reply = `Please specify a valid IP address to block. Example: *"Block IP 192.168.1.100"*`;
    }
  } else if (normalizedMsg.includes('unblock') || normalizedMsg.includes('allow') || normalizedMsg.includes('restore')) {
    const ipMatch = message.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) {
      const ip = ipMatch[0];
      await redisClient.sRem('blacklist:ips', ip);
      commandExecuted = `Restored access for IP: ${ip}`;
      reply = `### ✅ Access Restored\nI have removed **${ip}** from the blacklist. Incoming requests from this IP address are now allowed.`;
    } else {
      reply = `Please specify a valid IP address to unblock. Example: *"Unblock IP 192.168.1.100"*`;
    }
  } else if (normalizedMsg.includes('quota') || normalizedMsg.includes('limit') || normalizedMsg.includes('set limit')) {
    const limitMatch = message.match(/\b\d+\b/);
    const keys = await redisClient.keys('apikey:*');
    let matchedKey = null;
    for (const key of keys) {
      const rawKey = key.replace('apikey:', '');
      if (message.includes(rawKey)) {
        matchedKey = rawKey;
        break;
      }
    }
    
    if (matchedKey && limitMatch) {
      const limit = limitMatch[0];
      await redisClient.hSet(`apikey:${matchedKey}`, 'limit', limit);
      commandExecuted = `Updated quota limit for ${matchedKey} to ${limit}`;
      reply = `### ⚡ Rate Limit Quota Resized\nSuccessfully updated rate limit quota for developer key **${matchedKey}** to **${limit}** requests per minute.`;
    } else {
      reply = `To change a quota limit, please mention the API key and the new limit. Example: *"Set rate limit for demo-key-123 to 120"*`;
    }
  } else if (normalizedMsg.includes('metrics') || normalizedMsg.includes('status') || normalizedMsg.includes('stats')) {
    const totalRequests = await redisClient.get('telemetry:total_requests') || 0;
    const rateLimited = await redisClient.get('telemetry:rate_limited_requests') || 0;
    const unauthorized = await redisClient.get('telemetry:unauthorized_requests') || 0;
    const blacklist = await redisClient.sMembers('blacklist:ips');
    
    reply = `### 📊 Current Gateway Telemetry Overview
* **Total Transactions**: ${totalRequests} requests
* **Rate Limits Blocked**: ${rateLimited} requests (429)
* **Auth Failures**: ${unauthorized} hits (401)
* **Firewall Blacklist Size**: ${blacklist.length} blocked IP(s)

*Note: Telemetry metrics are loaded live from the Redis cache layer.*`;
  } else if (normalizedMsg.includes('key') || normalizedMsg.includes('credentials')) {
    const keys = await redisClient.keys('apikey:*');
    let keyDetailsList = [];
    for (const key of keys) {
      const keyData = await redisClient.hGetAll(key);
      keyDetailsList.push(`- **${key.replace('apikey:', '')}**: ${keyData.name} (${keyData.limit} req/min, Status: ${keyData.active === 'true' ? 'Active' : 'Inactive'})`);
    }
    reply = `### 🔑 Seeded API Credentials Keyspace\nI found the following API keys registered in Redis:\n${keyDetailsList.join('\n')}`;
  } else {
    reply = `### 🤖 APIShield Admin Assistant
Hello! I am your AI-powered gateway co-pilot. I can perform administrative operations in real-time. Try asking me to:
* *"Show live metrics"*
* *"List active API keys"*
* *"Block IP 198.51.100.22"*
* *"Unblock IP 198.51.100.22"*
* *"Set limit of demo-key-123 to 120"*
* *"Deactivate key apishield_premium_user"*`;
  }
  
  res.json({ reply, mode: 'fallback_nlp', commandExecuted });
});

// Connect to Redis and startup server
if (require.main === module) {
  (async () => {
    await redisClient.connect();
    await seedDefaultKey();
    
    app.listen(PORT, () => {
      console.log(`API Shield Gateway running on port ${PORT}`);
    });
  })();
}

module.exports = {
  app,
  redisClient,
  seedDefaultKey,
  ipBlacklistMiddleware,
  apiSecurityMiddleware
};

