# DuelForge

**Live website: https://xiaoyu7799.github.io/duelforge-genlayer/**

A peer-to-peer forecast duel arena on GenLayer Stable Studionet.

Two players stake nominal TEST units on a verifiable proposition. At settlement, GenLayer validators independently fetch the live Bitcoin price and agree on the outcome. The contract distributes the pool to the winner, updates player balances and the leaderboard. It does not store a verified record for its own sake — the stake moves.

**Opening four lines (per handover v6, section 3):**
- Category: Market & bets
- Mechanism: Two-sided nominal stake; settlement consensus decides YES/NO from a live public price; contract distributes the pool and updates balances/leaderboard
- Interaction model: Duel arena — duel cards, stake slider, settlement reveal, leaderboard — not hero + form + vault
- Evolving state: Player nominal balances, win/loss records, leaderboard rank, duel lifecycle OPEN → STAKED → SETTLED

**Network:** Stable Studionet only, chain ID 61999, RPC https://studio.genlayer.com/api. Zero cash cost, nominal TEST units only — no real assets are held or transferred.

**Status:** Deployed and verified on Stable Studionet (ready-to-submit; NOT filed by the authoring agent — submission is the user's own action).

- Contract: https://explorer-studio.genlayer.com/address/0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33
- Deploy tx: 0x9726093b3c7e5d96580011eb09f54d726ab53bf007602887cb93ce04914577f1 (FINALIZED)
- Contract source: `contracts/duelforge.py`, SHA256 c3266a0872909e877fcb9bb3659f62998da4b8849e1c0b09e6ad3e3b7a7128c9
- Demo duels, both FINALIZED and read back: Duel 0 — BTC above $50,000, winner YES; Duel 1 — BTC above $100,000, winner NO. Both stake 100, pool 200. Final leaderboard: both demo players balance 1000, 1 win / 1 loss.
- Evidence: `evidence/evidence.json` (same content as `evidence/live-verification.json`), full receipts in `evidence/deploy-results.json`, limits in `evidence/KNOWN_LIMITATIONS.md`, reviewer path in `evidence/REVIEWER_QUICK_PATH.md`.
- Frontend: `frontend/` (Vite + React, EN/ZH only, OKX-first wallet + labelled ephemeral test-account fallback). Read duels/leaderboard without a wallet.
- Honest limits: nominal TEST units only; browser-wallet write path NOT personally tested with a real wallet (script writes reached FINALIZED and were read back); mobile NOT tested on a real device; settlement is outcome-only (YES/NO), the exact validator price/source is not stored on-chain. See `evidence/KNOWN_LIMITATIONS.md`.
