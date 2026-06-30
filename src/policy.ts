import 'dotenv/config';

/**
 * TreasuryPolicy = the goals and limits a human sets ONCE.
 * The agent then operates autonomously within these bounds — it decides
 * WHEN to mint, WHEN to approve a payment request, and WHEN to reject,
 * with no human clicking "send" for each action.
 */
export interface TreasuryPolicy {
  network: 'testnet' | 'testnet2' | 'mainnet' | 'dev';
  apiKey: string;
  mnemonic?: string;
  nametag: string;

  coin: string;
  targetBalance: bigint;     // in human units, parsed later
  lowWaterMark: bigint;
  maxAutoApprove: bigint;
  dailyPayoutCap: bigint;
  pollIntervalMs: number;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Note: these are stored as human-readable numbers in .env. We keep them as
// strings here and convert with parseTokenAmount() at the call site so the
// SDK handles decimals correctly per coin.
export function loadPolicy(): TreasuryPolicy & {
  targetBalanceStr: string;
  lowWaterMarkStr: string;
  maxAutoApproveStr: string;
  dailyPayoutCapStr: string;
} {
  return {
    network: (process.env.UNICITY_NETWORK ?? 'testnet') as TreasuryPolicy['network'],
    apiKey: req('UNICITY_API_KEY'),
    mnemonic: process.env.WALLET_MNEMONIC || undefined,
    nametag: process.env.AGENT_NAMETAG ?? 'treasurybot',

    coin: process.env.TREASURY_COIN ?? 'UCT',
    // bigint fields are filled after parseTokenAmount; keep raw strings too
    targetBalance: 0n,
    lowWaterMark: 0n,
    maxAutoApprove: 0n,
    dailyPayoutCap: 0n,
    targetBalanceStr: process.env.TARGET_BALANCE ?? '1000',
    lowWaterMarkStr: process.env.LOW_WATER_MARK ?? '250',
    maxAutoApproveStr: process.env.MAX_AUTO_APPROVE ?? '50',
    dailyPayoutCapStr: process.env.DAILY_PAYOUT_CAP ?? '200',
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? '30000'),
  };
}
