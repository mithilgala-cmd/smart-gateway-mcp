const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// --- REDIS IN-MEMORY MOCK SETUP ---
const redisStore = new Map();

const clearStore = () => {
  redisStore.clear();
};

const mockRedisClient = {
  on: (event, handler) => {
    // console.log(`mockRedisClient.on('${event}') registered`);
    if (event === 'connect') {
      setTimeout(handler, 0);
    }
  },
  connect: async () => {
    // console.log('mockRedisClient.connect() called');
    return Promise.resolve();
  },
  exists: async (key) => {
    return redisStore.has(key) ? 1 : 0;
  },
  hSet: async (key, fieldOrObj, value) => {
    if (!redisStore.has(key)) {
      redisStore.set(key, { type: 'hash', value: {} });
    }
    const hash = redisStore.get(key).value;
    if (typeof fieldOrObj === 'object' && fieldOrObj !== null) {
      Object.assign(hash, fieldOrObj);
    } else {
      hash[fieldOrObj] = value;
    }
    return 1;
  },
  hGetAll: async (key) => {
    if (!redisStore.has(key)) return {};
    const entry = redisStore.get(key);
    if (entry.type !== 'hash') return {};
    return { ...entry.value };
  },
  sIsMember: async (key, member) => {
    if (!redisStore.has(key)) return false;
    const entry = redisStore.get(key);
    if (entry.type !== 'set') return false;
    return entry.value.has(member);
  },
  sAdd: async (key, member) => {
    if (!redisStore.has(key)) {
      redisStore.set(key, { type: 'set', value: new Set() });
    }
    const entry = redisStore.get(key);
    entry.value.add(member);
    return 1;
  },
  sRem: async (key, member) => {
    if (!redisStore.has(key)) return 0;
    const entry = redisStore.get(key);
    const removed = entry.value.delete(member);
    return removed ? 1 : 0;
  },
  sMembers: async (key) => {
    if (!redisStore.has(key)) return [];
    const entry = redisStore.get(key);
    if (entry.type !== 'set') return [];
    return Array.from(entry.value);
  },
  lPush: async (key, value) => {
    if (!redisStore.has(key)) {
      redisStore.set(key, { type: 'list', value: [] });
    }
    const entry = redisStore.get(key);
    entry.value.unshift(value);
    return entry.value.length;
  },
  lTrim: async (key, start, stop) => {
    if (!redisStore.has(key)) return 'OK';
    const entry = redisStore.get(key);
    const end = stop < 0 ? entry.value.length + stop + 1 : stop + 1;
    entry.value = entry.value.slice(start, end);
    return 'OK';
  },
  lRange: async (key, start, stop) => {
    if (!redisStore.has(key)) return [];
    const entry = redisStore.get(key);
    const end = stop < 0 ? entry.value.length + stop + 1 : stop + 1;
    return entry.value.slice(start, end);
  },
  incr: async (key) => {
    let val = 0;
    if (redisStore.has(key)) {
      val = parseInt(redisStore.get(key).value, 10) || 0;
    }
    val += 1;
    redisStore.set(key, { type: 'string', value: val.toString() });
    return val;
  },
  get: async (key) => {
    if (!redisStore.has(key)) return null;
    return redisStore.get(key).value;
  },
  set: async (key, value) => {
    redisStore.set(key, { type: 'string', value: value.toString() });
    return 'OK';
  },
  keys: async (pattern) => {
    const matched = [];
    const prefix = pattern.replace('*', '');
    for (const key of redisStore.keys()) {
      if (key.startsWith(prefix)) {
        matched.push(key);
      }
    }
    return matched;
  },
  eval: async (script, options) => {
    const key = options.keys[0];
    const capacity = parseFloat(options.arguments[0]);
    const refillRate = parseFloat(options.arguments[1]);
    const now = parseFloat(options.arguments[2]);
    const requested = 1;

    if (!redisStore.has(key)) {
      redisStore.set(key, {
        type: 'hash',
        value: {
          tokens: (capacity - requested).toString(),
          last_updated: now.toString()
        }
      });
      return [1, capacity - requested];
    }

    const entry = redisStore.get(key);
    const hash = entry.value;
    let tokens = parseFloat(hash.tokens);
    let lastUpdated = parseFloat(hash.last_updated);

    const elapsed = now - lastUpdated;
    const replenished = elapsed * refillRate;
    tokens = Math.min(capacity, tokens + replenished);

    if (tokens >= requested) {
      tokens = tokens - requested;
      hash.tokens = tokens.toString();
      hash.last_updated = now.toString();
      return [1, tokens];
    } else {
      return [0, tokens];
    }
  }
};

// Intercept 'redis' require before importing server
require.cache[require.resolve('redis')] = {
  exports: {
    createClient: () => mockRedisClient
  }
};

// Now import the gateway server module
const { app } = require('../server');
const request = require('supertest');

// --- TESTS ---

test.describe('APIShield Gateway Tests', () => {
  
  test.beforeEach(() => {
    clearStore();
  });

  test('GET / should return gateway status OK', async () => {
    const response = await request(app)
      .get('/')
      .expect('Content-Type', /json/)
      .expect(200);

    assert.strictEqual(response.body.status, 'OK');
    assert.match(response.body.message, /APIShield API Gateway/);
  });

  test('GET /api/v1/resource should block requests without API Key', async () => {
    const response = await request(app)
      .get('/api/v1/resource')
      .expect('Content-Type', /json/)
      .expect(401);

    assert.strictEqual(response.body.error, 'Unauthorized');
    assert.match(response.body.message, /API Key missing/);

    // Verify unauthenticated request telemetry was logged in Redis
    const totalRequests = await mockRedisClient.get('telemetry:total_requests');
    assert.strictEqual(totalRequests, '1');
    const unauthorizedRequests = await mockRedisClient.get('telemetry:unauthorized_requests');
    assert.strictEqual(unauthorizedRequests, '1');
  });

  test('GET /api/v1/resource should block invalid API Key', async () => {
    const response = await request(app)
      .get('/api/v1/resource')
      .set('x-api-key', 'invalid-key-here')
      .expect('Content-Type', /json/)
      .expect(401);

    assert.strictEqual(response.body.error, 'Unauthorized');
    assert.match(response.body.message, /Invalid or inactive/);
  });

  test('GET /api/v1/resource should allow valid active API Key', async () => {
    // Seed key in Redis mock
    await mockRedisClient.hSet('apikey:valid-key-abc', {
      name: 'Developer Alice',
      limit: '5',
      active: 'true',
      createdAt: new Date().toISOString()
    });

    const response = await request(app)
      .get('/api/v1/resource')
      .set('x-api-key', 'valid-key-abc')
      .expect('Content-Type', /json/)
      .expect(200);

    assert.strictEqual(response.body.status, 'success');
    assert.strictEqual(response.body.developer, 'Developer Alice');
    assert.strictEqual(response.headers['x-ratelimit-limit'], '5');
    assert.strictEqual(response.headers['x-ratelimit-remaining'], '4');
  });

  test('GET /api/v1/resource should rate limit when capacity exceeded', async () => {
    // Seed key with a limit of 1
    await mockRedisClient.hSet('apikey:low-limit-key', {
      name: 'Developer Bob',
      limit: '1',
      active: 'true',
      createdAt: new Date().toISOString()
    });

    // First request should be successful
    await request(app)
      .get('/api/v1/resource')
      .set('x-api-key', 'low-limit-key')
      .expect(200);

    // Second request should be rate limited (429)
    const response = await request(app)
      .get('/api/v1/resource')
      .set('x-api-key', 'low-limit-key')
      .expect(429);

    assert.strictEqual(response.body.error, 'Too Many Requests');
    assert.match(response.body.message, /Rate limit exceeded/);

    const rateLimited = await mockRedisClient.get('telemetry:rate_limited_requests');
    assert.strictEqual(rateLimited, '1');
  });

  test('GET /api/v1/resource should block blacklisted IPs', async () => {
    // Add client IP to blacklist
    await mockRedisClient.sAdd('blacklist:ips', '127.0.0.1');
    await mockRedisClient.sAdd('blacklist:ips', '::ffff:127.0.0.1');
    await mockRedisClient.sAdd('blacklist:ips', '::1');

    const response = await request(app)
      .get('/api/v1/resource')
      .expect(403);

    assert.strictEqual(response.body.error, 'Forbidden');
    assert.match(response.body.message, /blacklisted/);
  });

  test('POST /admin/keys should create API Keys', async () => {
    const newKey = {
      name: 'Customer Dave',
      limit: 150,
      apiKey: 'dave-super-secret-key'
    };

    const response = await request(app)
      .post('/admin/keys')
      .send(newKey)
      .expect(201);

    assert.strictEqual(response.body.message, 'API Key created successfully');
    assert.strictEqual(response.body.apiKey, newKey.apiKey);

    // Verify key exists in Redis mock
    const keyData = await mockRedisClient.hGetAll(`apikey:${newKey.apiKey}`);
    assert.strictEqual(keyData.name, 'Customer Dave');
    assert.strictEqual(keyData.limit, '150');
    assert.strictEqual(keyData.active, 'true');
  });

  test('POST /admin/blacklist should manage blacklist', async () => {
    const targetIp = '10.0.0.5';

    // Blacklist IP
    let response = await request(app)
      .post('/admin/blacklist')
      .send({ ip: targetIp, block: true })
      .expect(200);

    assert.match(response.body.message, /blacklisted successfully/);
    let isBlocked = await mockRedisClient.sIsMember('blacklist:ips', targetIp);
    assert.strictEqual(isBlocked, true);

    // Unblacklist IP
    response = await request(app)
      .post('/admin/blacklist')
      .send({ ip: targetIp, block: false })
      .expect(200);

    assert.match(response.body.message, /removed from blacklist/);
    isBlocked = await mockRedisClient.sIsMember('blacklist:ips', targetIp);
    assert.strictEqual(isBlocked, false);
  });

  test('GET /admin/metrics should return aggregate metrics and recent logs', async () => {
    await mockRedisClient.incr('telemetry:total_requests');
    await mockRedisClient.incr('telemetry:rate_limited_requests');
    await mockRedisClient.lPush('telemetry:recent_requests', JSON.stringify({
      ip: '192.168.1.1',
      path: '/api/v1/resource',
      status: 200,
      keyName: 'Alice',
      timestamp: new Date().toISOString()
    }));

    const response = await request(app)
      .get('/admin/metrics')
      .expect(200);

    assert.strictEqual(response.body.metrics.totalRequests, 1);
    assert.strictEqual(response.body.metrics.rateLimited, 1);
    assert.strictEqual(response.body.recentLogs.length, 1);
    assert.strictEqual(response.body.recentLogs[0].keyName, 'Alice');
  });

  test('GET /admin/keys/all should return all seeded keys', async () => {
    await mockRedisClient.hSet('apikey:test-key-1', {
      name: 'User One',
      limit: '60',
      active: 'true',
      createdAt: new Date().toISOString()
    });

    const response = await request(app)
      .get('/admin/keys/all')
      .expect(200);

    assert.strictEqual(response.body.keys.length, 1);
    assert.strictEqual(response.body.keys[0].name, 'User One');
    assert.strictEqual(response.body.keys[0].apiKey, 'test-key-1');
  });

  test('POST /admin/keys/status should toggle key active state', async () => {
    await mockRedisClient.hSet('apikey:test-key-2', {
      name: 'User Two',
      limit: '30',
      active: 'true',
      createdAt: new Date().toISOString()
    });

    const response = await request(app)
      .post('/admin/keys/status')
      .send({ apiKey: 'test-key-2', active: false })
      .expect(200);

    assert.match(response.body.message, /active status set to false/);
    const keyData = await mockRedisClient.hGetAll('apikey:test-key-2');
    assert.strictEqual(keyData.active, 'false');
  });

  test('GET /admin/agent/logs should return config, state and logs', async () => {
    await mockRedisClient.lPush('telemetry:agent_logs', JSON.stringify({
      timestamp: new Date().toISOString(),
      ip: '10.0.0.99',
      action: 'IP_BLOCKED',
      reason: 'Rate limit breach'
    }));

    const response = await request(app)
      .get('/admin/agent/logs')
      .expect(200);

    assert.strictEqual(response.body.logs.length, 1);
    assert.strictEqual(response.body.logs[0].ip, '10.0.0.99');
    assert.strictEqual(response.body.config.active, true);
    assert.strictEqual(response.body.agentState.activeNode, 'idle');
  });

  test('POST /admin/agent/config should update configurations', async () => {
    await request(app)
      .post('/admin/agent/config')
      .send({ active: false, max429Violations: 8 })
      .expect(200);

    const active = await mockRedisClient.get('config:security_agent_active');
    const limit = await mockRedisClient.get('config:max_429_violations');
    assert.strictEqual(active, 'false');
    assert.strictEqual(limit, '8');
  });

  test('POST /admin/chat should process messages and fallback to NLP', async () => {
    const response = await request(app)
      .post('/admin/chat')
      .send({ message: 'Block IP 192.168.10.10' })
      .expect(200);

    assert.strictEqual(response.body.mode, 'fallback_nlp');
    assert.match(response.body.reply, /added \*\*192.168.10.10\*\* to the gateway IP blacklist/);
    const isBlocked = await mockRedisClient.sIsMember('blacklist:ips', '192.168.10.10');
    assert.strictEqual(isBlocked, true);
  });
});
