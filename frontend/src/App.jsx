import React, { useState, useEffect, useRef } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState('developer');
  
  // Connection Configuration
  const [gatewayUrl, setGatewayUrl] = useState('https://apishield-gateway.onrender.com');
  const [n8nUrl, setN8nUrl] = useState('https://apishield-n8n.onrender.com/webhook/developer-onboarding');

  // Developer Tab State
  const [devName, setDevName] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devLimit, setDevLimit] = useState(60);
  const [generatedKey, setGeneratedKey] = useState('');
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState('');

  // Tester State
  const [testApiKey, setTestApiKey] = useState('demo-key-123');
  const [testEndpoint, setTestEndpoint] = useState('/api/v1/resource');
  const [testerLoading, setTesterLoading] = useState(false);
  const [testResponse, setTestResponse] = useState(null);
  const [spamActive, setSpamActive] = useState(false);

  // Live telemetry graphs state
  const [rpsHistory, setRpsHistory] = useState(Array(15).fill(0));
  const [latencyHistory, setLatencyHistory] = useState([
    { latency: 45, status: 200 },
    { latency: 120, status: 200 },
    { latency: 15, status: 401 },
    { latency: 25, status: 200 },
    { latency: 110, status: 429 }
  ]);
  const rpsCounterRef = useRef(0);

  // Admin Tab State
  const [metrics, setMetrics] = useState({ totalRequests: 0, rateLimited: 0, unauthorized: 0 });
  const [recentLogs, setRecentLogs] = useState([]);
  const [blacklist, setBlacklist] = useState([]);
  const [newBlockIp, setNewBlockIp] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

  // Health check status
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [n8nConnected, setN8nConnected] = useState(false);

  // Console log list
  const [consoleLogs, setConsoleLogs] = useState([
    { time: new Date().toLocaleTimeString(), method: 'SYS', message: 'APIShield Control Console Initialized.', status: 200 }
  ]);

  const [matrixNodes, setMatrixNodes] = useState(Array(100).fill(null));

  // Visual Pipeline & Simulator States
  const [pipelineState, setPipelineState] = useState('idle'); // 'idle' | 'sending' | 'success_200' | 'blocked_403' | 'blocked_429' | 'unauthorized_401'
  const [activeScenario, setActiveScenario] = useState('none'); // 'none' | 'steady' | 'ddos' | 'auth'
  const scenarioIntervalRef = useRef(null);

  // Local fallback/simulation state (to gracefully bypass Render's 50s cold start)
  const [simulatedBlacklist, setSimulatedBlacklist] = useState(['198.51.100.200', '203.0.113.88']);
  const [simulatedKeys, setSimulatedKeys] = useState({
    'demo-key-123': { name: 'Demo Developer', limit: 60, tokens: 60, lastUpdated: Date.now() },
    'apishield_premium_user': { name: 'SaaS Client Corp', limit: 120, tokens: 120, lastUpdated: Date.now() }
  });
  const [simulatedLogs, setSimulatedLogs] = useState([
    { timestamp: new Date(Date.now() - 10000).toISOString(), path: '/api/v1/resource', ip: '127.0.0.1', keyName: 'Demo Developer', status: 200 },
    { timestamp: new Date(Date.now() - 60000).toISOString(), path: '/api/v1/info', ip: '198.51.100.200', keyName: 'BLOCKED_IP', status: 403 }
  ]);
  const [simulatedMetrics, setSimulatedMetrics] = useState({ totalRequests: 2, rateLimited: 0, unauthorized: 1 });
  const [selectedRedisKey, setSelectedRedisKey] = useState('rate:limit:demo-key-123');

  // Info details popup state
  const [showTechDetails, setShowTechDetails] = useState(true);

  // Update matrix topology flashing
  const triggerMatrixBlink = (statusCode) => {
    const randomIndex = Math.floor(Math.random() * 100);
    let blinkClass = 'blink-green';
    if (statusCode === 401 || statusCode === 403) blinkClass = 'blink-yellow';
    if (statusCode === 429) blinkClass = 'blink-red';

    setMatrixNodes(prev => {
      const next = [...prev];
      next[randomIndex] = blinkClass;
      return next;
    });

    setTimeout(() => {
      setMatrixNodes(prev => {
        const next = [...prev];
        next[randomIndex] = null;
        return next;
      });
    }, 600);
  };

  const consoleEndRef = useRef(null);

  // 3D Card Hover Tilt Effect Handlers
  const handleMouseMove3D = (e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    const angleX = (yc - y) / 12; // Max 12 deg tilt
    const angleY = (x - xc) / 12;
    card.style.setProperty('--rx', `${angleX}deg`);
    card.style.setProperty('--ry', `${angleY}deg`);
  };

  const handleMouseLeave3D = (e) => {
    const card = e.currentTarget;
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  };

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

  // RPS graph background tick
  useEffect(() => {
    const rpsInterval = setInterval(() => {
      setRpsHistory(prev => {
        const next = [...prev.slice(1), rpsCounterRef.current];
        rpsCounterRef.current = 0;
        return next;
      });
    }, 1000);
    return () => clearInterval(rpsInterval);
  }, []);

  // Periodic health check & admin metrics poll
  useEffect(() => {
    let interval;
    
    const checkHealthAndMetrics = async () => {
      // 1. Check Gateway and Fetch Metrics
      try {
        const res = await fetch(`${gatewayUrl}/admin/metrics`);
        if (res.ok) {
          const data = await res.json();
          setMetrics(data.metrics || { totalRequests: 0, rateLimited: 0, unauthorized: 0 });
          setRecentLogs(data.recentLogs || []);
          setBlacklist(data.blacklist || []);
          setGatewayConnected(true);
        } else {
          setGatewayConnected(false);
        }
      } catch (err) {
        setGatewayConnected(false);
      }

      // 2. Ping n8n Webhook Endpoint
      try {
        const res = await fetch(n8nUrl, { method: 'OPTIONS' });
        setN8nConnected(true);
      } catch (err) {
        if (err.message && err.message.includes('Failed to fetch')) {
          setN8nConnected(false);
        } else {
          setN8nConnected(true);
        }
      }
    };

    checkHealthAndMetrics();
    interval = setInterval(checkHealthAndMetrics, 3000);

    return () => clearInterval(interval);
  }, [gatewayUrl, n8nUrl]);

  // Add line to terminal console
  const addConsoleLog = (method, message, status) => {
    setConsoleLogs(prev => [
      ...prev,
      { time: new Date().toLocaleTimeString(), method, message, status }
    ]);
  };

  // Helper to log a request in history
  const recordRequestTelemetry = (status, durationMs) => {
    rpsCounterRef.current += 1;
    setLatencyHistory(prev => [...prev.slice(prev.length >= 15 ? 1 : 0), { latency: durationMs, status }]);
  };

  // Local fallback simulator logic
  const runSimulatedRequest = (apiKey, endpoint, ip = '127.0.0.1') => {
    const startTime = Date.now();
    setPipelineState('sending');

    // 1. IP Blacklist check
    const isIpBlocked = simulatedBlacklist.includes(ip);
    if (isIpBlocked) {
      setTimeout(() => {
        setPipelineState('blocked_403');
        const duration = Math.floor(Math.random() * 5) + 1;
        setTestResponse({
          status: 403,
          statusText: 'Forbidden',
          duration: `${duration}ms`,
          body: { error: 'Forbidden', message: 'Your IP address has been blacklisted due to suspicious activity.' }
        });
        triggerMatrixBlink(403);
        addConsoleLog('BLOCKED', `[Simulated] IP Guard blocked blacklisted request from IP: ${ip}`, 403);
        recordRequestTelemetry(403, duration);
        
        setSimulatedLogs(prev => [
          { timestamp: new Date().toISOString(), path: endpoint, ip, keyName: 'BLOCKED_IP', status: 403 },
          ...prev.slice(0, 49)
        ]);
        setSimulatedMetrics(prev => ({ ...prev, totalRequests: prev.totalRequests + 1 }));
      }, 350);
      return;
    }

    // 2. Auth Key validation
    const keyData = simulatedKeys[apiKey];
    if (!keyData) {
      setTimeout(() => {
        setPipelineState('unauthorized_401');
        const duration = Math.floor(Math.random() * 8) + 2;
        setTestResponse({
          status: 401,
          statusText: 'Unauthorized',
          duration: `${duration}ms`,
          body: { error: 'Unauthorized', message: 'Invalid or inactive API Key.' }
        });
        triggerMatrixBlink(401);
        addConsoleLog('GET', `[Simulated] Request denied: Invalid API Key provided.`, 401);
        recordRequestTelemetry(401, duration);

        setSimulatedLogs(prev => [
          { timestamp: new Date().toISOString(), path: endpoint, ip, keyName: 'invalid-key', status: 401 },
          ...prev.slice(0, 49)
        ]);
        setSimulatedMetrics(prev => ({
          ...prev,
          totalRequests: prev.totalRequests + 1,
          unauthorized: prev.unauthorized + 1
        }));
      }, 350);
      return;
    }

    // 3. Token-Bucket Rate Limit evaluation
    const limit = parseInt(keyData.limit, 10);
    const refillRate = limit / (60 * 1000); // tokens per millisecond
    const now = Date.now();
    const elapsed = now - keyData.lastUpdated;
    const replenishedTokens = Math.min(limit, keyData.tokens + (elapsed * refillRate));

    if (replenishedTokens >= 1) {
      const nextTokens = replenishedTokens - 1;
      setSimulatedKeys(prev => ({
        ...prev,
        [apiKey]: { ...prev[apiKey], tokens: nextTokens, lastUpdated: now }
      }));

      setTimeout(() => {
        setPipelineState('success_200');
        const duration = Math.floor(Math.random() * 35) + 8;
        setTestResponse({
          status: 200,
          statusText: 'OK',
          duration: `${duration}ms`,
          headers: {
            'x-ratelimit-limit': limit,
            'x-ratelimit-remaining': Math.floor(nextTokens)
          },
          body: {
            status: 'success',
            timestamp: new Date().toISOString(),
            developer: keyData.name,
            simulated: true,
            data: {
              message: 'Hello! Your request successfully traversed the Shield API Gateway.',
              payload: 'Secure mock downstream data loaded.'
            }
          }
        });
        triggerMatrixBlink(200);
        addConsoleLog('GET', `[Simulated] Route ${endpoint} resolved successfully. Tokens left: ${Math.floor(nextTokens)}`, 200);
        recordRequestTelemetry(200, duration);

        setSimulatedLogs(prev => [
          { timestamp: new Date().toISOString(), path: endpoint, ip, keyName: keyData.name, status: 200 },
          ...prev.slice(0, 49)
        ]);
        setSimulatedMetrics(prev => ({ ...prev, totalRequests: prev.totalRequests + 1 }));
      }, 400);

    } else {
      // Too many requests
      setTimeout(() => {
        setPipelineState('blocked_429');
        const duration = Math.floor(Math.random() * 4) + 1;
        setTestResponse({
          status: 429,
          statusText: 'Too Many Requests',
          duration: `${duration}ms`,
          headers: {
            'x-ratelimit-limit': limit,
            'x-ratelimit-remaining': 0
          },
          body: { error: 'Too Many Requests', message: `Rate limit exceeded. Your limit is ${limit} req/min.` }
        });
        triggerMatrixBlink(429);
        addConsoleLog('BLOCKED', `[Simulated] Rate-limit breached (429) for developer: ${keyData.name}`, 429);
        recordRequestTelemetry(429, duration);

        setSimulatedLogs(prev => [
          { timestamp: new Date().toISOString(), path: endpoint, ip, keyName: keyData.name, status: 429 },
          ...prev.slice(0, 49)
        ]);
        setSimulatedMetrics(prev => ({
          ...prev,
          totalRequests: prev.totalRequests + 1,
          rateLimited: prev.rateLimited + 1
        }));
      }, 300);
    }
  };

  // 1. Developer Onboarding via n8n (or simulated local fallback)
  const handleOnboarding = async (e) => {
    e.preventDefault();
    if (!devName || !devEmail) {
      setOnboardingError('Please provide both name and email.');
      return;
    }

    setOnboardingLoading(true);
    setOnboardingError('');
    addConsoleLog('POST', `Triggering n8n onboarding for ${devName}...`, 200);

    try {
      const response = await fetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: devName, email: devEmail, limit: devLimit })
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      
      const data = await response.json();
      if (data.status === 'success') {
        setGeneratedKey(data.apiKey);
        setTestApiKey(data.apiKey);
        addConsoleLog('POST', `Successfully generated key: ${data.apiKey.substring(0, 15)}...`, 200);
      } else {
        throw new Error(data.message || 'Onboarding workflow failed.');
      }
    } catch (err) {
      console.warn('Real onboarding webhook unreachable. Seamless local simulation triggered.');
      const mockKey = `apishield_dev_${Math.random().toString(16).substring(2, 14)}`;
      
      // Update simulated Keyspace
      setSimulatedKeys(prev => ({
        ...prev,
        [mockKey]: { name: devName, limit: devLimit, tokens: devLimit, lastUpdated: Date.now() }
      }));

      // Direct local gateway write if gateway is running
      if (gatewayConnected) {
        try {
          await fetch(`${gatewayUrl}/admin/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: devName, limit: devLimit, apiKey: mockKey })
          });
          addConsoleLog('POST', `Registered directly to running Gateway: ${mockKey}`, 200);
        } catch (gateErr) {
          addConsoleLog('POST', `Simulation fallback. Key registered locally: ${mockKey}`, 200);
        }
      } else {
        addConsoleLog('POST', `[Simulated] n8n generated key and pushed to Redis: ${mockKey}`, 200);
      }

      setGeneratedKey(mockKey);
      setTestApiKey(mockKey);
    } finally {
      setOnboardingLoading(false);
    }
  };

  // 2. Test Request Router (Live or Simulated)
  const runTestRequest = async (overrideKey = null, overrideEndpoint = null, simulatedIp = '127.0.0.1') => {
    const keyToUse = overrideKey || testApiKey;
    const endpointToUse = overrideEndpoint || testEndpoint;

    if (!gatewayConnected) {
      runSimulatedRequest(keyToUse, endpointToUse, simulatedIp);
      return;
    }

    if (!keyToUse) {
      addConsoleLog('GET', 'Test execution failed. API Key missing.', 401);
      return;
    }

    setTesterLoading(true);
    setPipelineState('sending');
    const url = `${gatewayUrl}${endpointToUse}`;
    addConsoleLog('GET', `Sending API call to gateway: ${endpointToUse}`, 200);

    try {
      const startTime = Date.now();
      const res = await fetch(url, {
        headers: { 'x-api-key': keyToUse }
      });

      const duration = Date.now() - startTime;
      const headers = {
        'x-ratelimit-limit': res.headers.get('x-ratelimit-limit'),
        'x-ratelimit-remaining': res.headers.get('x-ratelimit-remaining')
      };

      const data = await res.json();
      setTestResponse({
        status: res.status,
        statusText: res.statusText,
        duration: `${duration}ms`,
        headers,
        body: data
      });

      // Map status code to visual pipe state
      if (res.status === 200) setPipelineState('success_200');
      else if (res.status === 403) setPipelineState('blocked_403');
      else if (res.status === 429) setPipelineState('blocked_429');
      else if (res.status === 401) setPipelineState('unauthorized_401');
      else setPipelineState('idle');

      triggerMatrixBlink(res.status);
      recordRequestTelemetry(res.status, duration);

      addConsoleLog(
        res.status === 429 ? 'BLOCKED' : 'GET', 
        `Gateway response: ${res.status}. Latency: ${duration}ms. Quota left: ${headers['x-ratelimit-remaining'] || '0'}`, 
        res.status
      );
    } catch (err) {
      console.error(err);
      setTestResponse({
        status: 500,
        statusText: 'Gateway Error',
        body: { error: 'Network Failure', message: 'Could not connect to the API Gateway.' }
      });
      setPipelineState('idle');
      triggerMatrixBlink(500);
      recordRequestTelemetry(500, 15);
      addConsoleLog('GET', 'API Gateway connection failed. Fallback simulation active.', 500);
    } finally {
      setTesterLoading(false);
    }
  };

  // 3. Scenario Controller
  const triggerScenario = (type) => {
    if (activeScenario !== 'none') {
      clearInterval(scenarioIntervalRef.current);
      setActiveScenario('none');
      addConsoleLog('SYS', 'Active scenario terminated manually.', 200);
      return;
    }

    setActiveScenario(type);
    addConsoleLog('SYS', `Launching Guided Scenario Simulation: ${type.toUpperCase()}`, 200);

    if (type === 'steady') {
      let count = 0;
      scenarioIntervalRef.current = setInterval(() => {
        runTestRequest(testApiKey || 'demo-key-123', '/api/v1/resource');
        count++;
        if (count >= 10) {
          clearInterval(scenarioIntervalRef.current);
          setActiveScenario('none');
          addConsoleLog('SYS', 'Steady Flow Scenario completed.', 200);
        }
      }, 1500);

    } else if (type === 'ddos') {
      let count = 0;
      const attackIp = '198.51.100.222';
      
      // Phase 1: Rapid abuse
      addConsoleLog('SYS', `Simulating rapid requests from high-frequency IP: ${attackIp}`, 200);
      scenarioIntervalRef.current = setInterval(() => {
        // Send rapid mock requests
        runTestRequest('demo-key-123', '/api/v1/resource', attackIp);
        count++;

        if (count === 8) {
          addConsoleLog('SYS', 'Attacking IP hit Redis rate limits. Triggering 429 Too Many Requests.', 429);
        }

        if (count === 12) {
          // Trigger mock n8n Cron detection and blacklist insertion
          addConsoleLog('SYS', `[n8n CRON] Anomaly detected: IP ${attackIp} triggered 4+ rate blocks in 10s.`, 403);
          addConsoleLog('SYS', `[n8n ACTION] Blacklisting IP ${attackIp} in Redis 'blacklist:ips' set...`, 200);
          
          if (gatewayConnected) {
            fetch(`${gatewayUrl}/admin/blacklist`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ip: attackIp, block: true })
            }).catch(() => {});
          } else {
            setSimulatedBlacklist(prev => [...prev, attackIp]);
          }
        }

        if (count >= 18) {
          clearInterval(scenarioIntervalRef.current);
          setActiveScenario('none');
          addConsoleLog('SYS', `Scenario DDoS completed. IP ${attackIp} is permanently blocked at the Gateway filter.`, 200);
        }
      }, 250);

    } else if (type === 'auth') {
      let count = 0;
      scenarioIntervalRef.current = setInterval(() => {
        const fakeKey = `apishield_wrong_${Math.floor(Math.random() * 10000)}`;
        runTestRequest(fakeKey, '/api/v1/resource');
        count++;
        if (count >= 6) {
          clearInterval(scenarioIntervalRef.current);
          setActiveScenario('none');
          addConsoleLog('SYS', 'Authentication Sweep Scenario completed.', 200);
        }
      }, 800);
    }
  };

  // 4. Manually Block IP
  const blockIpAddress = async (e) => {
    e.preventDefault();
    if (!newBlockIp) return;
    try {
      const res = await fetch(`${gatewayUrl}/admin/blacklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: newBlockIp, block: true })
      });
      if (res.ok) {
        addConsoleLog('SYS', `Successfully blacklisted IP: ${newBlockIp}`, 200);
        setNewBlockIp('');
      }
    } catch (err) {
      addConsoleLog('SYS', `[Simulated] Added IP ${newBlockIp} to blacklist database.`, 200);
      setSimulatedBlacklist(prev => [...prev, newBlockIp]);
      setNewBlockIp('');
    }
  };

  // 5. Manually Unblock IP
  const unblockIpAddress = async (ip) => {
    try {
      const res = await fetch(`${gatewayUrl}/admin/blacklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, block: false })
      });
      if (res.ok) {
        addConsoleLog('SYS', `Successfully unblocked IP: ${ip}`, 200);
      }
    } catch (err) {
      addConsoleLog('SYS', `[Simulated] Restored network access for IP: ${ip}`, 200);
      setSimulatedBlacklist(prev => prev.filter(item => item !== ip));
    }
  };

  // Calculate live values for Simulated keyspace display
  const currentBlacklist = gatewayConnected ? blacklist : simulatedBlacklist;
  const currentRecentLogs = gatewayConnected ? recentLogs : simulatedLogs;
  const activeMetrics = gatewayConnected ? metrics : {
    totalRequests: simulatedLogs.length,
    rateLimited: simulatedLogs.filter(l => l.status === 429).length,
    unauthorized: simulatedLogs.filter(l => l.status === 401).length
  };

  // Dynamic values inside Redis simulated inspector
  const redisKeysMap = {
    'blacklist:ips': { type: 'set', value: currentBlacklist },
    'telemetry:recent_requests': { type: 'list', value: currentRecentLogs },
    'rate:limit:demo-key-123': { 
      type: 'hash', 
      value: gatewayConnected ? { info: "Dynamically managed in Redis" } : simulatedKeys['demo-key-123'] 
    },
    'rate:limit:apishield_premium_user': { 
      type: 'hash', 
      value: simulatedKeys['apishield_premium_user'] 
    },
    'apikey:demo-key-123': { type: 'hash', value: { name: 'Demo Developer', limit: 60, active: 'true' } }
  };

  return (
    <div className="container">
      {/* Resume Overview Panel */}
      <div className="glass-panel resume-section" style={{ marginBottom: '24px', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, color: 'var(--accent-cyan)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            💼 Resume Portfolio Context & Architectural Insights
          </h4>
          <button 
            className="btn btn-secondary" 
            style={{ padding: '4px 12px', fontSize: '0.75rem' }}
            onClick={() => setShowTechDetails(!showTechDetails)}
          >
            {showTechDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
        {showTechDetails && (
          <div style={{ marginTop: '16px', fontSize: '0.88rem', color: 'var(--text-primary)' }}>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.5 }}>
              This project is a high-performance **Smart API Gateway** microservice pipeline designed to demonstrate fullstack architectural principles in production environments. 
              The backend uses a custom **Redis Lua script** to run atomic token-bucket rate limiting, intercepts traffic through an IP blacklist filter, and connects to an **n8n orchestration workflow** to handle automated developer onboarding and cron-based abuse blocks. It also exposes a custom **Model Context Protocol (MCP) server** for AI-guided devops maintenance.
            </p>
            <div className="tech-tags">
              <span className="tag">Redis Lua Scripting</span>
              <span className="tag">Express API Proxy</span>
              <span className="tag">n8n Automation</span>
              <span className="tag">Model Context Protocol</span>
              <span className="tag">Docker Compose</span>
              <span className="tag">Kubernetes (K8s)</span>
              <span className="tag">SVG Visualizers</span>
            </div>
          </div>
        )}
      </div>

      {/* Header Panel */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ margin: 0 }}>APIShield Control Console</h1>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.9rem', marginTop: '4px' }}>
            Low-Latency API Gateway Proxy, Caching Rate Limiter, and Dynamic Telemetry Dashboard.
          </p>
        </div>
        
        {/* Status Indicators & Simulator Banner */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <div className="glass-panel" style={{ padding: '6px 14px', display: 'flex', gap: '16px', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.85rem' }}>
              <span className={`status-dot ${gatewayConnected ? 'active' : 'error'}`}></span>
              Gateway: {gatewayConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
            <span style={{ fontSize: '0.85rem' }}>
              <span className={`status-dot ${n8nConnected ? 'active' : 'error'}`}></span>
              n8n: {n8nConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          {!gatewayConnected && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
              ⚠️ Running in local high-fidelity sandbox simulator (Backend offline/sleeping)
            </span>
          )}
        </div>
      </header>

      {/* Tabs Menu */}
      <nav className="tabs">
        <button className={`tab-btn ${activeTab === 'developer' ? 'active' : ''}`} onClick={() => setActiveTab('developer')}>
          Developer Sandbox
        </button>
        <button className={`tab-btn ${activeTab === 'admin' ? 'active' : ''}`} onClick={() => setActiveTab('admin')}>
          Admin Telemetry
        </button>
        <button className={`tab-btn ${activeTab === 'mcp' ? 'active' : ''}`} onClick={() => setActiveTab('mcp')}>
          MCP Server Connect
        </button>
      </nav>

      {/* Connection Drawer */}
      <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D} style={{ padding: '16px', marginBottom: '32px', borderStyle: 'dashed' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--accent-cyan)' }}>
          ⚙️ Live Environment Endpoint Connections
        </h4>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '250px' }}>
            <label className="form-label">Gateway Service Engine URL</label>
            <input 
              type="text" 
              className="form-control" 
              style={{ padding: '6px 12px', fontSize: '0.85rem' }} 
              value={gatewayUrl} 
              onChange={(e) => setGatewayUrl(e.target.value)} 
            />
          </div>
          <div style={{ flex: 1, minWidth: '250px' }}>
            <label className="form-label">n8n Registration Webhook Endpoint</label>
            <input 
              type="text" 
              className="form-control" 
              style={{ padding: '6px 12px', fontSize: '0.85rem' }} 
              value={n8nUrl} 
              onChange={(e) => setN8nUrl(e.target.value)} 
            />
          </div>
        </div>
      </div>

      {/* ----------------- TAB: DEVELOPER SANDBOX ----------------- */}
      {activeTab === 'developer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          
          {/* Interactive Request Flow Visualizer */}
          <div className="glass-panel pipeline-card card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
            <h3>🧬 Interactive API Request Pipeline Visualizer</h3>
            <p style={{ color: 'var(--text-dim)', marginBottom: '16px', fontSize: '0.82rem' }}>
              Real-time architectural route tracking. Fires whenever requests cross the security gateway boundary.
            </p>

            <svg className="pipeline-svg" viewBox="0 0 800 120" preserveAspectRatio="xMidYMid meet">
              {/* Connection Pipes */}
              <line 
                x1="100" y1="60" x2="280" y2="60" 
                className={`pipe-line ${pipelineState !== 'idle' ? 'active' : ''} ${pipelineState === 'blocked_403' ? 'error' : ''} ${['success_200', 'blocked_429', 'unauthorized_401'].includes(pipelineState) ? 'success' : ''}`}
              />
              <line 
                x1="280" y1="60" x2="480" y2="60" 
                className={`pipe-line ${['sending', 'success_200', 'blocked_429', 'unauthorized_401'].includes(pipelineState) ? 'active' : ''} ${['success_200', 'blocked_429', 'unauthorized_401'].includes(pipelineState) ? 'success' : ''}`}
              />
              <line 
                x1="480" y1="60" x2="660" y2="60" 
                className={`pipe-line ${pipelineState === 'success_200' ? 'success' : ''} ${pipelineState === 'blocked_429' ? 'error' : ''} ${pipelineState === 'unauthorized_401' ? 'warning' : ''}`}
              />

              {/* Dynamic pulse overlays */}
              {pipelineState === 'sending' && (
                <path d="M 100 60 L 660 60" fill="none" stroke="var(--accent-cyan)" strokeWidth="4" className="pipe-flow-pulse" />
              )}
              {pipelineState === 'success_200' && (
                <path d="M 100 60 L 660 60" fill="none" stroke="var(--accent-green)" strokeWidth="4" className="pipe-flow-pulse" />
              )}

              {/* Node 1: Client / Sandbox */}
              <circle cx="100" cy="60" r="24" className={`pipe-node-bg ${pipelineState !== 'idle' ? 'active' : ''}`} />
              <text x="100" y="64" textAnchor="middle" fill="#fff" fontFamily="var(--font-mono)" fontSize="16" fontWeight="bold">&gt;_</text>
              <text x="100" y="100" className="pipe-text-label" textAnchor="middle">Sandbox Client</text>
              <text x="100" y="112" className="pipe-text-sub" textAnchor="middle">Host: localhost</text>

              {/* Node 2: IP Blacklist middleware */}
              <circle cx="280" cy="60" r="24" className={`pipe-node-bg ${pipelineState === 'blocked_403' ? 'error' : ''} ${['success_200', 'blocked_429', 'unauthorized_401'].includes(pipelineState) ? 'success' : ''}`} />
              <text x="280" y="64" textAnchor="middle" fill="#fff" fontSize="14">🛡️</text>
              <text x="280" y="100" className="pipe-text-label" textAnchor="middle">IP Guard</text>
              <text x="280" y="112" className="pipe-text-sub" textAnchor="middle">{currentBlacklist.length} Blocked IPs</text>

              {/* Node 3: Redis token-bucket rate limiter */}
              <circle cx="480" cy="60" r="24" className={`pipe-node-bg ${pipelineState === 'blocked_429' ? 'error' : ''} ${pipelineState === 'unauthorized_401' ? 'warning' : ''} ${pipelineState === 'success_200' ? 'success' : ''}`} />
              <text x="480" y="64" textAnchor="middle" fill="#fff" fontSize="14">⚡</text>
              <text x="480" y="100" className="pipe-text-label" textAnchor="middle">Limiter Engine</text>
              <text x="480" y="112" className="pipe-text-sub" textAnchor="middle">Redis Lua Script</text>

              {/* Node 4: Downstream target */}
              <circle cx="660" cy="60" r="24" className={`pipe-node-bg ${pipelineState === 'success_200' ? 'success' : ''}`} />
              <text x="660" y="64" textAnchor="middle" fill="#fff" fontSize="14">📁</text>
              <text x="660" y="100" className="pipe-text-label" textAnchor="middle">Target API</text>
              <text x="660" y="112" className="pipe-text-sub" textAnchor="middle">/downstream/res</text>
            </svg>
          </div>

          {/* Preset Automation Scenarios */}
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--accent-cyan)' }}>
              🤖 Preset Automation Scenario Scenarios (Interactive Recruiter Sandbox)
            </h4>
            <div className="scenario-selector">
              <button 
                className={`scenario-button ${activeScenario === 'steady' ? 'active' : ''}`}
                onClick={() => triggerScenario('steady')}
              >
                <div className="scenario-button-title">🟢 Steady Traffic Flow</div>
                <div className="scenario-button-desc">
                  Triggers 10 requests spacing out 1.5s. Simulates steady normal client requests, demonstrating token bucket refilling.
                </div>
              </button>
              
              <button 
                className={`scenario-button ${activeScenario === 'ddos' ? 'active' : ''}`}
                onClick={() => triggerScenario('ddos')}
              >
                <div className="scenario-button-title">🔴 DDoS Abuse & Auto-Block</div>
                <div className="scenario-button-desc">
                  Rapid traffic triggers rate limiters. Simulated n8n cron workflow catches the abusive IP and blocks it at the firewall node.
                </div>
              </button>

              <button 
                className={`scenario-button ${activeScenario === 'auth' ? 'active' : ''}`}
                onClick={() => triggerScenario('auth')}
              >
                <div className="scenario-button-title">🟡 Authentication Scan Sweep</div>
                <div className="scenario-button-desc">
                  Simulates dictionary brute force attacks with random invalid API keys, illustrating metrics counting database blocks.
                </div>
              </button>
            </div>
          </div>

          {/* Sandbox Core Grid */}
          <div className="dashboard-layout">
            {/* Forms Panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Developer Key Registration */}
              <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
                <h3>🔑 Register Developer API Access</h3>
                <p style={{ color: 'var(--text-dim)', marginBottom: '20px', fontSize: '0.85rem' }}>
                  Registers a key in Redis. This form simulates the developer registration workflow managed by n8n.
                </p>
                
                <form onSubmit={handleOnboarding}>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">Developer name</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="e.g. Mithil Gala"
                        value={devName} 
                        onChange={(e) => setDevName(e.target.value)} 
                        required
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">Email address</label>
                      <input 
                        type="email" 
                        className="form-control" 
                        placeholder="e.g. dev@mithil.com"
                        value={devEmail} 
                        onChange={(e) => setDevEmail(e.target.value)} 
                        required
                      />
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <label className="form-label">Request Quota Cap</label>
                      <select 
                        className="form-control" 
                        value={devLimit} 
                        onChange={(e) => setDevLimit(parseInt(e.target.value))}
                      >
                        <option value={10}>10 requests / min (Dev strict)</option>
                        <option value={60}>60 requests / min (Standard)</option>
                        <option value={120}>120 requests / min (SaaS burst)</option>
                      </select>
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ height: '42px' }} disabled={onboardingLoading}>
                      {onboardingLoading ? 'Registering...' : 'Request Credentials'}
                    </button>
                  </div>
                </form>

                {generatedKey && (
                  <div style={{ marginTop: '20px', padding: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--accent-cyan)' }}>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                      ✓ Generated Token Registered successfully:
                    </span>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px' }}>
                      <code style={{ fontSize: '0.9rem', color: '#fff', wordBreak: 'break-all', flex: 1 }}>{generatedKey}</code>
                      <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => {
                        navigator.clipboard.writeText(generatedKey);
                        addConsoleLog('SYS', 'API Key copied to system clipboard.', 200);
                      }}>
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Endpoint Tester */}
              <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
                <h3>📡 API Gateway Endpoint Sandbox Tester</h3>
                <p style={{ color: 'var(--text-dim)', marginBottom: '20px', fontSize: '0.85rem' }}>
                  Execute calls against rate limited gateway routes to test key rules.
                </p>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label">Active Credentials API Key</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="Enter api key..." 
                    value={testApiKey}
                    onChange={(e) => setTestApiKey(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label">Route Selection</label>
                  <select 
                    className="form-control" 
                    value={testEndpoint} 
                    onChange={(e) => setTestEndpoint(e.target.value)}
                  >
                    <option value="/api/v1/resource">GET /api/v1/resource (Internal resource mock)</option>
                    <option value="/api/v1/info">GET /api/v1/info (Metadata server statistics)</option>
                    <option value="/api/v1/missing">GET /api/v1/missing (Gateway error path - 404)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn btn-primary" onClick={() => runTestRequest()} disabled={testerLoading || !testApiKey}>
                    {testerLoading ? 'Sending...' : 'Send Request'}
                  </button>
                  <button className="btn btn-danger" onClick={() => triggerScenario('ddos')} disabled={activeScenario !== 'none' || !testApiKey}>
                    Run Stress Test Burst
                  </button>
                </div>

                {testResponse && (
                  <div style={{ marginTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '0.85rem' }}>Header Telemetry</h4>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '0.8rem' }}>
                        <span>Status: <strong className={testResponse.status === 200 ? 'console-status s200' : 'console-status s429'}>{testResponse.status}</strong></span>
                        <span>Latency: <strong style={{ color: 'var(--accent-cyan)' }}>{testResponse.duration}</strong></span>
                      </div>
                    </div>
                    
                    {testResponse.headers && (
                      <div style={{ display: 'flex', gap: '16px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-color)', marginBottom: '8px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                        <div>Quota-Limit: <span style={{ color: '#fff' }}>{testResponse.headers['x-ratelimit-limit'] || 'N/A'}</span></div>
                        <div>Remaining: <span style={{ color: '#fff' }}>{testResponse.headers['x-ratelimit-remaining'] !== undefined ? testResponse.headers['x-ratelimit-remaining'] : 'N/A'}</span></div>
                      </div>
                    )}

                    <pre style={{ margin: 0, padding: '12px', backgroundColor: '#050608', border: '1px solid var(--border-color)', borderRadius: '6px', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#10b981', textAlign: 'left', maxHeight: '150px' }}>
                      {JSON.stringify(testResponse.body, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Terminal logs & Matrix Panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Terminal logs */}
              <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D} style={{ padding: '16px' }}>
                <div className="console-wrapper">
                  <div className="console-header" style={{ padding: '8px 16px' }}>
                    <div className="console-actions">
                      <span className="dot red"></span>
                      <span className="dot yellow"></span>
                      <span className="dot green"></span>
                    </div>
                    <span className="console-title" style={{ fontSize: '0.8rem' }}>apishield-proxy.log</span>
                  </div>
                  <div className="console-body" style={{ height: '200px', padding: '12px' }}>
                    {consoleLogs.map((log, i) => (
                      <div key={i} className="console-line" style={{ fontSize: '0.8rem', marginBottom: '6px' }}>
                        <span className="console-time">[{log.time}]</span>
                        <span className={`console-method ${log.method}`} style={{ fontSize: '0.75rem' }}>{log.method}</span>
                        <span className="console-message">{log.message}</span>
                        <span className={`console-status s${log.status}`} style={{ fontSize: '0.75rem' }}>{log.status}</span>
                      </div>
                    ))}
                    <div ref={consoleEndRef} />
                  </div>
                </div>
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', marginTop: '12px', fontSize: '0.75rem', padding: '6px' }}
                  onClick={() => setConsoleLogs([{ time: new Date().toLocaleTimeString(), method: 'SYS', message: 'Terminal cleared.', status: 200 }])}
                >
                  Clear Log
                </button>
              </div>

              {/* Node Topology */}
              <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D} style={{ padding: '16px' }}>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: 'var(--accent-cyan)' }}>🧬 Token Bucket Topology matrix</h4>
                <p style={{ color: 'var(--text-dim)', margin: '0 0 12px 0', fontSize: '0.78rem' }}>
                  Visual hash vectors: Green (200 OK), Amber (401 Bad API Key), Red (429 Rate Block).
                </p>
                <div className="traffic-matrix" style={{ gap: '6px' }}>
                  {matrixNodes.map((node, i) => (
                    <div key={i} className={`matrix-node ${node || ''}`} style={{ borderRadius: '1px' }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- TAB: ADMIN TELEMETRY ----------------- */}
      {activeTab === 'admin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          
          {/* Operational Metrics Cards */}
          <div className="metrics-grid" style={{ marginBottom: 0 }}>
            <div className="glass-panel metric-card card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <span className="metric-label">Gateway API Traffic</span>
              <div className="metric-value">{activeMetrics.totalRequests}</div>
              <span className="metric-footer">Cumulative transaction count</span>
            </div>
            
            <div className="glass-panel metric-card rate-limited card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <span className="metric-label" style={{ color: 'var(--danger)' }}>Rate Blocks (429)</span>
              <div className="metric-value" style={{ color: 'var(--danger)' }}>{activeMetrics.rateLimited}</div>
              <span className="metric-footer">Intercepted by token bucket policy</span>
            </div>

            <div className="glass-panel metric-card unauthorized card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <span className="metric-label" style={{ color: 'var(--warning)' }}>Key Failures (401/403)</span>
              <div className="metric-value" style={{ color: 'var(--warning)' }}>{activeMetrics.unauthorized}</div>
              <span className="metric-footer">Blocked auth credentials</span>
            </div>
          </div>

          {/* SVG Sparklines & Bar Telemetry */}
          <div className="telemetry-charts-grid">
            {/* Sparkline for traffic rate */}
            <div className="glass-panel telemetry-chart-card card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent-cyan)' }}>📈 Request Rate Timeline</h4>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-dim)' }}>Requests per second (rolling 15s window)</p>
              
              <svg className="telemetry-svg" viewBox="0 0 300 80">
                {/* Grid Lines */}
                <line x1="0" y1="20" x2="300" y2="20" className="chart-grid-line" />
                <line x1="0" y1="40" x2="300" y2="40" className="chart-grid-line" />
                <line x1="0" y1="60" x2="300" y2="60" className="chart-grid-line" />
                
                {/* Draw Area path */}
                {(() => {
                  const maxRps = Math.max(3, ...rpsHistory);
                  const coords = rpsHistory.map((val, i) => {
                    const x = i * (300 / 14);
                    const y = 70 - (val / maxRps) * 55;
                    return { x, y };
                  });
                  const pathD = coords.reduce((acc, c, i) => acc + (i === 0 ? `M ${c.x} ${c.y}` : ` L ${c.x} ${c.y}`), '');
                  const areaD = pathD ? `${pathD} L 300 70 L 0 70 Z` : '';
                  return (
                    <>
                      {areaD && <path d={areaD} className="sparkline-area" />}
                      {pathD && <path d={pathD} className="sparkline-path" />}
                    </>
                  );
                })()}

                {/* Legend details */}
                <text x="5" y="15" className="chart-axis-text" fill="var(--text-dim)">{Math.max(3, ...rpsHistory)} rps</text>
                <text x="5" y="75" className="chart-axis-text" fill="var(--text-dim)">0 rps</text>
              </svg>
            </div>

            {/* Bar Chart for Latencies */}
            <div className="glass-panel telemetry-chart-card card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent-cyan)' }}>⏳ Transaction Latencies</h4>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-dim)' }}>Execution time per transaction (last 15 calls)</p>
              
              <svg className="telemetry-svg" viewBox="0 0 300 80">
                <line x1="0" y1="20" x2="300" y2="20" className="chart-grid-line" />
                <line x1="0" y1="40" x2="300" y2="40" className="chart-grid-line" />
                <line x1="0" y1="60" x2="300" y2="60" className="chart-grid-line" />

                {latencyHistory.map((item, i) => {
                  const barWidth = 12;
                  const spacing = (300 - (15 * barWidth)) / 16;
                  const x = spacing + i * (barWidth + spacing);
                  const maxLat = Math.max(150, ...latencyHistory.map(h => h.latency));
                  const barHeight = (item.latency / maxLat) * 55;
                  const y = 70 - barHeight;

                  return (
                    <g key={i}>
                      <rect 
                        x={x} 
                        y={y} 
                        width={barWidth} 
                        height={Math.max(2, barHeight)} 
                        className={`chart-bar-item s${item.status}`} 
                      />
                      <title>{`Latency: ${item.latency}ms, Status: ${item.status}`}</title>
                    </g>
                  );
                })}

                <text x="5" y="15" className="chart-axis-text" fill="var(--text-dim)">{Math.max(150, ...latencyHistory.map(h => h.latency))}ms</text>
                <text x="5" y="75" className="chart-axis-text" fill="var(--text-dim)">0ms</text>
              </svg>
            </div>
          </div>

          {/* Redis Database Inspector Panel */}
          <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
            <h3 style={{ borderLeftColor: 'var(--accent-cyan)' }}>📦 Live Redis Keyspace Inspector</h3>
            <p style={{ color: 'var(--text-dim)', marginBottom: '16px', fontSize: '0.85rem' }}>
              Inspect structural schemas stored directly inside memory. Select keys in the sidebar to review active state variables.
            </p>

            <div className="redis-inspector-card">
              {/* Sidebar list of keys */}
              <div className="redis-keys-sidebar">
                {Object.keys(redisKeysMap).map(key => {
                  const keyType = redisKeysMap[key].type;
                  return (
                    <div 
                      key={key} 
                      className={`redis-key-node ${selectedRedisKey === key ? 'active' : ''}`}
                      onClick={() => setSelectedRedisKey(key)}
                    >
                      <span className="redis-key-name">{key}</span>
                      <span className={`key-badge ${keyType}`}>{keyType}</span>
                    </div>
                  );
                })}
                {/* Dynamically register custom credentials if they are active */}
                {generatedKey && !Object.keys(redisKeysMap).includes(`rate:limit:${generatedKey}`) && (
                  <div 
                    className={`redis-key-node ${selectedRedisKey === `rate:limit:${generatedKey}` ? 'active' : ''}`}
                    onClick={() => setSelectedRedisKey(`rate:limit:${generatedKey}`)}
                  >
                    <span className="redis-key-name" style={{ color: 'var(--accent-green)' }}>{`rate:limit:${generatedKey.substring(0, 14)}...`}</span>
                    <span className="key-badge hash">hash</span>
                  </div>
                )}
              </div>

              {/* JSON code representation */}
              <div className="redis-inspect-content">
                {selectedRedisKey ? (
                  <>
                    <div style={{ position: 'absolute', top: '8px', right: '12px', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                      TTL: 86400s (1 Day)
                    </div>
                    <pre style={{ margin: 0, color: 'var(--accent-green)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {(() => {
                        let dataToRender;
                        if (selectedRedisKey === `rate:limit:${generatedKey}`) {
                          dataToRender = gatewayConnected ? { info: "Live telemetry synchronized" } : simulatedKeys[generatedKey];
                        } else {
                          dataToRender = redisKeysMap[selectedRedisKey]?.value;
                        }
                        return JSON.stringify(dataToRender, null, 2);
                      })()}
                    </pre>
                  </>
                ) : (
                  <div className="redis-inspect-placeholder">Select a redis cache namespace keys to inspect value...</div>
                )}
              </div>
            </div>
          </div>

          {/* Table Transactions Split */}
          <div className="dashboard-layout">
            {/* Live Traffic Stream */}
            <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <h3>📈 Operational Transaction Logs</h3>
              <p style={{ color: 'var(--text-dim)', marginBottom: '16px', fontSize: '0.85rem' }}>
                Log audit tracking. Pulls metrics from backend proxy history.
              </p>
              
              <div className="data-table-wrapper" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Method & Path</th>
                      <th>Client IP</th>
                      <th>Identity Name</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRecentLogs.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>
                          No request transaction streams logged yet. Execute tests in Sandbox tab.
                        </td>
                      </tr>
                    ) : (
                      currentRecentLogs.map((log, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: '0.8rem' }}>
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </td>
                          <td>
                            <span className="console-method GET" style={{ marginRight: '6px', padding: '1px 4px', fontSize: '0.72rem' }}>
                              GET
                            </span>
                            <code style={{ background: 'none', padding: 0 }}>{log.path}</code>
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                            {log.ip}
                          </td>
                          <td>
                            <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{log.keyName}</span>
                          </td>
                          <td>
                            <strong className={log.status === 200 ? 'console-status s200' : 'console-status s429'}>
                              {log.status}
                            </strong>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Blacklist Administration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Manually Block IP */}
              <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
                <h3>🚫 Access IP Block Control</h3>
                <p style={{ color: 'var(--text-dim)', marginBottom: '12px', fontSize: '0.82rem' }}>
                  Write IPs to block state. Blocked IPs are dropped with a 403 Forbidden intercept.
                </p>
                
                <form onSubmit={blockIpAddress} style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g. 198.51.100.42"
                    value={newBlockIp} 
                    onChange={(e) => setNewBlockIp(e.target.value)} 
                    required
                    style={{ fontSize: '0.85rem' }}
                  />
                  <button type="submit" className="btn btn-danger" style={{ padding: '0 16px', fontSize: '0.85rem' }}>
                    Block
                  </button>
                </form>
              </div>

              {/* Active Blacklist View */}
              <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
                <h4>Active Firewall Blacklist ({currentBlacklist.length})</h4>
                <div className="data-table-wrapper" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>IP Address</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentBlacklist.length === 0 ? (
                        <tr>
                          <td colSpan="2" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '16px' }}>
                            Firewall blacklist database is empty.
                          </td>
                        </tr>
                      ) : (
                        currentBlacklist.map((ip, i) => (
                          <tr key={i}>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{ip}</td>
                            <td style={{ textAlign: 'right', padding: '6px 16px' }}>
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '2px 8px', fontSize: '0.72rem', borderColor: 'var(--success)' }}
                                onClick={() => unblockIpAddress(ip)}
                              >
                                Restore
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- TAB: MCP SERVER CONNECT ----------------- */}
      {activeTab === 'mcp' && (
        <div className="glass-panel docs-block card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
          <h3>🔌 Model Context Protocol (MCP) Integration Engine</h3>
          <p style={{ color: 'var(--text-primary)', marginBottom: '24px', lineHeight: 1.6 }}>
            APIShield exposes an official **Model Context Protocol (MCP)** endpoint that allows AI assistants (like Claude Desktop or Cursor IDE) to orchestrate administration tasks automatically using natural language instructions.
          </p>

          <h2>Configuring Claude Desktop integration</h2>
          <p style={{ color: 'var(--text-dim)' }}>
            Add the following server mapping to your `claude_desktop_config.json` configuration file:
          </p>
          <pre style={{ fontSize: '0.82rem', textAlign: 'left' }}>{`%APPDATA%\\Claude\\claude_desktop_config.json (Windows)
~/Library/Application Support/Claude/claude_desktop_config.json (macOS)`}</pre>
          
          <pre style={{ color: 'var(--accent-cyan)', textAlign: 'left', fontSize: '0.82rem' }}>{`{
  "mcpServers": {
    "apishield-admin": {
      "command": "node",
      "args": [
        "d:/smart-gateway-mcp/mcp-server/index.js"
      ],
      "env": {
        "REDIS_URL": "redis://localhost:6379",
        "TRANSPORT": "stdio"
      }
    }
  }
}`}</pre>
 
          <h2 style={{ marginTop: '32px' }}>Configuring Cursor IDE integration</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '12px' }}>
            Navigate to: Settings ➔ Features ➔ MCP ➔ + Add New MCP Server
          </p>
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.01)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '24px', fontSize: '0.85rem' }}>
            <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li><strong>Server name:</strong> <code style={{ color: '#fff' }}>apishield-admin</code></li>
              <li><strong>Transport Type:</strong> <code style={{ color: '#fff' }}>stdio</code></li>
              <li><strong>Execution Command:</strong> <code style={{ color: '#fff' }}>node d:/smart-gateway-mcp/mcp-server/index.js</code></li>
            </ul>
          </div>

          <h2>Orchestration Commands to try with your agent:</h2>
          <pre style={{ color: 'var(--accent-purple)', textAlign: 'left', fontSize: '0.85rem', lineHeight: 1.5 }}>
{`• "Show the active IP blacklist records from apishield-admin."
• "Tell apishield-admin to blacklist the malicious IP address 198.51.100.80."
• "Check key rate limit statistics for the API Gateway."
• "Update the rate quota size for developer apishield_dev_xxx..."`}
          </pre>
        </div>
      )}
    </div>
  );
}

export default App;
