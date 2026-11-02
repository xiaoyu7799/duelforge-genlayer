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

**Status:** Building. Contract, deployment and live-verification evidence will be recorded in `evidence/` as they are produced. Nothing here is claimed as FINALIZED until a receipt and read-back say so.
