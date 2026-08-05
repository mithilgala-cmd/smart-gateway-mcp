/**
 * Hybrid AES-RSA Payload Encryption Utility
 *
 * Provides end-to-end payload protection for sensitive data moving between the
 * API Gateway, MCP Server, and n8n workflows. Implements a hybrid cryptosystem:
 *
 *  - **AES-256-GCM**: Symmetric, fast, authenticated encryption of the payload
 *    itself. A fresh random key + IV is generated per encryption, so no two
 *    ciphertexts ever share a key stream.
 *  - **RSA-OAEP (SHA-256)**: Asymmetric key wrapping. The ephemeral AES key is
 *    encrypted with the RSA public key, so only the holder of the matching
 *    private key can unwrap and decrypt the payload.
 *
 * The serialized envelope looks like:
 * ```json
 * {
 *   "v": 1,
 *   "iv": "<base64>",
 *   "ciphertext": "<base64>",
 *   "authTag": "<base64>",
 *   "encryptedKey": "<base64>"
 * }
 * ```
 *
 * Keys are resolved from `ENCRYPTION_RSA_PRIVATE_KEY` / `ENCRYPTION_RSA_PUBLIC_KEY`
 * environment variables. If absent (development only), a throwaway key pair is
 * generated at startup and a warning is emitted — cross-process persistence
 * requires setting the environment variables.
 *
 * @module gateway/encryption-util
 * @requires crypto
 */

const crypto = require('crypto');

/** AES block mode + key size (bits). */
const AES_ALGORITHM = 'aes-256-gcm';
/** Recommended IV length for GCM (12 bytes = 96 bits). */
const IV_LENGTH = 12;
/** Ephemeral AES key length (32 bytes = 256 bits). */
const AES_KEY_LENGTH = 32;
/** RSA modulus length used when auto-generating a key pair. */
const RSA_MODULUS_LENGTH = 2048;
/** Envelope schema version for forward compatibility. */
const ENVELOPE_VERSION = 1;

/**
 * Resolve the RSA key pair from the environment, or generate a dev-only pair.
 *
 * @returns {{publicKey: crypto.KeyObject, privateKey: crypto.KeyObject}} The RSA key pair.
 * @private
 */
function resolveKeyPair() {
  const privateKeyPem = process.env.ENCRYPTION_RSA_PRIVATE_KEY;
  const publicKeyPem = process.env.ENCRYPTION_RSA_PUBLIC_KEY;

  if (privateKeyPem && publicKeyPem) {
    try {
      return {
        publicKey: crypto.createPublicKey(publicKeyPem),
        privateKey: crypto.createPrivateKey(privateKeyPem)
      };
    } catch (err) {
      console.error('[encryption-util] Failed to parse RSA keys from environment, generating dev pair.', err);
    }
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  console.warn(
    '[encryption-util] WARNING: Using an auto-generated RSA key pair. ' +
    'Set ENCRYPTION_RSA_PRIVATE_KEY and ENCRYPTION_RSA_PUBLIC_KEY to persist keys across processes/restarts.'
  );

  return {
    publicKey: crypto.createPublicKey(publicKey),
    privateKey: crypto.createPrivateKey(privateKey)
  };
}

// Module-level singleton key pair — resolved once at load time.
const { publicKey, privateKey } = resolveKeyPair();

/**
 * Encrypt a UTF-8 payload using the hybrid AES-RSA scheme.
 *
 * @param {string} data - The plaintext payload to encrypt.
 * @returns {string} A JSON-serialized encryption envelope (base64 fields).
 * @throws {Error} If encryption fails (e.g. invalid data type).
 */
function encryptData(data) {
  const aesKey = crypto.randomBytes(AES_KEY_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(AES_ALGORITHM, aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(data), 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  const encryptedKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    aesKey
  );

  const envelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
    encryptedKey: encryptedKey.toString('base64')
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypt a payload previously produced by {@link encryptData}.
 *
 * Also transparently handles legacy plaintext payloads: if the input is not a
 * valid encryption envelope (e.g. a raw JSON threat event written before this
 * module existed), it is returned unchanged. This keeps rolling upgrades safe.
 *
 * @param {string|object} input - The encryption envelope (JSON string or parsed object).
 * @returns {string} The decrypted plaintext, or the original input if it was not encrypted.
 * @throws {Error} If decryption fails due to a bad envelope or key mismatch.
 */
function decryptData(input) {
  if (typeof input !== 'string' && typeof input !== 'object') {
    throw new Error('[encryption-util] Payload must be a string or object envelope.');
  }

  let envelope = input;
  if (typeof input === 'string') {
    try {
      envelope = JSON.parse(input);
    } catch (err) {
      // Not JSON — treat as legacy plaintext.
      return input;
    }
  }

  // Backward compatibility: plain objects without envelope markers pass through.
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    !envelope.ciphertext ||
    !envelope.iv ||
    !envelope.authTag ||
    !envelope.encryptedKey
  ) {
    return typeof input === 'string' ? input : JSON.stringify(input);
  }

  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    Buffer.from(envelope.encryptedKey, 'base64')
  );

  const decipher = crypto.createDecipheriv(
    AES_ALGORITHM,
    aesKey,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

/**
 * Convenience guard: returns true if a payload looks like an encrypted envelope.
 *
 * @param {*} value - The value to inspect.
 * @returns {boolean} True when the value is a string/object containing envelope fields.
 */
function isEncryptedEnvelope(value) {
  if (!value || typeof value !== 'object') return false;
  return Boolean(value.ciphertext && value.iv && value.authTag && value.encryptedKey);
}

module.exports = { encryptData, decryptData, isEncryptedEnvelope };
