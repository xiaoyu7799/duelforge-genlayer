# DuelForge — Reviewer quick path (5 minutes, no wallet needed)

1. Open the live site (link at the top of README.md). No wallet required to read.
2. Confirm the two settled demo duels: Duel 0 ($50,000, winner YES) and
   Duel 1 ($100,000, winner NO), both stake 100, pool 200, and the leaderboard
   (both demo players 1000, 1 win / 1 loss).
3. Open the contract on the explorer:
   https://explorer-studio.genlayer.com/address/0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33
4. Pick any transaction hash in evidence/live-verification.json (or
   evidence/evidence.json, same content) and check it on the explorer.
   Every core transaction is FINALIZED.
5. To test a write without a wallet: use the in-browser ephemeral test account
   in the frontend (labelled as a test account, never as your wallet), create
   a duel, join it from the other side, settle it, and read the result back.
   Expect request → waiting → FINALIZED, then a read-back state.
6. Contract source: contracts/duelforge.py, SHA256
   c3266a0872909e877fcb9bb3659f62998da4b8849e1c0b09e6ad3e3b7a7128c9.
   Local mocked tests (simulation only, not chain results):
   python3 tests/test_duelforge.py
