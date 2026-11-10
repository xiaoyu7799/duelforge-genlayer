# DuelForge

**Live website: https://xiaoyu7799.github.io/duelforge-genlayer/**

A peer-to-peer forecast duel arena on GenLayer Stable Studionet.

Two players stake nominal TEST units on a verifiable proposition. At settlement, GenLayer validators independently fetch the live price of the duel's asset (Bitcoin or Ethereum) and agree on the outcome. The contract distributes the pool to the winner, updates player balances and the leaderboard. It does not store a verified record for its own sake — the stake moves. A creator may also cancel an open duel and get the stake back in full.

**What it is:**
- Category: Market & bets
- Mechanism: Two-sided nominal stake; settlement consensus decides YES/NO from a live public price; contract distributes the pool and updates balances/leaderboard
- Interaction model: Duel arena — duel cards, stake slider, settlement reveal, leaderboard — not hero + form + vault
- Evolving state: Player nominal balances, win/loss records, leaderboard rank, duel lifecycle OPEN → STAKED → SETTLED, or OPEN → CANCELLED

**Network:** Stable Studionet only, chain ID 61999, RPC https://studio.genlayer.com/api. Zero cash cost, nominal TEST units only — no real assets are held or transferred.

**Status:** Deployed and verified on Stable Studionet.

- Contract: https://explorer-studio.genlayer.com/address/0xe8cE44E500bF327174a8dABAC80b78cD414262e7
- Deploy tx: 0xe252535aae16a5efe233006c7210d86241dce9297b0769be7dc458621fffe06d (FINALIZED)
- Contract source: `contracts/duelforge.py`, SHA256 d8060cfd56f241b02942b6bdc4892d0a3e01ac98e4c31a42b12cd9c27ccd861f (verified: deployed code SHA-256 matches the repo file)
- Milestone — multi-asset duels + cancel (2026-11-10): duels now carry an
  `asset` field ("BTC" or "ETH"); ETH settles from CoinGecko (primary) /
  Coinbase exchange-rates (fallback); settlement consensus is unchanged
  (YES/NO only, exact price never compared or stored). `cancel_duel`
  (creator-only, OPEN-only) refunds the creator's stake in full and moves
  the duel to CANCELLED. Evidence, all FINALIZED with LATEST_FINAL
  read-backs: ETH duel 0 (threshold $1,500, YES wins, pool 200), BTC duel 1
  regression (threshold $50,000, YES wins, pool 200), cancel journey on
  duel 2 (CANCELLED, 100 refunded, join + settle rejected), and 5 lifecycle
  rejections (unknown asset SOL, cancel by non-creator, join own duel,
  settle OPEN, settle SETTLED). See `evidence/multi-asset-evidence.json`
  and the per-case `evidence/multi-asset-*.json` files.
- v1 contract (untouched): https://explorer-studio.genlayer.com/address/0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33
- v1 deploy tx: 0x9726093b3c7e5d96580011eb09f54d726ab53bf007602887cb93ce04914577f1 (FINALIZED)
- v1 contract source SHA256: c3266a0872909e877fcb9bb3659f62998da4b8849e1c0b09e6ad3e3b7a7128c9
- v1 demo duels, both FINALIZED and read back: Duel 0 — BTC above $50,000, winner YES; Duel 1 — BTC above $100,000, winner NO. Both stake 100, pool 200. Final leaderboard: both demo players balance 1000, 1 win / 1 loss.
- v1 evidence: `evidence/evidence.json` (same content as `evidence/live-verification.json`), full receipts in `evidence/deploy-results.json`, limits in `evidence/KNOWN_LIMITATIONS.md`, reviewer path in `evidence/REVIEWER_QUICK_PATH.md`.
- Frontend: `frontend/` (Vite + React, EN/ZH only, OKX-first wallet + labelled ephemeral test-account fallback). Read duels/leaderboard without a wallet.
- Limits: nominal TEST units only; settlement is outcome-only (YES/NO), the exact validator price/source is not stored on-chain. See `evidence/KNOWN_LIMITATIONS.md`.
