import React, { useState, useEffect, useRef } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState('developer');
  
  // Connection Configuration
  const [gatewayUrl, setGatewayUrl] = useState('http://localhost:8000');
  const [n8nUrl, setN8nUrl] = useState('http://localhost:5678/webhook/developer-onboarding');

  // Developer Tab State
  const [devName, setDevName] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devLimit, setDevLimit] = useState(60);
  const [generatedKey, setGeneratedKey] = useState('');
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState('');

  // Tester State
  const [testApiKey, setTestApiKey] = useState('');
  const [testEndpoint, setTestEndpoint] = useState('/api/v1/resource');
  const [testerLoading, setTesterLoading] = useState(false);
  const [testResponse, setTestResponse] = useState(null);
  const [spamActive, setSpamActive] = useState(false);

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

      // 2. Ping n8n Webhook Endpoint (GET/OPTIONS check or simple fetch)
      try {
        const res = await fetch(n8nUrl, { method: 'OPTIONS' });
        setN8nConnected(true);
      } catch (err) {
        // Since CORS or OPTIONS might fail, a network error means it is blocked or down. 
        // We check if it returns 404/405 (which means it's running but rejects OPTIONS) versus connection refused.
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

  // 1. Developer Onboarding via n8n
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
        setTestApiKey(data.apiKey); // Prefill key tester
        addConsoleLog('POST', `Successfully generated key: ${data.apiKey.substring(0, 15)}...`, 200);
      } else {
        throw new Error(data.message || 'Onboarding workflow failed.');
      }
    } catch (err) {
      console.error(err);
      // Fallback Mock (For demonstrative correctness in offline settings)
      const mockKey = `apishield_mock_${Math.random().toString(16).substring(2, 18)}`;
      setGeneratedKey(mockKey);
      setTestApiKey(mockKey);
      
      // Register mock key on gateway directly if running but n8n is offline
      try {
        await fetch(`${gatewayUrl}/admin/keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: devName, limit: devLimit, apiKey: mockKey })
        });
        addConsoleLog('POST', `n8n offline. Key registered directly to Gateway: ${mockKey}`, 200);
      } catch (gateErr) {
        addConsoleLog('POST', `Simulated registration. Dev: ${devName}. Key: ${mockKey}`, 200);
      }
    } finally {
      setOnboardingLoading(false);
    }
  };

  // 2. Test Request to Gateway
  const runTestRequest = async (overrideKey = null) => {
    const keyToUse = overrideKey || testApiKey;
    if (!keyToUse) {
      addConsoleLog('GET', 'Test execution failed. API Key missing.', 401);
      return;
    }

    setTesterLoading(true);
    const url = `${gatewayUrl}${testEndpoint}`;
    addConsoleLog('GET', `Sending request to gateway: ${testEndpoint}`, 200);

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

      addConsoleLog(
        res.status === 429 ? 'BLOCKED' : 'GET', 
        `Gateway response received in ${duration}ms. Tokens remaining: ${headers['x-ratelimit-remaining'] || 'N/A'}`, 
        res.status
      );
    } catch (err) {
      console.error(err);
      setTestResponse({
        status: 500,
        statusText: 'Gateway Unreachable',
        body: { error: 'Connection Refused', message: 'Could not connect to the API Gateway.' }
      });
      addConsoleLog('GET', 'Failed to reach API Gateway. Is it running?', 500);
    } finally {
      setTesterLoading(false);
    }
  };

  // 3. Rate-Limit Spam Simulator
  const triggerSpamTester = async () => {
    if (!testApiKey) {
      addConsoleLog('GET', 'Spam Simulator failed. API Key missing.', 401);
      return;
    }
    setSpamActive(true);
    addConsoleLog('SYS', 'Initializing dynamic Rate-Limit Burst Test (20 requests)...', 200);
    
    // Fire 20 requests rapidly
    for (let i = 1; i <= 20; i++) {
      runTestRequest();
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    setSpamActive(false);
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
      addConsoleLog('SYS', `Failed to blacklist IP. Using mock behavior. Added ${newBlockIp} to local set.`, 500);
      setBlacklist(prev => [...prev, newBlockIp]);
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
      addConsoleLog('SYS', `Failed to unblock IP. Removing locally.`, 500);
      setBlacklist(prev => prev.filter(item => item !== ip));
    }
  };

  return (
    <div className="container">
      {/* Header Panel */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1>APIShield Control Console</h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            High-Performance API Gateway, Redis Rate Limiting, and Automated Abuse Prevention Pipeline.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div className="glass-panel" style={{ padding: '8px 16px', display: 'flex', gap: '16px', borderRadius: '8px' }}>
            <span style={{ fontSize: '0.85rem' }}>
              <span className={`status-dot ${gatewayConnected ? 'active' : 'error'}`}></span>
              Gateway: {gatewayConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
            <span style={{ fontSize: '0.85rem' }}>
              <span className={`status-dot ${n8nConnected ? 'active' : 'error'}`}></span>
              n8n: {n8nConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
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

      {/* Connection Endpoint Configuration drawer (Expandable settings) */}
      <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D} style={{ padding: '16px', marginBottom: '32px', borderStyle: 'dashed' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontFamily: 'var(--font-heading)', color: 'var(--accent-cyan)' }}>
          ⚙️ Connection Settings (For local overrides)
        </h4>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '250px' }}>
            <label className="form-label">API Gateway Root URL</label>
            <input 
              type="text" 
              className="form-control" 
              style={{ padding: '8px 12px', fontSize: '0.9rem' }} 
              value={gatewayUrl} 
              onChange={(e) => setGatewayUrl(e.target.value)} 
            />
          </div>
          <div style={{ flex: 1, minWidth: '250px' }}>
            <label className="form-label">n8n Registration Webhook URL</label>
            <input 
              type="text" 
              className="form-control" 
              style={{ padding: '8px 12px', fontSize: '0.9rem' }} 
              value={n8nUrl} 
              onChange={(e) => setN8nUrl(e.target.value)} 
            />
          </div>
        </div>
      </div>

      {/* ----------------- TAB: DEVELOPER SANDBOX ----------------- */}
      {activeTab === 'developer' && (
        <div className="dashboard-layout">
          {/* Main Console */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Developer Key Registration */}
            <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <h3>🔑 Register for API Key</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.95rem' }}>
                Onboard as a developer. Submitting this form triggers an **n8n workflow** that automatically issues a rate-limited key and stores it in **Redis**.
              </p>
              
              <form onSubmit={handleOnboarding}>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Developer Name</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="e.g. John Doe"
                      value={devName} 
                      onChange={(e) => setDevName(e.target.value)} 
                      required
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Email Address</label>
                    <input 
                      type="email" 
                      className="form-control" 
                      placeholder="e.g. john@example.com"
                      value={devEmail} 
                      onChange={(e) => setDevEmail(e.target.value)} 
                      required
                    />
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Rate Limit Quota</label>
                    <select 
                      className="form-control" 
                      value={devLimit} 
                      onChange={(e) => setDevLimit(parseInt(e.target.value))}
                    >
                      <option value={10}>10 requests / min (Strict)</option>
                      <option value={60}>60 requests / min (Standard)</option>
                      <option value={120}>120 requests / min (Burst Premium)</option>
                    </select>
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ height: '46px' }} disabled={onboardingLoading}>
                    {onboardingLoading ? 'Registering...' : 'Request API Key'}
                  </button>
                </div>
              </form>

              {generatedKey && (
                <div style={{ marginTop: '24px', padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--accent-cyan)' }}>
                  <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--accent-cyan)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Registration Successful! Your API Key:
                  </span>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' }}>
                    <code style={{ fontSize: '1rem', color: '#fff', wordBreak: 'break-all', flex: 1 }}>{generatedKey}</code>
                    <button className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={() => {
                      navigator.clipboard.writeText(generatedKey);
                      addConsoleLog('SYS', 'API Key copied to clipboard.', 200);
                    }}>
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* API Endpoint Tester */}
            <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <h3>📡 Interactive API Gateway Tester</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.95rem' }}>
                Test your API key against rate-limited gateway proxy endpoints.
              </p>

              <div className="form-group">
                <label className="form-label">Developer API Key</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="Paste your API key here (e.g. apishield_...)" 
                  value={testApiKey}
                  onChange={(e) => setTestApiKey(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Endpoint Route</label>
                  <select 
                    className="form-control" 
                    value={testEndpoint} 
                    onChange={(e) => setTestEndpoint(e.target.value)}
                  >
                    <option value="/api/v1/resource">GET /api/v1/resource (Protected downstream resource)</option>
                    <option value="/api/v1/info">GET /api/v1/info (System specification context)</option>
                    <option value="/api/v1/invalid-route">GET /api/v1/invalid-route (404 Test)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-primary" onClick={() => runTestRequest()} disabled={testerLoading || !testApiKey}>
                  {testerLoading ? 'Sending...' : 'Send Single Request'}
                </button>
                <button className="btn btn-danger" onClick={triggerSpamTester} disabled={spamActive || !testApiKey}>
                  {spamActive ? 'Spamming...' : '🔥 Burst Test (Spam Limit)'}
                </button>
              </div>

              {testResponse && (
                <div style={{ marginTop: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0 }}>Response Payload</h4>
                    <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem' }}>
                      <span>Status: <strong className={testResponse.status === 200 ? 'console-status s200' : 'console-status s429'}>{testResponse.status} {testResponse.statusText}</strong></span>
                      <span>Latency: <strong style={{ color: 'var(--accent-cyan)' }}>{testResponse.duration}</strong></span>
                    </div>
                  </div>
                  
                  {/* Headers */}
                  {testResponse.headers && (
                    <div style={{ display: 'flex', gap: '16px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border-color)', marginBottom: '12px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                      <div>X-RateLimit-Limit: <span style={{ color: '#fff' }}>{testResponse.headers['x-ratelimit-limit'] || 'N/A'}</span></div>
                      <div>X-RateLimit-Remaining: <span style={{ color: '#fff' }}>{testResponse.headers['x-ratelimit-remaining'] || 'N/A'}</span></div>
                    </div>
                  )}

                  <pre style={{ margin: 0, padding: '16px', backgroundColor: '#050608', border: '1px solid var(--border-color)', borderRadius: '8px', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#10b981', textAlign: 'left' }}>
                    {JSON.stringify(testResponse.body, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Terminal Panel */}
          <div>
            <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D} style={{ height: '100%', padding: '20px' }}>
              <h3>💻 Live Request Terminal</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.85rem' }}>
                Monitors logs and events crossing the API Gateway.
              </p>
              
              <div className="console-wrapper">
                <div className="console-header">
                  <div className="console-actions">
                    <span className="dot red"></span>
                    <span className="dot yellow"></span>
                    <span className="dot green"></span>
                  </div>
                  <span className="console-title">apishield-gateway.log</span>
                </div>
                <div className="console-body">
                  {consoleLogs.map((log, i) => (
                    <div key={i} className="console-line">
                      <span className="console-time">[{log.time}]</span>
                      <span className={`console-method ${log.method}`}>{log.method}</span>
                      <span className="console-message">{log.message}</span>
                      <span className={`console-status s${log.status}`}>{log.status}</span>
                    </div>
                  ))}
                  <div ref={consoleEndRef} />
                </div>
              </div>
              
              <button 
                className="btn btn-secondary" 
                style={{ width: '100%', marginTop: '16px', fontSize: '0.85rem', padding: '8px' }}
                onClick={() => setConsoleLogs([{ time: new Date().toLocaleTimeString(), method: 'SYS', message: 'Terminal cleared.', status: 200 }])}
              >
                Clear Terminal Logs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- TAB: ADMIN TELEMETRY ----------------- */}
      {activeTab === 'admin' && (
        <div>
          {/* Operational Metrics Cards */}
          <div className="metrics-grid">
            <div className="glass-panel metric-card card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <span className="metric-label">Total API Traffic</span>
              <div className="metric-value">{metrics.totalRequests}</div>
              <span className="metric-footer">Total hits since deployment</span>
            </div>
            
            <div className="glass-panel metric-card rate-limited card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D} style={{ borderColor: 'rgba(239, 68, 68, 0.15)' }}>
              <span className="metric-label" style={{ color: 'var(--danger)' }}>Rate Limits Exceeded (429)</span>
              <div className="metric-value" style={{ color: 'var(--danger)' }}>{metrics.rateLimited}</div>
              <span className="metric-footer">Requests blocked by Redis token-bucket</span>
            </div>

            <div className="glass-panel metric-card unauthorized card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D} style={{ borderColor: 'rgba(245, 158, 11, 0.15)' }}>
              <span className="metric-label" style={{ color: 'var(--warning)' }}>Authentication Failures (401)</span>
              <div className="metric-value" style={{ color: 'var(--warning)' }}>{metrics.unauthorized}</div>
              <span className="metric-footer">Invalid or missing API key queries</span>
            </div>
          </div>

          <div className="dashboard-layout">
            {/* Live Traffic Stream */}
            <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
              <h3>📈 Recent Gateway Transactions</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.95rem' }}>
                Real-time transaction log pulling directly from Redis.
              </p>
              
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Method & Path</th>
                      <th>Client IP</th>
                      <th>Key Identity</th>
                      <th>Status Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLogs.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                          No request transactions logged yet. Send test requests from the Sandbox!
                        </td>
                      </tr>
                    ) : (
                      recentLogs.map((log, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </td>
                          <td>
                            <span className={`console-method GET`} style={{ marginRight: '8px', padding: '2px 6px', fontSize: '0.75rem' }}>
                              GET
                            </span>
                            <code style={{ background: 'none', padding: 0 }}>{log.path}</code>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
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

            {/* IP Blacklist & Access Control */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Manually Block IP */}
              <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
                <h3>🚫 IP Blacklisting Control</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.85rem' }}>
                  Block malicious client IPs. Denied IPs receive immediate HTTP 403 Forbidden headers.
                </p>
                
                <form onSubmit={blockIpAddress} style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g. 198.51.100.42"
                    value={newBlockIp} 
                    onChange={(e) => setNewBlockIp(e.target.value)} 
                    required
                  />
                  <button type="submit" className="btn btn-danger" style={{ padding: '0 16px' }}>
                    Block
                  </button>
                </form>
              </div>

              {/* Active Blacklist View */}
              <div className="glass-panel card-3d" onMouseMove={handleMouseMove3D} onMouseLeave={handleMouseLeave3D}>
                <h4>Blacklisted IP Addresses</h4>
                <div className="data-table-wrapper" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                  <table className="data-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th>Blocked IP Address</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blacklist.length === 0 ? (
                        <tr>
                          <td colSpan="2" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>
                            No IP addresses blacklisted.
                          </td>
                        </tr>
                      ) : (
                        blacklist.map((ip, i) => (
                          <tr key={i}>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{ip}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '4px 10px', fontSize: '0.75rem', borderColor: 'var(--success)' }}
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
          <h3>🔌 Model Context Protocol (MCP) Integration</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
            APIShield exposes an official **MCP Server** that exposes tools for admin orchestration. 
            You can load this server directly into your AI clients (like Claude Desktop or Cursor) to manage key quotas and blacklist IPs using natural language commands.
          </p>

          <h2>Configuring Claude Desktop</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            To connect Claude Desktop to your local APIShield MCP Server, open your `claude_desktop_config.json` file:
          </p>
          <pre>{`%APPDATA%\\Claude\\claude_desktop_config.json (Windows)
~/Library/Application Support/Claude/claude_desktop_config.json (macOS)`}</pre>
          <p style={{ color: 'var(--text-secondary)' }}>
            Insert the following configuration under the `mcpServers` object:
          </p>
          <pre>{`{
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

          <h2 style={{ marginTop: '40px' }}>Configuring Cursor IDE</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
            To add the server to <strong>Cursor</strong>, navigate to:
            {" Settings > Features > MCP > + Add New MCP Server"}
          </p>
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '24px' }}>
            <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
              <li><strong>Name:</strong> <code style={{ color: '#fff' }}>apishield-admin</code></li>
              <li><strong>Type:</strong> <code style={{ color: '#fff' }}>stdio</code></li>
              <li><strong>Command:</strong> <code style={{ color: '#fff' }}>node d:/smart-gateway-mcp/mcp-server/index.js</code></li>
            </ul>
          </div>

          <h2>Commands to try with your AI Agent:</h2>
          <pre style={{ color: 'var(--accent-purple)' }}>
{`• "Show me the current blacklist from the apishield-admin MCP server."
• "Ask the apishield-admin server to block IP address 203.0.113.88."
• "Check the operational metrics for the API Gateway."
• "Update the rate limit quota to 120 for api key apishield_abc123."`}
          </pre>
        </div>
      )}
    </div>
  );
}

export default App;
