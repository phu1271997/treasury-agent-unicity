# Treasury Manager Agent — Unicity Sphere (Testnet v2)

An **autonomous economic agent** for the Unicity Builder Program (**Track 1: Autonomous Agents**).
A human sets goals and limits **once**, then the agent runs a control loop and acts on its own — monitoring its wallet, self-minting test tokens when low, and approving or rejecting incoming payment requests within policy. **No human clicks "send" for each action**, so it targets the *agentic* XP bonus.

> ⚠️ This is a runnable skeleton built against the real Sphere SDK API (`@unicitylabs/sphere-sdk` v0.8.0). Method names follow the official README, but you should run it against Testnet v2 and adjust to the exact SDK version you install — some return-shapes (e.g. `getAssets()` fields) may differ slightly by build. Treat this as a strong starting point, not turnkey production code.

## What it does (autonomous behaviors)

1. **Balance monitoring** — polls its own wallet on a heartbeat.
2. **Self-mint top-up** — when balance drops below `LOW_WATER_MARK`, it self-mints back up to `TARGET_BALANCE` via the v2 token engine (`mintFungibleToken`).
3. **Policy-gated payment requests** — every incoming payment request is auto-evaluated:
   - Above per-tx limit → auto-reject
   - Would exceed rolling 24h payout cap → auto-reject
   - Otherwise → top up if needed, then auto-approve and pay
4. **Settlement** — payments settle on Testnet v2 through the SDK.

This exercises real network primitives (wallet, mint, payment requests, settlement) and **moves value**, which is what the program rewards.

## Setup

```bash
npm install
cp .env.example .env
# edit .env — set UNICITY_API_KEY (published testnet2 key) and a unique AGENT_NAMETAG
npm run agent
```

The testnet2 gateway API key is **not a secret** — it's published in the SDK repo's `.env.example`. There is **no faucet**; the agent funds itself via self-mint.

## Configuration (.env)

| Var | Meaning |
|-----|---------|
| `UNICITY_NETWORK` | `testnet` (→ v2 testnet2 gateway) |
| `UNICITY_API_KEY` | testnet2 gateway key (published, not secret) |
| `WALLET_MNEMONIC` | fix identity across restarts (optional; else auto-saved to `./wallet-data`) |
| `AGENT_NAMETAG` | human-readable `@name` the agent registers |
| `TARGET_BALANCE` / `LOW_WATER_MARK` | top-up thresholds |
| `MAX_AUTO_APPROVE` | per-request auto-pay ceiling |
| `DAILY_PAYOUT_CAP` | rolling 24h payout limit |
| `POLL_INTERVAL_MS` | control-loop interval |

## Why this is "agentic" (for the bonus)

Per the Builder Program definition: *an autonomous agent initiates and completes economic actions without a human in the loop for each action; a human sets goals and limits, the agent operates independently within those bounds.* That's exactly this loop — the human writes the policy in `.env`; the agent decides and executes mint/approve/reject/pay on its own.

## Ideas to go further (more XP)

- Add **intent market** participation: post/scan signed intents to source yield or rebalance across coins (`sphere.market`).
- Add **swap** logic (`sphere.swap`) to rebalance a multi-coin treasury via atomic escrow swaps.
- Run on **AstridOS** for the additional bonus (sandbox/observability/isolation).
- Add a small read-only dashboard so reviewers can see it live (program requires the app be publicly viewable).

## Submission checklist

- [ ] Public repo reviewers can read & run
- [ ] App live and publicly viewable
- [ ] Short description + track (Autonomous Agents)
- [ ] Run instructions against Testnet v2 (this README)
- [ ] State that it's **agentic** ✅ and whether it runs on **AstridOS**
- [ ] Shipped within the 4-week window
- [ ] Submit at https://developers.unicity.network/

## Honest note on rewards

XP is the confirmed reward. Any link between XP and a future token (the community-speculated **$UCT**) is **not officially confirmed** by the Unicity team. Build for the XP and the working product, not a guaranteed airdrop.

## License

MIT
