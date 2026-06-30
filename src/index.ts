import { Sphere, getCoinIdBySymbol, parseTokenAmount, toHumanReadable } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { loadPolicy } from './policy.js';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  TREASURY MANAGER AGENT  —  Unicity Sphere SDK / Testnet v2       ║
 * ║                                                                  ║
 * ║  An AUTONOMOUS economic agent (Builder Program — Track 1).        ║
 * ║  A human sets goals + limits ONCE (see .env). After that the     ║
 * ║  agent runs a control loop and acts on its own:                  ║
 * ║                                                                  ║
 * ║    • monitors its own wallet balance                             ║
 * ║    • SELF-MINTS test tokens when below the low-water mark        ║
 * ║    • AUTO-APPROVES incoming payment requests within policy       ║
 * ║    • AUTO-REJECTS requests above the per-tx limit                ║
 * ║    • enforces a rolling 24h payout cap                           ║
 * ║                                                                  ║
 * ║  No human clicks "send" for each action  →  qualifies as agentic ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ── simple rolling 24h payout ledger (in-memory) ─────────────────────
const payoutLog: { amount: bigint; at: number }[] = [];

function payoutsLast24h(): bigint {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let sum = 0n;
  for (const p of payoutLog) if (p.at >= cutoff) sum += p.amount;
  return sum;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const policy = loadPolicy();

  log(`Booting Treasury Manager Agent on "${policy.network}" (coin: ${policy.coin})`);

  // ── 1. Build providers + wallet (persistent file storage) ─────────
  const providers = createNodeProviders({
    network: policy.network,
    dataDir: './wallet-data',   // persists mnemonic → same identity on restart
    tokensDir: './tokens',
    oracle: { apiKey: policy.apiKey },
    price: { platform: 'coingecko' }, // optional fiat display
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: policy.network,
    autoGenerate: true,
    mnemonic: policy.mnemonic,       // if set in env, fixes identity
    nametag: policy.nametag,         // registers @<nametag> (best-effort)
  });

  if (created && generatedMnemonic) {
    log(`⚠️  NEW WALLET CREATED. Back up this mnemonic:\n    ${generatedMnemonic}`);
  }

  log(`Identity: ${sphere.identity?.directAddress}`);
  log(`Nametag : @${sphere.identity?.nametag ?? '(none)'}`);

  // ── 2. Resolve coin id + parse policy thresholds to base units ────
  const coinId = getCoinIdBySymbol(policy.coin);
  if (!coinId) throw new Error(`Unknown coin symbol: ${policy.coin}`);

  const target = parseTokenAmount(policy.targetBalanceStr);
  const lowMark = parseTokenAmount(policy.lowWaterMarkStr);
  const maxAuto = parseTokenAmount(policy.maxAutoApproveStr);
  const dailyCap = parseTokenAmount(policy.dailyPayoutCapStr);

  log(`Policy → target=${policy.targetBalanceStr} low=${policy.lowWaterMarkStr} ` +
      `maxAutoApprove=${policy.maxAutoApproveStr} dailyCap=${policy.dailyPayoutCapStr}`);

  // ── helper: current balance of the managed coin (base units) ──────
  async function currentBalance(): Promise<bigint> {
    const assets = await sphere.payments.getAssets();
    const a = assets.find(
      (x: any) => x.symbol === policy.coin || x.coinId === coinId,
    );
    if (!a) return 0n;
    // getAssets returns totalAmount in base units (string|bigint depending on build)
    return BigInt(a.totalAmount ?? 0);
  }

  // ── 3. AUTONOMOUS DECISION: top up when low ───────────────────────
  async function ensureFunded() {
    const bal = await currentBalance();
    log(`Balance check: ${toHumanReadable(bal)} ${policy.coin}`);
    if (bal < lowMark) {
      const deficit = target - bal;
      log(`↳ Below low-water mark. Self-minting ${toHumanReadable(deficit)} ${policy.coin}…`);
      const res = await sphere.payments.mintFungibleToken(coinId!, deficit);
      if (res.success) log(`↳ ✅ Minted. tokenId=${res.tokenId}`);
      else log(`↳ ❌ Mint failed: ${res.error}`);
    }
  }

  // ── 4. AUTONOMOUS DECISION: handle incoming payment requests ──────
  //    This is the core "no human in the loop" behavior. Every incoming
  //    request is evaluated against policy and approved/rejected by code.
  sphere.payments.onPaymentRequest(async (request: any) => {
    const amount = BigInt(request.amount ?? 0);
    const who = request.senderNametag ?? request.senderPubkey ?? 'unknown';
    log(`Incoming payment request from ${who}: ${toHumanReadable(amount)} ${request.symbol ?? ''}`);

    // Rule 1: never auto-pay above the per-tx ceiling.
    if (amount > maxAuto) {
      log(`↳ ⛔ Above per-tx limit (${policy.maxAutoApproveStr}). Auto-rejecting.`);
      await sphere.payments.rejectPaymentRequest(request.id);
      return;
    }

    // Rule 2: enforce rolling 24h payout cap.
    if (payoutsLast24h() + amount > dailyCap) {
      log(`↳ ⛔ Would exceed 24h payout cap. Auto-rejecting.`);
      await sphere.payments.rejectPaymentRequest(request.id);
      return;
    }

    // Rule 3: make sure we can cover it; top up first if needed.
    let bal = await currentBalance();
    if (bal < amount) {
      log(`↳ Insufficient balance to pay; topping up before approval…`);
      await ensureFunded();
      bal = await currentBalance();
      if (bal < amount) {
        log(`↳ ⛔ Still insufficient after top-up. Auto-rejecting.`);
        await sphere.payments.rejectPaymentRequest(request.id);
        return;
      }
    }

    // Approved → pay autonomously.
    log(`↳ ✅ Within policy. Auto-approving & paying.`);
    const res = await sphere.payments.payPaymentRequest(request.id);
    payoutLog.push({ amount, at: Date.now() });
    log(`↳ Paid. result=${JSON.stringify(res)}`);
  });

  // ── 5. Control loop — the agent's "heartbeat" ─────────────────────
  log(`Entering control loop (every ${policy.pollIntervalMs}ms). Ctrl+C to stop.`);
  await ensureFunded(); // initial top-up
  setInterval(() => {
    ensureFunded().catch((e) => log(`ensureFunded error: ${e?.message ?? e}`));
  }, policy.pollIntervalMs);

  // graceful shutdown
  process.on('SIGINT', () => {
    log('Shutting down treasury agent. Goodbye.');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
