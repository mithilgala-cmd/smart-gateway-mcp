import test from 'node:test';
import assert from 'node:assert';
import { server, redisClient } from '../index.js';

// Setup Redis Mock store
const redisStore = new Map();

// Inject mock methods on redisClient
redisClient.get = async (key) => {
  return redisStore.get(key) || null;
};
redisClient.sMembers = async (key) => {
  const val = redisStore.get(key);
  return val ? Array.from(val) : [];
};
redisClient.sAdd = async (key, member) => {
  if (!redisStore.has(key)) {
    redisStore.set(key, new Set());
  }
  redisStore.get(key).add(member);
  return 1;
};
redisClient.sRem = async (key, member) => {
  if (!redisStore.has(key)) return 0;
  const deleted = redisStore.get(key).delete(member);
  return deleted ? 1 : 0;
};
redisClient.exists = async (key) => {
  return redisStore.has(key) ? 1 : 0;
};
redisClient.hSet = async (key, field, value) => {
  if (!redisStore.has(key)) {
    redisStore.set(key, {});
  }
  redisStore.get(key)[field] = value;
  return 1;
};
redisClient.lRange = async (key, start, stop) => {
  const list = redisStore.get(key) || [];
  const end = stop < 0 ? list.length + stop + 1 : stop + 1;
  return list.slice(start, end);
};

const clearStore = () => {
  redisStore.clear();
};

test.describe('APIShield MCP Server Tests', () => {
  test.beforeEach(() => {
    clearStore();
  });

  test('tools/list should return all tool definitions', async () => {
    const listToolsHandler = server._requestHandlers.get('tools/list');
    assert.ok(listToolsHandler, 'tools/list handler should be registered');
    
    const result = await listToolsHandler({ method: 'tools/list' });
    assert.ok(result.tools);
    assert.strictEqual(result.tools.length, 5);

    const names = result.tools.map(t => t.name);
    assert.ok(names.includes('get_gateway_metrics'));
    assert.ok(names.includes('get_blacklist'));
    assert.ok(names.includes('block_ip'));
    assert.ok(names.includes('unblock_ip'));
    assert.ok(names.includes('update_key_quota'));
  });

  test('tools/call: get_gateway_metrics should return metrics and logs from Redis', async () => {
    const callToolHandler = server._requestHandlers.get('tools/call');
    assert.ok(callToolHandler);

    redisStore.set('telemetry:total_requests', '100');
    redisStore.set('telemetry:rate_limited_requests', '10');
    redisStore.set('telemetry:unauthorized_requests', '5');
    redisStore.set('telemetry:recent_requests', [
      JSON.stringify({ ip: '1.1.1.1', path: '/resource', status: 200, keyName: 'Alice', timestamp: '2026-06-23T11:00:00Z' })
    ]);

    const result = await callToolHandler({
      method: 'tools/call',
      params: {
        name: 'get_gateway_metrics',
        arguments: {}
      }
    });

    assert.ok(result.content);
    assert.strictEqual(result.content[0].type, 'text');
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.summary.totalRequests, 100);
    assert.strictEqual(data.summary.rateLimitedRequests, 10);
    assert.strictEqual(data.summary.unauthorizedRequests, 5);
    assert.strictEqual(data.recentRequests.length, 1);
    assert.strictEqual(data.recentRequests[0].keyName, 'Alice');
  });

  test('tools/call: get_blacklist should return blocked IPs', async () => {
    const callToolHandler = server._requestHandlers.get('tools/call');
    
    const set = new Set();
    set.add('192.168.1.5');
    redisStore.set('blacklist:ips', set);

    const result = await callToolHandler({
      method: 'tools/call',
      params: {
        name: 'get_blacklist',
        arguments: {}
      }
    });

    assert.ok(result.content);
    const data = JSON.parse(result.content[0].text);
    assert.deepStrictEqual(data.blockedIps, ['192.168.1.5']);
  });

  test('tools/call: block_ip and unblock_ip should modify blacklist in Redis', async () => {
    const callToolHandler = server._requestHandlers.get('tools/call');

    // Test block_ip
    let result = await callToolHandler({
      method: 'tools/call',
      params: {
        name: 'block_ip',
        arguments: { ip: '10.0.0.1' }
      }
    });

    assert.ok(result.content);
    assert.match(result.content[0].text, /Successfully blacklisted IP: 10.0.0.1/);
    const blacklistSet = redisStore.get('blacklist:ips');
    assert.ok(blacklistSet);
    assert.ok(blacklistSet.has('10.0.0.1'));

    // Test unblock_ip
    result = await callToolHandler({
      method: 'tools/call',
      params: {
        name: 'unblock_ip',
        arguments: { ip: '10.0.0.1' }
      }
    });

    assert.ok(result.content);
    assert.match(result.content[0].text, /Successfully removed IP 10.0.0.1/);
    assert.strictEqual(blacklistSet.has('10.0.0.1'), false);
  });

  test('tools/call: update_key_quota should modify API key limit', async () => {
    const callToolHandler = server._requestHandlers.get('tools/call');

    // 1. Try non-existent key
    let result = await callToolHandler({
      method: 'tools/call',
      params: {
        name: 'update_key_quota',
        arguments: { apiKey: 'non-existent', limit: 100 }
      }
    });
    assert.strictEqual(result.isError, true);
    assert.match(result.content[0].text, /does not exist/);

    // 2. Set key exists and update limit
    redisStore.set('apikey:existing-key', {});
    result = await callToolHandler({
      method: 'tools/call',
      params: {
        name: 'update_key_quota',
        arguments: { apiKey: 'existing-key', limit: 250 }
      }
    });

    assert.ok(!result.isError);
    assert.match(result.content[0].text, /Successfully updated quota/);
    assert.strictEqual(redisStore.get('apikey:existing-key').limit, '250');
  });
});
