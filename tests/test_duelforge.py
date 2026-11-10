"""Local mocked tests for DuelForge -- SIMULATION ONLY, NOT chain results.

The contract's GenLayer imports are stubbed: gl.Contract is a plain
class, TreeMap/DynArray are dict/list, gl.public.write/view are
identity decorators, gl.message.sender_address is switchable, and
gl.eq_principle.strict_eq simply calls the nondet function (the
leader path). Consensus itself is only proven by the on-chain
FINALIZED settle transactions in evidence/deploy-results.json.
Nondet price fetching is mocked per test via a fake web.get that
returns a chosen CoinDesk-style payload.
Run: python3 tests/test_duelforge.py
"""
import importlib.util
import json
import sys
import types

# ---- stub genlayer module -------------------------------------------------
genlayer = types.ModuleType("genlayer")


class UserError(Exception):
    pass


class _VM:
    UserError = UserError


class _Message:
    sender_address = "0xCREATOR"


class _Web:
    # payload set by each test: {"price": <int|float|str>} or None = fail
    # fail_substrings: URL substrings that raise (simulates a source down)
    payload = None
    fail_substrings = []

    @staticmethod
    def get(url):
        for sub in _Web.fail_substrings:
            if sub in url:
                raise RuntimeError("source down (mocked)")
        if _Web.payload is None:
            raise RuntimeError("source down")
        price = _Web.payload["price"]
        if "coindesk" in url:
            body = json.dumps({"bpi": {"USD": {"rate_float": price}}}).encode()
        elif "ids=ethereum" in url:
            body = json.dumps({"ethereum": {"usd": price}}).encode()
        elif "coinbase" in url:
            body = json.dumps({"data": {"currency": "ETH", "rates": {"USD": str(price)}}}).encode()
        else:
            body = json.dumps({"bitcoin": {"usd": price}}).encode()
        resp = types.SimpleNamespace(status=200, body=body)
        return resp


class _Nondet:
    web = _Web


class _EqPrinciple:
    @staticmethod
    def strict_eq(fn):
        return fn()


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


class _GL:
    vm = _VM
    message = _Message
    nondet = _Nondet
    eq_principle = _EqPrinciple
    public = _Public

    class Contract:
        pass


class _TreeMap(dict):
    def __class_getitem__(cls, item):
        return dict


class _DynArray(list):
    def __class_getitem__(cls, item):
        return list


genlayer.gl = _GL()
genlayer.TreeMap = _TreeMap
genlayer.DynArray = _DynArray
genlayer.u256 = int
genlayer.__all__ = ["gl", "TreeMap", "DynArray", "u256"]
sys.modules["genlayer"] = genlayer

spec = importlib.util.spec_from_file_location(
    "duelforge", "contracts/duelforge.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
DuelForge = mod.DuelForge


def fresh():
    c = DuelForge()
    # emulate __init__ storage init (stub Contract has no GenVM init)
    c.duels = {}
    c.duel_ids = []
    c.players = {}
    c.player_count = 0
    return c


def as_addr(addr):
    _GL.message.sender_address = addr


CREATOR = "0xCREATOR"
JOINER = "0xJOINER"
THIRD = "0xTHIRD"

passed = []
failed = []


def check(name, fn):
    try:
        fn()
        passed.append(name)
        print(f"PASS: {name}")
    except Exception as e:
        failed.append((name, e))
        print(f"FAIL: {name}: {e!r}")


def expect_error(name, fn, needle):
    def wrapped():
        try:
            fn()
        except UserError as e:
            assert needle in str(e), f"error {e!r} lacks {needle!r}"
            return
        raise AssertionError("expected UserError, got success")
    check(name, wrapped)


def duel(c, did):
    return json.loads(c.get_duel(did))


def player(c, addr):
    return json.loads(c.get_player(addr))


# 1. Happy path, YES branch (mocked $76,921 > $50,000)
def t_yes_branch():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    assert duel(c, 0)["status"] == "OPEN"
    assert duel(c, 0)["asset"] == "BTC"
    assert player(c, CREATOR)["balance"] == 900  # 1000 starting - 100 stake
    as_addr(JOINER)
    c.join_duel(0, "NO")
    d = duel(c, 0)
    assert d["status"] == "STAKED" and d["pool"] == 200
    assert player(c, JOINER)["balance"] == 900
    _Web.payload = {"price": 76921}
    c.settle_duel(0)
    d = duel(c, 0)
    assert d["status"] == "SETTLED", d
    assert d["winner_side"] == "YES" and d["winner"] == CREATOR, d
    assert player(c, CREATOR)["balance"] == 1100, player(c, CREATOR)
    assert player(c, CREATOR)["wins"] == 1
    assert player(c, JOINER)["losses"] == 1
    assert player(c, JOINER)["balance"] == 900
    lb = json.loads(c.get_leaderboard())
    assert lb[0]["address"] == CREATOR and lb[1]["address"] == JOINER, lb


check("happy path YES branch (76921 > 50000, pool to creator)", t_yes_branch)


# 2. NO branch (mocked $76,921 < $100,000)
def t_no_branch():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(1, "BTC", 100000, "YES", 100)
    as_addr(JOINER)
    c.join_duel(1, "NO")
    _Web.payload = {"price": 76921}
    c.settle_duel(1)
    d = duel(c, 1)
    assert d["status"] == "SETTLED" and d["winner_side"] == "NO", d
    assert d["winner"] == JOINER, d
    assert player(c, JOINER)["balance"] == 1100
    assert player(c, CREATOR)["balance"] == 900


check("NO branch (76921 < 100000, pool to joiner)", t_no_branch)


# 3. Duplicate duel id rejected
def t_dup():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    as_addr(JOINER)
    try:
        c.create_duel(0, "BTC", 50000, "NO", 100)
    except UserError as e:
        assert "duel_id_already_exists" in str(e)
        return
    raise AssertionError("duplicate accepted")


check("duplicate duel id rejected", t_dup)


# 4. Double-join / join own duel rejected; join after STAKED rejected
def t_double_join():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    # creator cannot join own duel
    try:
        c.join_duel(0, "NO")
    except UserError as e:
        assert "cannot_join_own_duel" in str(e)
    else:
        raise AssertionError("own join accepted")
    as_addr(JOINER)
    c.join_duel(0, "NO")
    as_addr(THIRD)
    try:
        c.join_duel(0, "YES")
    except UserError as e:
        assert "duel_not_open" in str(e)
    else:
        raise AssertionError("second join accepted")


check("double-join / own-join / join-after-staked rejected", t_double_join)


# 5. Wrong side on join rejected
def t_wrong_side():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    as_addr(JOINER)
    try:
        c.join_duel(0, "YES")
    except UserError as e:
        assert "join_side_must_be_opposite" in str(e)
        return
    raise AssertionError("same-side join accepted")


check("wrong (same) side on join rejected", t_wrong_side)


# 6. Settle from OPEN rejected
def t_settle_open():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    _Web.payload = {"price": 76921}
    try:
        c.settle_duel(0)
    except UserError as e:
        assert "duel_not_staked" in str(e)
        return
    raise AssertionError("settle-from-OPEN accepted")


check("settle-from-OPEN rejected", t_settle_open)


# 7. Pool distributed exactly once: second settle rejected, balances unchanged
def t_pool_once():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    as_addr(JOINER)
    c.join_duel(0, "NO")
    _Web.payload = {"price": 76921}
    c.settle_duel(0)
    before = player(c, CREATOR)
    try:
        c.settle_duel(0)
    except UserError as e:
        assert "duel_not_staked" in str(e)
    else:
        raise AssertionError("re-settle accepted")
    assert player(c, CREATOR) == before, "balance changed on re-settle"
    assert duel(c, 0)["status"] == "SETTLED"


check("pool distributed exactly once (re-settle rejected, balances unchanged)", t_pool_once)


# 8. Negative-balance guard: stake above starting credit rejected, no player minted
def t_negative():
    c = fresh()
    as_addr(CREATOR)
    try:
        c.create_duel(0, "BTC", 50000, "YES", 2000)
    except UserError as e:
        assert "insufficient_balance" in str(e)
    else:
        raise AssertionError("over-balance stake accepted")
    assert player(c, CREATOR)["exists"] is False, "failed create minted a player"
    assert c.get_duel_count() == 0


check("negative-balance guard (stake > 1000 rejected, no player minted)", t_negative)


# 9. Invalid inputs: stake 0, threshold 0, bad side
expect_error("stake 0 rejected", lambda: (as_addr(CREATOR), fresh().create_duel(0, "BTC", 50000, "YES", 0))[1], "stake_must_be_positive")
expect_error("threshold 0 rejected", lambda: (as_addr(CREATOR), fresh().create_duel(0, "BTC", 0, "YES", 100))[1], "threshold_must_be_positive")
expect_error("bad side rejected", lambda: (as_addr(CREATOR), fresh().create_duel(0, "BTC", 50000, "MAYBE", 100))[1], "side_must_be_YES_or_NO")


# 10. Settled duel immutable: join after settle rejected
def t_immutable():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    as_addr(JOINER)
    c.join_duel(0, "NO")
    _Web.payload = {"price": 76921}
    c.settle_duel(0)
    as_addr(THIRD)
    try:
        c.join_duel(0, "YES")
    except UserError as e:
        assert "duel_not_open" in str(e)
        return
    raise AssertionError("join after settle accepted")


check("settled duel immutable (join after settle rejected)", t_immutable)


# 11. Price parsing: float payload and comma string payload both give int dollars
def t_price_parse():
    assert mod._to_int_dollars(76921) == 76921
    assert mod._to_int_dollars(76921.99) == 76921
    assert mod._to_int_dollars("76,921.45") == 76921
    assert mod._to_int_dollars("76921") == 76921


check("price parsing int/float/comma-string -> int dollars, no float returned", t_price_parse)


# 12. Duel count / list views
def t_count_list():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    c.create_duel(1, "BTC", 100000, "NO", 50)
    assert c.get_duel_count() == 2
    lst = json.loads(c.list_duels(0, 20))
    assert [d["id"] for d in lst] == [0, 1], lst


check("duel count and list views", t_count_list)


# 13. ETH duel end-to-end, YES branch (mocked $2,120 > $1,500)
def t_eth_yes():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "ETH", 1500, "YES", 100)
    d = duel(c, 0)
    assert d["asset"] == "ETH" and d["status"] == "OPEN", d
    as_addr(JOINER)
    c.join_duel(0, "NO")
    _Web.payload = {"price": 2120}
    _Web.fail_substrings = []
    c.settle_duel(0)
    d = duel(c, 0)
    assert d["status"] == "SETTLED" and d["winner_side"] == "YES", d
    assert d["winner"] == CREATOR and d["asset"] == "ETH"
    assert player(c, CREATOR)["balance"] == 1100
    assert player(c, CREATOR)["wins"] == 1


check("ETH duel end-to-end YES branch (2120 > 1500, pool to creator)", t_eth_yes)


# 14. ETH settle falls back to Coinbase when CoinGecko is down
def t_eth_fallback():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "ETH", 1500, "YES", 100)
    as_addr(JOINER)
    c.join_duel(0, "NO")
    _Web.payload = {"price": 2120}
    _Web.fail_substrings = ["coingecko"]
    try:
        c.settle_duel(0)
    finally:
        _Web.fail_substrings = []
    d = duel(c, 0)
    assert d["status"] == "SETTLED" and d["winner_side"] == "YES", d
    assert player(c, CREATOR)["balance"] == 1100


check("ETH settle falls back to Coinbase when CoinGecko is down", t_eth_fallback)


# 15. ETH NO branch (mocked $2,120 < $3,000)
def t_eth_no():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "ETH", 3000, "YES", 100)
    as_addr(JOINER)
    c.join_duel(0, "NO")
    _Web.payload = {"price": 2120}
    _Web.fail_substrings = []
    c.settle_duel(0)
    d = duel(c, 0)
    assert d["status"] == "SETTLED" and d["winner_side"] == "NO", d
    assert d["winner"] == JOINER
    assert player(c, JOINER)["balance"] == 1100


check("ETH duel NO branch (2120 < 3000, pool to joiner)", t_eth_no)


# 16. Unknown asset rejected before any write: no duel, no player minted
def t_bad_asset():
    c = fresh()
    as_addr(CREATOR)
    try:
        c.create_duel(0, "SOL", 50000, "YES", 100)
    except UserError as e:
        assert "asset_must_be_BTC_or_ETH" in str(e)
    else:
        raise AssertionError("unknown asset accepted")
    assert c.get_duel_count() == 0
    assert player(c, CREATOR)["exists"] is False, "failed create minted a player"
    # lowercase asset is normalized, not rejected
    c.create_duel(0, "eth", 1500, "YES", 100)
    assert duel(c, 0)["asset"] == "ETH"


check("unknown asset rejected pre-write (no duel/player); lowercase normalized", t_bad_asset)


# 17. Cancel by creator: refund in full, duel CANCELLED, records unchanged
def t_cancel():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    assert player(c, CREATOR)["balance"] == 900
    out = json.loads(c.cancel_duel(0))
    assert out["status"] == "CANCELLED", out
    assert out["pool"] == 0
    assert player(c, CREATOR)["balance"] == 1000, player(c, CREATOR)
    assert player(c, CREATOR)["wins"] == 0 and player(c, CREATOR)["losses"] == 0
    assert duel(c, 0)["status"] == "CANCELLED"


check("cancel by creator refunds stake in full, duel CANCELLED", t_cancel)


# 18. Cancel by non-creator rejected; duel stays OPEN, balance unchanged
def t_cancel_non_creator():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    as_addr(JOINER)
    try:
        c.cancel_duel(0)
    except UserError as e:
        assert "only_creator_can_cancel" in str(e)
    else:
        raise AssertionError("non-creator cancel accepted")
    assert duel(c, 0)["status"] == "OPEN"
    assert player(c, CREATOR)["balance"] == 900


check("cancel by non-creator rejected, duel stays OPEN", t_cancel_non_creator)


# 19. Cancel non-OPEN rejected (STAKED and SETTLED)
def t_cancel_non_open():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    as_addr(JOINER)
    c.join_duel(0, "NO")
    as_addr(CREATOR)
    try:
        c.cancel_duel(0)
    except UserError as e:
        assert "duel_not_open" in str(e)
    else:
        raise AssertionError("cancel of STAKED accepted")
    assert duel(c, 0)["status"] == "STAKED"
    _Web.payload = {"price": 76921}
    c.settle_duel(0)
    try:
        c.cancel_duel(0)
    except UserError as e:
        assert "duel_not_open" in str(e)
    else:
        raise AssertionError("cancel of SETTLED accepted")
    assert duel(c, 0)["status"] == "SETTLED"


check("cancel of STAKED / SETTLED rejected", t_cancel_non_open)


# 20. Join and settle on CANCELLED both rejected
def t_cancelled_terminal():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    c.cancel_duel(0)
    as_addr(JOINER)
    try:
        c.join_duel(0, "NO")
    except UserError as e:
        assert "duel_not_open" in str(e)
    else:
        raise AssertionError("join of CANCELLED accepted")
    _Web.payload = {"price": 76921}
    try:
        c.settle_duel(0)
    except UserError as e:
        assert "duel_not_staked" in str(e)
    else:
        raise AssertionError("settle of CANCELLED accepted")
    assert duel(c, 0)["status"] == "CANCELLED"
    assert player(c, CREATOR)["balance"] == 1000


check("join and settle on CANCELLED rejected, duel stays CANCELLED", t_cancelled_terminal)


# 21. BTC and ETH duels coexist on one contract
def t_mixed_assets():
    c = fresh()
    as_addr(CREATOR)
    c.create_duel(0, "BTC", 50000, "YES", 100)
    c.create_duel(1, "ETH", 1500, "YES", 100)
    assert c.get_duel_count() == 2
    lst = json.loads(c.list_duels(0, 20))
    assert [d["asset"] for d in lst] == ["BTC", "ETH"], lst


check("BTC and ETH duels coexist (list shows both assets)", t_mixed_assets)


print(f"\n{len(passed)} passed, {len(failed)} failed")
if failed:
    sys.exit(1)
print("All local mocked tests passed (SIMULATION ONLY -- not chain results).")
