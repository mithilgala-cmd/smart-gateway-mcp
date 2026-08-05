const test = require('node:test');
const assert = require('node:assert');

const { encryptData, decryptData, isEncryptedEnvelope } = require('../encryption-util');

test.describe('Hybrid AES-RSA Encryption Utility', () => {

  test('encryptData returns a serialized envelope without plaintext leakage', () => {
    const payload = JSON.stringify({
      ip: '192.168.1.50',
      type: 'RATE_LIMIT_ABUSE',
      violationCount: 9
    });

    const envelope = encryptData(payload);

    // Must be a valid JSON string with all envelope fields.
    assert.strictEqual(typeof envelope, 'string');
    const parsed = JSON.parse(envelope);
    for (const field of ['v', 'iv', 'ciphertext', 'authTag', 'encryptedKey']) {
      assert.ok(parsed[field], `envelope is missing field: ${field}`);
    }
    assert.strictEqual(parsed.v, 1);

    // Plaintext must never appear in the envelope.
    assert.ok(!envelope.includes('192.168.1.50'));
    assert.ok(!envelope.includes('RATE_LIMIT_ABUSE'));
  });

  test('decryptData round-trips the original plaintext', () => {
    const payload = JSON.stringify({
      ip: '10.0.0.7',
      type: 'AUTH_SCAN_SWEEP',
      violationCount: 12,
      keys: ['demo-key-123'],
      timestamp: new Date().toISOString()
    });

    const envelope = encryptData(payload);
    assert.strictEqual(decryptData(envelope), payload);
  });

  test('decryptData accepts a parsed object envelope as well as a string', () => {
    const payload = '{"ip":"203.0.113.9"}';
    const envelope = JSON.parse(encryptData(payload));
    assert.strictEqual(decryptData(envelope), payload);
  });

  test('isEncryptedEnvelope detects envelopes and rejects plaintext', () => {
    assert.strictEqual(isEncryptedEnvelope(JSON.parse(encryptData('x'))), true);
    assert.strictEqual(isEncryptedEnvelope({ ip: '1.2.3.4' }), false);
    assert.strictEqual(isEncryptedEnvelope(null), false);
  });

  test('decryptData passes through legacy plaintext payloads (backward compatibility)', () => {
    const legacy = '{"ip":"198.51.100.1","type":"RATE_LIMIT_ABUSE"}';
    assert.strictEqual(decryptData(legacy), legacy);

    const legacyObject = { ip: '198.51.100.1' };
    assert.strictEqual(decryptData(legacyObject), JSON.stringify(legacyObject));
  });

  test('tampered ciphertext is rejected by the GCM auth tag', () => {
    const envelope = JSON.parse(encryptData('{"ip":"9.9.9.9"}'));

    // Flip the first byte of the ciphertext.
    const buffer = Buffer.from(envelope.ciphertext, 'base64');
    buffer[0] ^= 0xff;
    envelope.ciphertext = buffer.toString('base64');

    assert.throws(() => decryptData(JSON.stringify(envelope)));
  });

  test('tampered AES key is rejected (RSA-OAEP integrity)', () => {
    const envelope = JSON.parse(encryptData('{"ip":"8.8.8.8"}'));

    const buffer = Buffer.from(envelope.encryptedKey, 'base64');
    buffer[0] ^= 0xff;
    envelope.encryptedKey = buffer.toString('base64');

    assert.throws(() => decryptData(JSON.stringify(envelope)));
  });

  test('each encryption produces a unique IV and ciphertext (no key-stream reuse)', () => {
    const payload = 'same payload every time';
    const first = encryptData(payload);
    const second = encryptData(payload);

    assert.notStrictEqual(first, second);
    assert.notStrictEqual(JSON.parse(first).iv, JSON.parse(second).iv);
  });
});
