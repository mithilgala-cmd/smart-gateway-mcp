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

// Connect to Redis and startup server
(async () => {
  await redisClient.connect();
  await seedDefaultKey();
  
  app.listen(PORT, () => {
    console.log(`API Shield Gateway running on port ${PORT}`);
  });
})();
