# DuelForge frontend

Vite + React arena UI for the deployed DuelForge contract on GenLayer
Stable Studionet (chain 61999).

- Contract: `0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33`
  ([explorer](https://explorer-studio.genlayer.com/address/0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33))
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
- Price ticker (CoinDesk primary, CoinGecko fallback) is display only.
  Settlement is decided by on-chain validator consensus, never by the
  displayed number.

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
