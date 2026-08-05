const { createClient } = require('redis');
const crypto = require('crypto');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: REDIS_URL });

// Encryption utilities for securing threat queue data between Security Agent and Multi-Agent Orchestrator
const EncryptionUtil = (function() {
  let rsaPrivateKey = null;
  let rsaPublicKey = null;

  // Initialize RSA keys from environment or generate
  function init() {
    const privateKeyEnv = process.env.ENCRYPTION_RSA_PRIVATE_KEY;
    const publicKeyEnv = process.env.ENCRYPTION_RSA_PUBLIC_KEY;

    if (privateKeyEnv && publicKeyEnv) {
      try {
        rsaPrivateKey = crypto.createPrivateKey(privateKeyEnv);
        rsaPublicKey = crypto.createPublicKey(publicKeyEnv);
        return;
      } catch (e) {
        console.error('Failed to load RSA keys from environment, generating new ones', e);
      }
    }

    // Generate a new key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    rsaPrivateKey = crypto.createPrivateKey(privateKey);
    rsaPublicKey = crypto.createPublicKey(publicKey);

    console.warn('WARNING: Generated new RSA encryption keys. For production, set ENCRYPTION_RSA_PRIVATE_KEY and ENCRYPTION_RSA_PUBLIC_KEY environment variables.');
  }

  init();

  function encryptData(data) {
    // Generate a random AES key
    const aesKey = crypto.randomBytes(32);
    // Generate a random IV for GCM
    const iv = crypto.randomBytes(12);

    // Encrypt data with AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    let ciphertext = cipher.update(data, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Encrypt the AES key with RSA public key
    const encryptedAesKey = rsaPublicKey.encrypt(
      aesKey,
      crypto.constants.RSA_PKCS1_OAEP_PADDING
    );

    return {
      iv: iv.toString('base64'),
      encryptedAesKey: encryptedAesKey.toString('base64'),
      ciphertext: ciphertext,
      authTag: authTag.toString('base64')
    };
  }

  function decryptData(encryptedData) {
    // Parse if it's a string
    if (typeof encryptedData === 'string') {
      encryptedData = JSON.parse(encryptedData);
    }

    // Decrypt the AES key with RSA private key
    const aesKey = rsaPrivateKey.decrypt(
      Buffer.from(encryptedData.encryptedAesKey, 'base64'),
      crypto.constants.RSA_PKCS1_OAEP_PADDING
    );

    // Decrypt the data with AES-GCM
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      aesKey,
      Buffer.from(encryptedData.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'base64'));

    let decrypted = decipher.update(encryptedData.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  return { encryptData, decryptData };
})();

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
        const encryptedData = JSON.parse(rawEvent);
        const decryptedData = EncryptionUtil.decryptData(encryptedData);
        const threatEvent = JSON.parse(decryptedData);
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
