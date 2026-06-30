import { useState, useEffect, useRef } from 'react';
import { Sphere, getCoinIdBySymbol, parseTokenAmount, toHumanReadable } from '@unicitylabs/sphere-sdk';
import { createBrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';
import './App.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const ORACLE_API_KEY = 'sk_ddc3cfcc001e4a28ac3fad7407f99590'; // Public testnet2 API key
const DEFAULT_COIN = 'UCT';

export default function App() {
  // ── 1. Policy Settings State ────────────────────────────────────────────────
  const [coin, setCoin] = useState(DEFAULT_COIN);
  const [targetBalance, setTargetBalance] = useState('1000');
  const [lowWaterMark, setLowWaterMark] = useState('250');
  const [maxAutoApprove, setMaxAutoApprove] = useState('50');
  const [dailyPayoutCap, setDailyPayoutCap] = useState('200');
  const [pollInterval, setPollInterval] = useState('15'); // seconds

  // ── 2. Wallet & Agent Instances State ───────────────────────────────────────
  const [agentSphere, setAgentSphere] = useState<Sphere | null>(null);
  const [agentAddress, setAgentAddress] = useState<string>('');
  const [agentNametag, setAgentNametag] = useState<string>('');
  const [agentBalance, setAgentBalance] = useState<string>('0');
  const [agentStatus, setAgentStatus] = useState<'offline' | 'initializing' | 'active' | 'error'>('offline');
  const [agentMnemonic, setAgentMnemonic] = useState<string>('');

  const [testerSphere, setTesterSphere] = useState<Sphere | null>(null);
  const [testerAddress, setTesterAddress] = useState<string>('');
  const [testerBalance, setTesterBalance] = useState<string>('0');
  const [testerStatus, setTesterStatus] = useState<'offline' | 'initializing' | 'active' | 'error'>('offline');
  const [testerMnemonic, setTesterMnemonic] = useState<string>('');

  // ── 3. Interaction Log & History States ────────────────────────────────────
  const [logs, setLogs] = useState<{ text: string; type: 'info' | 'success' | 'warn' | 'error'; timestamp: string }[]>(() => {
    const saved = localStorage.getItem('agent_logs');
    return saved ? JSON.parse(saved) : [];
  });
  const [paymentHistory, setPaymentHistory] = useState<{
    id: string;
    amount: string;
    memo: string;
    status: 'pending' | 'approved' | 'rejected';
    timestamp: string;
  }[]>(() => {
    const saved = localStorage.getItem('payment_history');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('agent_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('payment_history', JSON.stringify(paymentHistory));
  }, [paymentHistory]);

  // Payout logs for daily limit calculations
  const [payouts, setPayouts] = useState<{ amount: bigint; timestamp: number }[]>([]);

  // ── 4. Bob's Payment Request Form State ──────────────────────────────────────
  const [reqAmount, setReqAmount] = useState('20');
  const [reqMemo, setReqMemo] = useState('Hosting invoice #204');
  const [isSendingRequest, setIsSendingRequest] = useState(false);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  // ── Helper: Log writer ─────────────────────────────────────────────────────
  const addLog = (text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { text, type, timestamp }]);
  };

  // Scroll to bottom of terminal console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Calculate total payouts in last 24h
  const getPayoutsLast24h = (currentPayouts: { amount: bigint; timestamp: number }[]) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return currentPayouts.filter((p) => p.timestamp >= cutoff).reduce((acc, p) => acc + p.amount, 0n);
  };

  const updateOrAppendHistory = (id: string, amount: string, memo: string, status: 'pending' | 'approved' | 'rejected') => {
    setPaymentHistory((prev) => {
      const exists = prev.some((x) => x.id === id);
      if (exists) {
        return prev.map((x) => x.id === id ? { ...x, status } : x);
      }
      return [
        ...prev,
        { id, amount, memo, status, timestamp: new Date().toLocaleTimeString() }
      ];
    });
  };

  // ── 5. Initialize Wallets ──────────────────────────────────────────────────
  const startAgent = async () => {
    if (agentStatus !== 'offline') return;
    setAgentStatus('initializing');
    addLog('Booting Autonomous Treasury Agent...', 'info');

    try {
      // Isolate storage via agent prefix
      const base = createBrowserProviders({
        network: 'testnet',
        oracle: { apiKey: ORACLE_API_KEY },
        storage: {
          dbName: 'agent-wallet-db',
          prefix: 'agent_',
        },
      });

      // Stable device ID for Agent
      let devId = localStorage.getItem('agent_device_id');
      if (!devId) {
        devId = 'agent_dev_' + Math.random().toString(36).substring(2, 11);
        localStorage.setItem('agent_device_id', devId);
      }

      const providers = createWalletApiProviders(base, {
        baseUrl: 'https://wallet-api.unicity.network',
        network: 'testnet2',
        deviceId: devId,
      });

      // Get saved mnemonic if any
      const savedMnemonic = localStorage.getItem('agent_mnemonic') || undefined;

      const { sphere, created, generatedMnemonic } = await Sphere.init({
        ...providers,
        network: 'testnet2',
        autoGenerate: true,
        mnemonic: savedMnemonic,
        nametag: 'treasury_agent_web',
      });

      if (created && generatedMnemonic) {
        localStorage.setItem('agent_mnemonic', generatedMnemonic);
        setAgentMnemonic(generatedMnemonic);
        addLog('New wallet generated for Agent.', 'warn');
      } else if (savedMnemonic) {
        setAgentMnemonic(savedMnemonic);
      }

      setAgentSphere(sphere);
      setAgentAddress(sphere.identity?.directAddress || '');
      setAgentNametag(sphere.identity?.nametag || 'treasury_agent_web');
      setAgentStatus('active');
      addLog('Agent wallet connected successfully!', 'success');
      addLog(`Agent direct address: ${sphere.identity?.directAddress}`, 'info');

      // Refresh balance
      const assets = await sphere.payments.getAssets();
      const coinId = getCoinIdBySymbol(coin);
      const coinAsset = assets.find((x) => x.symbol === coin || x.coinId === coinId);
      const balanceVal = coinAsset ? toHumanReadable(BigInt(coinAsset.totalAmount ?? 0)) : '0';
      setAgentBalance(balanceVal);
      addLog(`Agent initial balance: ${balanceVal} ${coin}`, 'info');

    } catch (err: any) {
      console.error(err);
      setAgentStatus('error');
      addLog(`Agent boot failed: ${err.message || err}`, 'error');
    }
  };

  const startTester = async () => {
    if (testerStatus !== 'offline') return;
    setTesterStatus('initializing');
    addLog('Booting Bob\'s Tester Wallet...', 'info');

    try {
      // Isolate storage via tester prefix
      const base = createBrowserProviders({
        network: 'testnet',
        oracle: { apiKey: ORACLE_API_KEY },
        storage: {
          dbName: 'tester-wallet-db',
          prefix: 'tester_',
        },
      });

      // Stable device ID for Tester
      let devId = localStorage.getItem('tester_device_id');
      if (!devId) {
        devId = 'tester_dev_' + Math.random().toString(36).substring(2, 11);
        localStorage.setItem('tester_device_id', devId);
      }

      const providers = createWalletApiProviders(base, {
        baseUrl: 'https://wallet-api.unicity.network',
        network: 'testnet2',
        deviceId: devId,
      });

      const savedMnemonic = localStorage.getItem('tester_mnemonic') || undefined;

      const { sphere, created, generatedMnemonic } = await Sphere.init({
        ...providers,
        network: 'testnet2',
        autoGenerate: true,
        mnemonic: savedMnemonic,
        nametag: 'bob_tester_browser',
      });

      if (created && generatedMnemonic) {
        localStorage.setItem('tester_mnemonic', generatedMnemonic);
        setTesterMnemonic(generatedMnemonic);
        addLog('New wallet generated for Tester Bob.', 'warn');
      } else if (savedMnemonic) {
        setTesterMnemonic(savedMnemonic);
      }

      setTesterSphere(sphere);
      setTesterAddress(sphere.identity?.directAddress || '');
      setTesterStatus('active');
      addLog('Bob\'s Tester wallet connected successfully!', 'success');

      // Refresh balance
      const assets = await sphere.payments.getAssets();
      const coinId = getCoinIdBySymbol(coin);
      const coinAsset = assets.find((x) => x.symbol === coin || x.coinId === coinId);
      const balanceVal = coinAsset ? toHumanReadable(BigInt(coinAsset.totalAmount ?? 0)) : '0';
      setTesterBalance(balanceVal);

    } catch (err: any) {
      console.error(err);
      setTesterStatus('error');
      addLog(`Bob's wallet boot failed: ${err.message || err}`, 'error');
    }
  };

  // ── 6. Agent Loop: Top Up Thresholds ──────────────────────────────────────
  const runAgentTopUpCheck = async () => {
    if (!agentSphere) return;

    try {
      const assets = await agentSphere.payments.getAssets();
      const coinId = getCoinIdBySymbol(coin);
      if (!coinId) return;

      const coinAsset = assets.find((x) => x.symbol === coin || x.coinId === coinId);
      const rawBalance = BigInt(coinAsset?.totalAmount ?? 0);
      const balanceVal = toHumanReadable(rawBalance);
      setAgentBalance(balanceVal);

      const targetUnits = parseTokenAmount(targetBalance);
      const lowMarkUnits = parseTokenAmount(lowWaterMark);

      addLog(`[Control Loop] Balance check: ${balanceVal} ${coin}`, 'info');

      if (rawBalance < lowMarkUnits) {
        const deficit = targetUnits - rawBalance;
        addLog(`↳ Below low-water mark (${lowWaterMark} ${coin}). Auto-minting deficit of ${toHumanReadable(deficit)} ${coin}...`, 'warn');
        
        const res = await agentSphere.payments.mintFungibleToken(coinId, deficit);
        if (res.success) {
          addLog(`↳ ✅ Auto-mint successful! Token ID: ${res.tokenId?.substring(0, 16)}...`, 'success');
          // Refresh balance
          const updatedAssets = await agentSphere.payments.getAssets();
          const updatedAsset = updatedAssets.find((x) => x.symbol === coin || x.coinId === coinId);
          setAgentBalance(toHumanReadable(BigInt(updatedAsset?.totalAmount ?? 0)));
        } else {
          addLog(`↳ ❌ Auto-mint failed: ${res.error}`, 'error');
        }
      }
    } catch (err: any) {
      addLog(`Error checking balance/minting: ${err.message || err}`, 'error');
    }
  };

  // Run initial loop on boot
  useEffect(() => {
    if (agentSphere) {
      runAgentTopUpCheck();
      const intervalId = setInterval(runAgentTopUpCheck, Number(pollInterval) * 1000);
      return () => clearInterval(intervalId);
    }
  }, [agentSphere, coin, targetBalance, lowWaterMark, pollInterval]);

  // ── 7. Listen for incoming Payment Requests on Agent ──────────────────────
  const policyRef = useRef({
    coin,
    maxAutoApprove,
    dailyPayoutCap,
    payouts,
  });

  useEffect(() => {
    policyRef.current = {
      coin,
      maxAutoApprove,
      dailyPayoutCap,
      payouts,
    };
  }, [coin, maxAutoApprove, dailyPayoutCap, payouts]);

  useEffect(() => {
    if (!agentSphere) return;

    addLog('Agent registering payment request listener...', 'info');

    const unsubscribe = agentSphere.payments.onPaymentRequest(async (request: any) => {
      const amount = BigInt(request.amount ?? 0);
      const who = request.senderNametag ?? request.senderPubkey ?? 'unknown';
      const requestId = request.id;
      const memo = request.message || '(no memo)';

      const currentCoin = policyRef.current.coin;
      const currentMaxAuto = policyRef.current.maxAutoApprove;
      const currentDailyCap = policyRef.current.dailyPayoutCap;
      const currentPayouts = policyRef.current.payouts;

      addLog(`[Agent Policy Engine] Incoming request from @${who}: ${toHumanReadable(amount)} ${request.symbol ?? DEFAULT_COIN}`, 'info');
      addLog(`↳ Memo: "${memo}"`, 'info');

      const maxAutoUnits = parseTokenAmount(currentMaxAuto);
      const dailyCapUnits = parseTokenAmount(currentDailyCap);

      // Check Rule 1: Limit ceiling
      if (amount > maxAutoUnits) {
        addLog(`↳ ⛔ REJECTED: Request of ${toHumanReadable(amount)} ${currentCoin} exceeds single tx ceiling of ${currentMaxAuto} ${currentCoin}.`, 'warn');
        await agentSphere.payments.rejectPaymentRequest(requestId);
        
        updateOrAppendHistory(requestId, toHumanReadable(amount), memo, 'rejected');
        return;
      }

      // Check Rule 2: Daily payout cap
      const currentPayoutsVal = getPayoutsLast24h(currentPayouts);
      if (currentPayoutsVal + amount > dailyCapUnits) {
        addLog(`↳ ⛔ REJECTED: Request would exceed rolling 24h payout cap of ${currentDailyCap} ${currentCoin}.`, 'warn');
        await agentSphere.payments.rejectPaymentRequest(requestId);
        
        updateOrAppendHistory(requestId, toHumanReadable(amount), memo, 'rejected');
        return;
      }

      // Check Rule 3: Balance check and top up
      const assets = await agentSphere.payments.getAssets();
      const coinId = getCoinIdBySymbol(currentCoin);
      const coinAsset = assets.find((x) => x.symbol === currentCoin || x.coinId === coinId);
      let rawBalance = BigInt(coinAsset?.totalAmount ?? 0);

      if (rawBalance < amount) {
        addLog(`↳ Balance (${toHumanReadable(rawBalance)} ${currentCoin}) insufficient to pay ${toHumanReadable(amount)} ${currentCoin}. Triggering top-up...`, 'warn');
        await runAgentTopUpCheck();
        
        const freshAssets = await agentSphere.payments.getAssets();
        const freshAsset = freshAssets.find((x) => x.symbol === currentCoin || x.coinId === coinId);
        rawBalance = BigInt(freshAsset?.totalAmount ?? 0);
      }

      if (rawBalance < amount) {
        addLog('↳ ⛔ REJECTED: Balance still insufficient after top-up attempts.', 'error');
        await agentSphere.payments.rejectPaymentRequest(requestId);
        
        updateOrAppendHistory(requestId, toHumanReadable(amount), memo, 'rejected');
        return;
      }

      // Auto-approve and pay
      addLog(`↳ ✅ APPROVED: Within policy limits. Auto-paying now...`, 'success');
      try {
        const res = await agentSphere.payments.payPaymentRequest(requestId);
        addLog(`↳ Paid successfully! Transfer ID: ${res.id?.substring(0, 16)}...`, 'success');
        
        setPayouts((prev) => [...prev, { amount, timestamp: Date.now() }]);
        updateOrAppendHistory(requestId, toHumanReadable(amount), memo, 'approved');

        // Refresh agent & tester balances
        setTimeout(async () => {
          if (agentSphere) {
            const agentAssets = await agentSphere.payments.getAssets();
            const aAsset = agentAssets.find((x) => x.symbol === currentCoin || x.coinId === coinId);
            setAgentBalance(toHumanReadable(BigInt(aAsset?.totalAmount ?? 0)));
          }
          if (testerSphere) {
            const testerAssets = await testerSphere.payments.getAssets();
            const tAsset = testerAssets.find((x) => x.symbol === currentCoin || x.coinId === coinId);
            setTesterBalance(toHumanReadable(BigInt(tAsset?.totalAmount ?? 0)));
          }
        }, 1500);

      } catch (err: any) {
        addLog(`↳ ❌ Payment resolution failed: ${err.message || err}`, 'error');
      }
    });

    return () => unsubscribe();
  }, [agentSphere]);

  // ── 8. Tester Bob sends a request to the Agent ──────────────────────────────
  const sendPaymentRequest = async () => {
    if (!testerSphere || !agentSphere) return;
    setIsSendingRequest(true);
    addLog(`[Bob] Initiating payment request of ${reqAmount} ${coin} to Agent...`, 'info');

    try {
      const coinId = getCoinIdBySymbol(coin);
      if (!coinId) throw new Error(`Unknown coin symbol: ${coin}`);

      // Recipient is the Agent's public key (direct routing to avoid Nostr nametag propagation delay)
      const request = await testerSphere.payments.sendPaymentRequest(
        agentSphere.identity!.chainPubkey,
        {
          amount: parseTokenAmount(reqAmount).toString(),
          coinId: coinId,
          message: reqMemo
        }
      );

      const reqId = request.requestId || request.eventId || 'unknown';
      addLog(`[Bob] ✅ Payment request created! Request ID: ${reqId.substring(0, 16)}...`, 'success');
      updateOrAppendHistory(reqId, reqAmount, reqMemo, 'pending');
    } catch (err: any) {
      console.error(err);
      addLog(`[Bob] ❌ Failed to create request: ${err.message || err}`, 'error');
    } finally {
      setIsSendingRequest(false);
    }
  };

  // ── 9. Wipe keys helper for resetting demo ──────────────────────────────────
  const resetDemo = () => {
    if (confirm('Clear local wallets and start fresh? This will delete saved recovery phrases, logs, and transaction history.')) {
      localStorage.removeItem('agent_mnemonic');
      localStorage.removeItem('tester_mnemonic');
      localStorage.removeItem('agent_logs');
      localStorage.removeItem('payment_history');
      window.location.reload();
    }
  };

  return (
    <div style={{ paddingBottom: '60px' }}>
      {/* Header */}
      <header style={{ padding: '24px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Autonomous Treasury Manager</h1>
          <p style={{ margin: 0, color: '#a1a1aa', fontSize: '0.95rem' }}>
            Built on Unicity Sphere SDK Testnet v2 (Network: <span className="badge-network">testnet2</span>)
          </p>
        </div>
        <div>
          <button className="btn-secondary" onClick={resetDemo} style={{ fontSize: '0.85rem' }}>
            🔄 Reset Wallets
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
        {/* Left Side: Agent Panel & Console logs */}
        <div className="col-left" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Agent Card */}
          <div className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2>🏦 Treasury Agent</h2>
              {agentStatus === 'active' ? (
                <span className="badge-active">Online</span>
              ) : agentStatus === 'initializing' ? (
                <span style={{ color: '#fbbf24', fontSize: '0.85rem' }}>Initializing...</span>
              ) : (
                <button className="btn-primary" onClick={startAgent}>Start Agent</button>
              )}
            </div>

            {agentStatus === 'active' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Agent Address</div>
                    <code style={{ fontSize: '0.85rem', wordBreak: 'break-all', color: '#e4e4e7' }}>{agentAddress}</code>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="glass-card">
                    <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Nametag</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#c084fc', marginTop: '4px' }}>
                      @{agentNametag}
                    </div>
                  </div>
                  <div className="glass-card">
                    <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Treasury Balance</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#38bdf8', marginTop: '4px' }}>
                      {agentBalance} {coin}
                    </div>
                  </div>
                </div>

                {agentMnemonic && (
                  <div className="glass-card" style={{ border: '1px dashed rgba(234, 179, 8, 0.3)', background: 'rgba(234, 179, 8, 0.02)' }}>
                    <div style={{ fontSize: '0.8rem', color: '#facc15', fontWeight: 500 }}>⚠️ Recovery Phrase (First Run Only)</div>
                    <code style={{ display: 'block', fontSize: '0.75rem', marginTop: '6px', color: '#e4e4e7', whiteSpace: 'pre-wrap' }}>{agentMnemonic}</code>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Console / Terminal logs */}
          <div className="glass-panel" style={{ flexGrow: 1 }}>
            <h2>💻 Agent Activity Logs (Live Console)</h2>
            <div className="console-container">
              {logs.length === 0 ? (
                <div style={{ color: '#71717a', fontStyle: 'italic' }}>Logs will appear here once the Agent or Bob is started...</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className={`console-line ${log.type}`}>
                    [{log.timestamp}] {log.text}
                  </div>
                ))
              )}
              <div ref={consoleEndRef} />
            </div>
          </div>
        </div>

        {/* Right Side: Policy Limits & Tester Bob */}
        <div className="col-right" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Policy Limits */}
          <div className="glass-panel">
            <h2>⚙️ Treasury Policy Config</h2>
            <p style={{ fontSize: '0.85rem', color: '#a1a1aa', marginTop: '-8px', marginBottom: '16px' }}>
              Limits set by human once. Agent operates autonomously within these bounds.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Manage Coin</label>
                <input className="form-input" value={coin} onChange={(e) => setCoin(e.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label className="form-label">Poll Heartbeat (sec)</label>
                <input className="form-input" type="number" value={pollInterval} onChange={(e) => setPollInterval(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Target Balance ({coin})</label>
                <input className="form-input" type="number" value={targetBalance} onChange={(e) => setTargetBalance(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Low Water Mark ({coin})</label>
                <input className="form-input" type="number" value={lowWaterMark} onChange={(e) => setLowWaterMark(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Max Auto-Approve Limit</label>
                <input className="form-input" type="number" value={maxAutoApprove} onChange={(e) => setMaxAutoApprove(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Daily Payout Cap</label>
                <input className="form-input" type="number" value={dailyPayoutCap} onChange={(e) => setDailyPayoutCap(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Tester Panel (Bob's Wallet) */}
          <div className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2>👤 Verification Testbed (Bob)</h2>
              {testerStatus === 'active' ? (
                <span className="badge-active" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.25)' }}>
                  Active
                </span>
              ) : testerStatus === 'initializing' ? (
                <span style={{ color: '#fbbf24', fontSize: '0.85rem' }}>Initializing...</span>
              ) : (
                <button className="btn-primary" onClick={startTester}>Start Bob</button>
              )}
            </div>

            {testerStatus === 'active' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="glass-card">
                    <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Identity</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f472b6', marginTop: '4px' }}>
                      @bob_tester_browser
                    </div>
                  </div>
                  <div className="glass-card">
                    <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Bob's Balance</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#fb7185', marginTop: '4px' }}>
                      {testerBalance} {coin}
                    </div>
                  </div>
                </div>

                <div className="glass-card" style={{ wordBreak: 'break-all' }}>
                  <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Bob's Address</div>
                  <code style={{ fontSize: '0.8rem', color: '#e4e4e7' }}>{testerAddress}</code>
                </div>

                {testerMnemonic && (
                  <div className="glass-card" style={{ border: '1px dashed rgba(236, 72, 153, 0.3)', background: 'rgba(236, 72, 153, 0.02)' }}>
                    <div style={{ fontSize: '0.8rem', color: '#ec4899', fontWeight: 500 }}>⚠️ Recovery Phrase</div>
                    <code style={{ display: 'block', fontSize: '0.75rem', marginTop: '6px', color: '#e4e4e7', whiteSpace: 'pre-wrap' }}>{testerMnemonic}</code>
                  </div>
                )}

                <div className="glass-card" style={{ background: 'rgba(0, 0, 0, 0.1)' }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '0.9rem' }}>Send Payment Request to Agent</h3>
                  
                  <div className="form-group">
                    <label className="form-label">Request Amount ({coin})</label>
                    <input
                      className="form-input"
                      type="number"
                      value={reqAmount}
                      onChange={(e) => setReqAmount(e.target.value)}
                      disabled={agentStatus !== 'active'}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Memo / Description</label>
                    <input
                      className="form-input"
                      value={reqMemo}
                      onChange={(e) => setReqMemo(e.target.value)}
                      disabled={agentStatus !== 'active'}
                    />
                  </div>

                  <button
                    className="btn-primary"
                    onClick={sendPaymentRequest}
                    disabled={isSendingRequest || agentStatus !== 'active'}
                    style={{ width: '100%', marginTop: '8px' }}
                  >
                    {isSendingRequest ? 'Sending Request...' : 'Submit Request'}
                  </button>
                  {agentStatus !== 'active' && (
                    <p style={{ margin: '6px 0 0 0', fontSize: '0.75rem', color: '#ef4444', textAlign: 'center' }}>
                      Start the Treasury Agent first to verify policies!
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Payment Request History */}
          <div className="glass-panel">
            <h2>📜 Request History</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '180px', overflowY: 'auto' }}>
              {paymentHistory.length === 0 ? (
                <div style={{ color: '#71717a', fontSize: '0.85rem', fontStyle: 'italic' }}>No transactions recorded...</div>
              ) : (
                paymentHistory.map((item, idx) => (
                  <div key={idx} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                        {item.amount} {coin}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#71717a' }}>
                        {item.memo} • {item.timestamp}
                      </div>
                    </div>
                    <div>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        textTransform: 'uppercase',
                        background: item.status === 'approved' ? 'rgba(34, 197, 94, 0.15)' : item.status === 'rejected' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                        color: item.status === 'approved' ? '#4ade80' : item.status === 'rejected' ? '#f87171' : '#facc15',
                        border: item.status === 'approved' ? '1px solid rgba(34, 197, 94, 0.25)' : item.status === 'rejected' ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid rgba(234, 179, 8, 0.25)',
                      }}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
