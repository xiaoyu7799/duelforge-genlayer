# DuelForge — Known limitations (honest, read before judging)

- Nominal TEST units only. Stakes, pools, balances and leaderboard figures are
  demo accounting units on Stable Studionet. No real assets are held, transferred
  or settled by this contract.
- New players receive 1000 nominal TEST units of starting credit on first stake.
  This is demo credit, not a real balance, airdrop or claim on any asset.
- Settlement is outcome-only by design: validators agree on YES/NO, not on the
  exact BTC price. The live price and the source actually used by validators are
  not stored on-chain, so they cannot be read back from the duel record.
- Price sources are public and can change or go down: CoinDesk BTC/USD primary,
  CoinGecko simple price fallback. If both fail at settlement, settlement fails
  before any write (duel stays STAKED, pool is not distributed).
- Demo duels use wide margins (BTC ~$76,921 at design time vs $50,000 and
  $100,000 thresholds) precisely so small validator timing/source differences
  cannot flip the outcome. A threshold close to the live price would be a
  weaker demo and is not claimed here.
- Language: Chinese + English ONLY. No Japanese, Korean or other languages.
  On-chain values are always English (YES/NO, OPEN/STAKED/SETTLED).
