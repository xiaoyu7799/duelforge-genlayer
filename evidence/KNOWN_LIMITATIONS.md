# DuelForge — Known limitations

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

## Multi-asset milestone (new contract 0xe8cE44E500bF327174a8dABAC80b78cD414262e7, 2026-11-10)

- What changed: duels carry an `asset` field ("BTC" or "ETH"); settlement
  fetches the price for that asset only. ETH sources are CoinGecko simple
  price (ids=ethereum) primary and Coinbase exchange-rates
  (api.coinbase.com/v2/exchange-rates?currency=ETH, data.rates.USD)
  fallback. The v1 settlement consensus is unchanged: validators agree on
  YES/NO only via strict_eq; the exact price is never compared or stored.
  `cancel_duel` (creator-only, OPEN-only) refunds the creator's stake in
  full and moves the duel to CANCELLED, which is terminal for join/settle.
  There is no time-based expiry and no new clock dependency.
- The v1 limits above still apply, with these additions:
  - ETH settlement depends on CoinGecko and Coinbase being reachable by
    validators. If both ETH sources fail at settlement, settlement fails
    before any write (duel stays STAKED, pool is not distributed) -- the
    same behaviour as the v1 BTC sources. The Coinbase fallback was
    exercised only in mocked local tests, not on-chain: both on-chain
    ETH settlements in this milestone used the primary source (the
    fallback path is mock-only evidence).
  - The ETH evidence duel used a wide margin (ETH ~$2,120 live vs $1,500
    threshold) for the same reason as the v1 BTC demo duels: a threshold
    close to the live price would be a weaker demo and is not claimed.
  - Rejected calls are recorded as FINALIZED transactions whose call had
    no effect: on Studionet a UserError revert still finalizes the tx, so
    the receipt alone does not distinguish a rejection from a success.
    Rejection is proven by the LATEST_FINAL read-back after each failed
    attempt (duel 99 absent, duel 3 still OPEN, duel 0 still SETTLED,
    duel 2 still CANCELLED), not by the receipt status. The receipt
    `result` field is the same (6) on successful and rejected calls and
    is not used as evidence either way.
  - One duel from the milestone run is still OPEN on the new contract:
    duel 3 (BTC, threshold $60,000, creator stake 100 nominal units
    deducted at creation). It was created deliberately as the fixture for
    the negative cases (cancel-by-non-creator, join-own, settle-OPEN all
    rejected on it) and left open. Its 100 units are the creator's
    deducted stake, not escrowed funds; nominal ledger: creator 1100 +
    joiner 800 + duel-3 stake 100 = 2000 = 2 x 1000 starting credits.
  - `create_duel` gained an `asset` argument, so the call signature
    changed (id, asset, threshold, side, stake). Clients built against
    the v1 signature must pass the asset; the v1 contract itself is
    untouched and still accepts its original signature.
  - The `gen_call: execution failed` lines in the run log are the RPC
    client's own logging when a read targets a duel id that does not
    exist yet (pre-create state checks and the duel-99 absence check).
    They are read-path noise, not failed writes.
  - No browser-wallet write was tested in this milestone run; the
    frontend work is separate. OKX wallet and mobile checks remain open.
