# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""DuelForge: peer-to-peer forecast duels on GenLayer Stable Studionet.

Category: Market & bets. This is NOT fetch-then-record.

What happens
------------
1. A creator opens a duel: a duel id, a BTC price threshold in whole
   US dollars, a side ("YES" = BTC will be above the threshold at
   settlement, "NO" = it will not), and a stake in nominal TEST units.
   The creator's stake is deducted immediately.
2. A second, different player joins the opposite side. Joining stakes
   exactly the same amount, so the pool is exactly 2 x stake and the
   duel moves OPEN -> STAKED.
3. Anyone settles a STAKED duel. Validators independently fetch the
   live Bitcoin price and must agree on the OUTCOME only ("YES" or
   "NO"). The contract then distributes the whole pool to the winner
   exactly once and updates both players' win/loss records and the
   leaderboard. A settled duel is immutable.

Nominal TEST units only
-----------------------
Balances are nominal demo credit, not real funds: no real asset is
held, transferred, or escrowed by this contract. A player who has
never interacted before starts with STARTING_CREDIT (1000) nominal
TEST units on first successful stake, purely so demo duels can be
played without any funding step. That credit is not redeemable and
has no real-world value.

Consensus design (the part that matters)
----------------------------------------
* Settlement uses gl.eq_principle.strict_eq over a nondet function
  that returns ONLY the outcome string "YES" or "NO". Validators do
  NOT agree on the exact price string or number: each validator
  fetches the price itself, converts it to integer dollars, compares
  it to the threshold, and derives its own YES/NO. Only if the
  outcome strings agree exactly does consensus pass. Small
  timing/source differences in the raw price therefore cannot flip
  a duel unless the price is genuinely sitting on the threshold --
  which is why the demo duels use wide margins (see below).
* Price sources, tried in order, all free and keyless:
    - CoinDesk BTC/USD: https://api.coindesk.com/v1/bpi/currentprice/USD.json
    - CoinGecko simple price: https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd
  The first source that answers 200 with a parseable price wins, for
  the leader and for every validator independently. Because the
  nondet result is only YES/NO, the source actually used is NOT
  stored on the duel (it is not part of the agreed result).
* NO floats anywhere in nondet results: GenVM calldata cannot encode
  floats. Prices are parsed to
  integer dollars only -- commas stripped, any decimal part dropped,
  any JSON float truncated to int inside the nondet function -- and
  contract state uses ints only.
* No hashlib is used anywhere in this contract: price/outcome logic
  needs no hash, and GenVM stdlib availability is unproven.
* A failed fetch from every source raises a UserError before any
  state is written, so the duel stays STAKED and settlement can be
  retried. A settled duel can never be re-settled, so the pool can
  never be distributed twice.

Demo duels (wide margins; BTC ~$76,921 at design time)
------------------------------------------------------
* Duel 0: threshold $50,000, proposition "BTC price in USD is above
  $50,000 at settlement" -> expected YES wins.
* Duel 1: threshold $100,000, proposition "BTC price in USD is above
  $100,000 at settlement" -> expected NO wins.
  A validator timing difference of a few dollars cannot flip either
  outcome while BTC is anywhere near its design-time price.

Enforced invariants (all checked before any write)
--------------------------------------------------
* Duplicate duel ids rejected; a duel id, once used, is never reused.
* The same player cannot join both sides (joiner != creator).
* Join only from OPEN, only on the opposite side, only at exactly
  the duel's stake (joining stakes the duel stake automatically).
* Settlement only from STAKED; settled duels are immutable.
* Pool distributed exactly once (the STAKED -> SETTLED transition is
  the only place a credit happens, and SETTLED rejects re-settlement).
* Balances never go negative (every deduction is balance-checked
  first, including the starting-credit case).
* stake > 0, threshold > 0, side must be exactly "YES" or "NO".
"""

import json

from genlayer import *

STARTING_CREDIT = 1000

PRICE_SOURCES = (
    ("https://api.coindesk.com/v1/bpi/currentprice/USD.json", "coindesk"),
    ("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", "coingecko"),
)


def _to_int_dollars(value) -> int:
    """Convert a JSON price (int, float, or formatted string) to whole dollars.

    Floats are truncated, never returned: the caller only ever returns
    a YES/NO string derived from this int, so no float reaches GenVM
    calldata.
    """
    if isinstance(value, bool):
        raise ValueError("not a price")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if "." in text:
            text = text.split(".")[0]
        text = text.strip()
        if text == "" or text == "-":
            raise ValueError("not a price")
        return int(text)
    raise ValueError("not a price")


def _opposite(side: str) -> str:
    if side == "YES":
        return "NO"
    return "YES"


class DuelForge(gl.Contract):
    duels: TreeMap[u256, str]
    duel_ids: DynArray[u256]
    players: TreeMap[u256, str]
    player_count: u256

    def __init__(self):
        self.player_count = u256(0)

    # -- deterministic helpers -------------------------------------------

    def _load_duel(self, duel_id: u256) -> dict:
        if duel_id not in self.duels:
            raise gl.vm.UserError("EXPECTED: duel_not_found")
        return json.loads(self.duels[duel_id])

    def _check_side(self, side: str) -> str:
        value = side.strip()
        if value != "YES" and value != "NO":
            raise gl.vm.UserError("EXPECTED: side_must_be_YES_or_NO")
        return value

    def _find_player(self, address: str):
        """Return (index, record) or (-1, None) without creating a player."""
        index = 0
        total = int(self.player_count)
        while index < total:
            record = json.loads(self.players[u256(index)])
            if record["address"] == address:
                return index, record
            index += 1
        return -1, None

    def _ensure_player(self, address: str):
        """Return (index, record), creating a starting-credit player if new."""
        index, record = self._find_player(address)
        if record is not None:
            return index, record
        record = {
            "address": address,
            "balance": STARTING_CREDIT,
            "wins": 0,
            "losses": 0,
        }
        index = int(self.player_count)
        self.players[u256(index)] = json.dumps(record)
        self.player_count = u256(index + 1)
        return index, record

    def _save_player(self, index: int, record: dict) -> None:
        self.players[u256(index)] = json.dumps(record)

    def _balance_or_starting(self, address: str) -> int:
        _, record = self._find_player(address)
        if record is None:
            return STARTING_CREDIT
        return int(record["balance"])

    # -- writes ------------------------------------------------------------

    @gl.public.write
    def create_duel(
        self,
        duel_id: u256,
        threshold: u256,
        side: str,
        stake: u256,
    ) -> u256:
        side = self._check_side(side)
        stake_int = int(stake)
        threshold_int = int(threshold)
        if stake_int <= 0:
            raise gl.vm.UserError("EXPECTED: stake_must_be_positive")
        if threshold_int <= 0:
            raise gl.vm.UserError("EXPECTED: threshold_must_be_positive")
        if duel_id in self.duels:
            raise gl.vm.UserError("EXPECTED: duel_id_already_exists")
        creator = str(gl.message.sender_address)
        # Balance check BEFORE creating the player record, so a failed
        # create does not mint a starting-credit player as a side effect.
        if self._balance_or_starting(creator) < stake_int:
            raise gl.vm.UserError("EXPECTED: insufficient_balance")
        creator_index, creator_record = self._ensure_player(creator)
        creator_record["balance"] = int(creator_record["balance"]) - stake_int
        self._save_player(creator_index, creator_record)
        duel = {
            "id": int(duel_id),
            "threshold": threshold_int,
            "creator": creator,
            "joiner": None,
            "creator_side": side,
            "joiner_side": None,
            "stake": stake_int,
            "pool": 0,
            "status": "OPEN",
            "winner_side": None,
            "winner": None,
            "settled_outcome": None,
        }
        self.duels[duel_id] = json.dumps(duel)
        self.duel_ids.append(duel_id)
        return duel_id

    @gl.public.write
    def join_duel(self, duel_id: u256, side: str) -> str:
        side = self._check_side(side)
        duel = self._load_duel(duel_id)
        if duel["status"] != "OPEN":
            raise gl.vm.UserError("EXPECTED: duel_not_open")
        joiner = str(gl.message.sender_address)
        if joiner == duel["creator"]:
            raise gl.vm.UserError("EXPECTED: cannot_join_own_duel")
        if side != _opposite(duel["creator_side"]):
            raise gl.vm.UserError("EXPECTED: join_side_must_be_opposite")
        stake_int = int(duel["stake"])
        # Balance check before creating the player record (see create).
        if self._balance_or_starting(joiner) < stake_int:
            raise gl.vm.UserError("EXPECTED: insufficient_balance")
        joiner_index, joiner_record = self._ensure_player(joiner)
        joiner_record["balance"] = int(joiner_record["balance"]) - stake_int
        self._save_player(joiner_index, joiner_record)
        duel["joiner"] = joiner
        duel["joiner_side"] = side
        duel["pool"] = stake_int * 2
        duel["status"] = "STAKED"
        self.duels[duel_id] = json.dumps(duel)
        return json.dumps(duel)

    @gl.public.write
    def settle_duel(self, duel_id: u256) -> str:
        duel = self._load_duel(duel_id)
        if duel["status"] != "STAKED":
            raise gl.vm.UserError("EXPECTED: duel_not_staked")
        threshold_int = int(duel["threshold"])

        def fetch_outcome() -> str:
            # Nondet block: no contract storage access here. Only the
            # captured threshold and the module-level source list are
            # used, and only a YES/NO string is returned.
            for url, kind in PRICE_SOURCES:
                try:
                    response = gl.nondet.web.get(url)
                except Exception:
                    continue
                if getattr(response, "status", 200) != 200:
                    continue
                body = response.body
                if isinstance(body, bytes):
                    text = body.decode("utf-8")
                else:
                    text = str(body)
                try:
                    data = json.loads(text)
                except Exception:
                    continue
                try:
                    if kind == "coindesk":
                        usd = data["bpi"]["USD"]
                        if "rate_float" in usd:
                            raw = usd["rate_float"]
                        else:
                            raw = usd["rate"]
                    else:
                        raw = data["bitcoin"]["usd"]
                    price = _to_int_dollars(raw)
                except Exception:
                    continue
                if price > threshold_int:
                    return "YES"
                return "NO"
            raise gl.vm.UserError("EXTERNAL: price_sources_unavailable")

        # Equivalence principle: strict equality on the outcome string
        # only. Validators independently fetch and derive YES/NO; the
        # exact price is never compared, so small timing/source
        # differences do not break consensus.
        outcome = gl.eq_principle.strict_eq(fetch_outcome)
        if outcome != "YES" and outcome != "NO":
            raise gl.vm.UserError("EXPECTED: invalid_settlement_outcome")
        if duel["creator_side"] == outcome:
            winner = duel["creator"]
            loser = duel["joiner"]
        else:
            winner = duel["joiner"]
            loser = duel["creator"]
        winner_index, winner_record = self._find_player(winner)
        loser_index, loser_record = self._find_player(loser)
        if winner_record is None or loser_record is None:
            raise gl.vm.UserError("EXPECTED: player_not_found")
        pool = int(duel["pool"])
        winner_record["balance"] = int(winner_record["balance"]) + pool
        winner_record["wins"] = int(winner_record["wins"]) + 1
        loser_record["losses"] = int(loser_record["losses"]) + 1
        self._save_player(winner_index, winner_record)
        self._save_player(loser_index, loser_record)
        duel["status"] = "SETTLED"
        duel["winner_side"] = outcome
        duel["winner"] = winner
        duel["settled_outcome"] = outcome
        self.duels[duel_id] = json.dumps(duel)
        return json.dumps(duel)

    # -- views -------------------------------------------------------------

    @gl.public.view
    def get_duel(self, duel_id: u256) -> str:
        return json.dumps(self._load_duel(duel_id))

    @gl.public.view
    def get_player(self, address: str) -> str:
        _, record = self._find_player(address.strip())
        if record is None:
            return json.dumps({
                "address": address.strip(),
                "balance": 0,
                "wins": 0,
                "losses": 0,
                "exists": False,
            })
        out = dict(record)
        out["exists"] = True
        return json.dumps(out)

    @gl.public.view
    def get_duel_count(self) -> u256:
        return u256(len(self.duel_ids))

    @gl.public.view
    def list_duels(self, offset: u256, limit: u256) -> str:
        if limit < 1 or limit > 20:
            raise gl.vm.UserError("EXPECTED: limit_must_be_1_to_20")
        total = len(self.duel_ids)
        start = int(offset)
        if start >= total:
            return json.dumps([])
        end = start + int(limit)
        if end > total:
            end = total
        out = []
        index = start
        while index < end:
            out.append(json.loads(self.duels[self.duel_ids[index]]))
            index += 1
        return json.dumps(out)

    @gl.public.view
    def get_leaderboard(self) -> str:
        players = []
        index = 0
        total = int(self.player_count)
        while index < total:
            players.append(json.loads(self.players[u256(index)]))
            index += 1
        # Bubble sort: wins desc, then balance desc. Small N by design.
        n = len(players)
        i = 0
        while i < n:
            j = 0
            while j + 1 < n - i:
                a = players[j]
                b = players[j + 1]
                swap = False
                if int(b["wins"]) > int(a["wins"]):
                    swap = True
                elif int(b["wins"]) == int(a["wins"]) and int(b["balance"]) > int(a["balance"]):
                    swap = True
                if swap:
                    players[j] = b
                    players[j + 1] = a
                j += 1
            i += 1
        return json.dumps(players)
