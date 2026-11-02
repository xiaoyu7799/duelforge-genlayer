# DuelForge — Submission draft (NOT FILED)

This draft was NOT filed by any agent. The user files the submission themselves.
Character counts were checked with a script before delivery.

## One-liner (168 / 180)

DuelForge is a forecast duel arena on GenLayer: two players stake nominal TEST units, validators agree YES/NO from the live BTC price, and the contract pays the winner.

## Description (833 / 1000)

DuelForge turns a forecast into a two-sided duel. A creator opens a duel with a BTC price threshold, a side (YES/NO) and a nominal TEST stake; a second player joins the opposite side with the same stake. At settlement, GenLayer validators independently fetch the live Bitcoin price (CoinDesk primary, CoinGecko fallback) and must agree on the outcome only, not the exact price, so small timing differences cannot flip a wide-margin duel. The contract then distributes the pool to the winner, updates both players' balances and win/loss records, and updates the leaderboard. Duels evolve OPEN to STAKED to SETTLED and settled duels are immutable. Two demo duels are settled on Stable Studionet: BTC above $50,000 (YES wins) and BTC above $100,000 (NO wins). Amounts are nominal TEST units only; no real assets are held or transferred.

## Expected result (444 / 500)

Open the live site without a wallet and read the two settled demo duels and the leaderboard. Then, using the labelled in-browser test account, create a duel, join it from the opposite side, settle it, and read the result back. Expected: each step reaches FINALIZED, the settled duel shows the winning side and pool, and the leaderboard balances and win/loss records update accordingly. Contract and transaction links are in the proof materials.

## Steps

1. Open the live site (link at the top of README.md). No wallet is needed to read duels and the leaderboard.
2. Connect any injected wallet (OKX first) or use the labelled in-browser ephemeral test account; switch to Stable Studionet (61999) if prompted.
3. Create a duel: choose a BTC threshold, a side (YES/NO) and a stake. Wait for FINALIZED and read the duel back (OPEN).
4. Join it from the opposite side (a second account). Wait for FINALIZED and read it back (STAKED, pool = 2x stake).
5. Settle it. Wait for FINALIZED and read it back (SETTLED, winner side, pool paid, leaderboard updated).
6. Check any transaction on the explorer via the links in the frontend tracker or in evidence/live-verification.json.

## Main tag recommendation

Prediction Market / Market & Bets if the form offers such a tag; otherwise Other, with the title and description above stating the true positioning (forecast duel). Do not force a dispute-resolution or game tag that misdescribes the project.

## Proof materials (links only — no descriptions in the form field)

- https://github.com/xiaoyu7799/duelforge-genlayer
- https://explorer-studio.genlayer.com/address/0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33
- https://github.com/xiaoyu7799/duelforge-genlayer/blob/main/evidence/evidence.json

## Honest limits to keep in the submission (do not remove)

- Nominal TEST units only; no real assets held or transferred.
- Settlement is outcome-only (YES/NO); the exact validator price/source is not stored on-chain.
- Language: Chinese + English only. On-chain values are always English.
