# DuelForge frontend

Vite + React arena UI for the deployed DuelForge contract on GenLayer
Stable Studionet (chain 61999).

- Contract: read at runtime from `deployment.json` (repo root; copied
  into the built site by the `prebuild` step). The address is never
  hard-coded in the frontend — a redeploy only needs a new manifest,
  and nothing renders chain values until it loads.
- Duels are multi-asset: BTC or ETH. The forge form picks the asset,
  cards carry an asset badge, the board filters by asset, and the
  creator of an OPEN duel can cancel it — the stake is refunded to
  their balance and the duel can never be joined or settled.
- Reading duels / leaderboard works with no wallet.
- Wallet: any injected EVM wallet, OKX first (`window.okxwallet ||
  window.ethereum`), never MetaMask-only. GenLayer writes via the
  GenLayer Snap where the wallet supports it; otherwise a clearly
  labelled in-browser ephemeral test account (key in tab memory only,
  real on-chain tx, requester shown honestly as the test account, never
  as wallet-signed) lets any reviewer test the full lifecycle.
- Languages: Chinese + English ONLY. No Japanese/Korean files or keys.
  On-chain values are always English (YES/NO, status strings).
- Sound: user-toggled, never autoplay; auto-enables on first click with
  the button synced, never auto-re-enables after a manual close.
- Price ticker (CoinGecko BTC+ETH primary, CoinDesk BTC fallback) is
  display only. Settlement is decided by on-chain validator consensus,
  never by the displayed number.

## Notes

- All balances are nominal TEST units: no real assets held or transferred.

## Develop / build

```sh
npm install
npm run check-i18n   # proves zero missing EN/ZH keys
npm run build        # outputs dist/ (base './' for GitHub Pages)
```

Deployment is via `.github/workflows/pages.yml` (builds `frontend/`,
publishes `frontend/dist` to Pages). No commit/push is done from here.
