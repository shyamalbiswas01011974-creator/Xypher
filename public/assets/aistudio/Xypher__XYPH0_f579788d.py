#!/usr/bin/env python3
"""Xypher (XYPH) — single-file reference node. No third-party dependencies.

    python xypher.py selftest
    python xypher.py init && python xypher.py address new
    python xypher.py mine --to X...
    python xypher.py node --port 9333

Environment:
    XYPH_DATA      data directory (default ./xypher-data)
    XYPH_PROFILE   "main" (default) or "fast" for 15s dev blocks
    XYPH_MATURITY  coinbase maturity, default 100 (5 on the fast profile)
"""
import argparse
import hashlib
import hmac
import json
import os
import shutil
import socket
import struct
import sys
import tempfile
import threading
import time
from decimal import Decimal

# =====================================================================
# CONSENSUS PARAMETERS
# =====================================================================
NAME, SYMBOL, DECIMALS = "Xypher", "XYPH", 8
UNIT = 10 ** DECIMALS
PROFILE = os.environ.get("XYPH_PROFILE", "main")

if PROFILE == "fast":
    TARGET_BLOCK_TIME, RETARGET_INTERVAL, HALVING_INTERVAL = 15, 32, 5_250
else:
    TARGET_BLOCK_TIME, RETARGET_INTERVAL, HALVING_INTERVAL = 600, 2016, 525_600

MAX_BLOCKS = 3_000_000
BLOCK_SUBSIDY = 20 * UNIT
MINER_SHARE = 10 * UNIT
FUND_SHARE = BLOCK_SUBSIDY - MINER_SHARE
MAX_MONEY = MAX_BLOCKS * BLOCK_SUBSIDY
COINBASE_MATURITY = int(os.environ.get("XYPH_MATURITY", "5" if PROFILE == "fast" else "100"))
MAX_BLOCK_BYTES = 1_000_000
MAX_TARGET = 0x00000000FFFF0000000000000000000000000000000000000000000000000000
GENESIS_TAG = "Xypher genesis / XYPH / v1"
GENESIS_TIME = 1_760_000_000
ZERO32 = "00" * 32

DATA = os.environ.get("XYPH_DATA", "./xypher-data")
CHAIN_PATH = os.path.join(DATA, "chain.jsonl")
KEYS_PATH = os.path.join(DATA, "wallet.json")

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
ADDR_VERSION, WIF_VERSION = 0x58, 0xA8

# =====================================================================
# HASHING
# =====================================================================
def sha256(b): return hashlib.sha256(b).digest()
def dsha256(b): return sha256(sha256(b))


def hash160(b):
    try:
        h = hashlib.new("ripemd160"); h.update(sha256(b)); return h.digest()
    except ValueError:
        return sha256(b)[:20]


# =====================================================================
# BASE58
# =====================================================================
def b58encode(raw):
    n, out = int.from_bytes(raw, "big"), ""
    while n:
        n, r = divmod(n, 58); out = B58[r] + out
    return "1" * (len(raw) - len(raw.lstrip(b"\x00"))) + out


def b58decode(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\x00" * (len(s) - len(s.lstrip("1"))) + body


def b58check(p): return b58encode(p + dsha256(p)[:4])


def b58check_decode(s):
    raw = b58decode(s)
    payload, chk = raw[:-4], raw[-4:]
    if dsha256(payload)[:4] != chk:
        raise ValueError("bad checksum")
    return payload


# =====================================================================
# SECP256K1 (pure Python, Jacobian coordinates)
# =====================================================================
P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8
G = (GX, GY)
INF = (0, 1, 0)


def _jdouble(pt):
    X, Y, Z = pt
    if Y == 0:
        return INF
    yy = Y * Y % P
    s = 4 * X * yy % P
    m = 3 * X * X % P
    x3 = (m * m - 2 * s) % P
    y3 = (m * (s - x3) - 8 * yy * yy) % P
    return (x3, y3, 2 * Y * Z % P)


def _jadd(a, b):
    if a[2] == 0:
        return b
    if b[2] == 0:
        return a
    x1, y1, z1 = a; x2, y2, z2 = b
    z1z1 = z1 * z1 % P; z2z2 = z2 * z2 % P
    u1 = x1 * z2z2 % P; u2 = x2 * z1z1 % P
    s1 = y1 * z2 * z2z2 % P; s2 = y2 * z1 * z1z1 % P
    if u1 == u2:
        return _jdouble(a) if s1 == s2 else INF
    h = (u2 - u1) % P; r = (s2 - s1) % P
    h2 = h * h % P; h3 = h * h2 % P
    x3 = (r * r - h3 - 2 * u1 * h2) % P
    y3 = (r * (u1 * h2 - x3) - s1 * h3) % P
    return (x3, y3, h * z1 * z2 % P)


def _jmul(pt, k):
    k %= N
    out, add = INF, (pt[0], pt[1], 1)
    while k:
        if k & 1:
            out = _jadd(out, add)
        add = _jdouble(add)
        k >>= 1
    return out


def _to_affine(j):
    X, Y, Z = j
    if Z == 0:
        return None
    zi = pow(Z, P - 2, P); zi2 = zi * zi % P
    return (X * zi2 % P, Y * zi2 * zi % P)


def _mul(pt, k):
    return _to_affine(_jmul(pt, k))


def _add(a, b):
    if a is None: return b
    if b is None: return a
    x1, y1 = a; x2, y2 = b
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = 3 * x1 * x1 % P * pow(2 * y1 % P, P - 2, P) % P
    else:
        lam = (y2 - y1) % P * pow((x2 - x1) % P, P - 2, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return (x3, (lam * (x1 - x3) - y1) % P)


def _ser(pt): return pt[0].to_bytes(32, "big") + pt[1].to_bytes(32, "big")


def _deser(raw):
    if len(raw) == 65 and raw[0] == 4:
        raw = raw[1:]
    if len(raw) != 64:
        raise ValueError("bad public key length")
    x = int.from_bytes(raw[:32], "big"); y = int.from_bytes(raw[32:], "big")
    if (y * y - x * x * x - 7) % P:
        raise ValueError("point not on curve")
    return (x, y)


def _der_int(i):
    b = i.to_bytes((i.bit_length() + 7) // 8 or 1, "big")
    if b[0] & 0x80:
        b = b"\x00" + b
    return b"\x02" + bytes([len(b)]) + b


def _der(r, s):
    body = _der_int(r) + _der_int(s)
    return b"\x30" + bytes([len(body)]) + body


def _under(der):
    if len(der) < 8 or der[0] != 0x30:
        raise ValueError("bad DER")
    i, out = 2, []
    for _ in range(2):
        if der[i] != 0x02:
            raise ValueError("bad DER")
        ln = der[i + 1]; i += 2
        out.append(int.from_bytes(der[i:i + ln], "big")); i += ln
    return out[0], out[1]


def _rfc6979_k(d, z):
    x = d.to_bytes(32, "big"); h = z.to_bytes(32, "big")
    v = b"\x01" * 32; k = b"\x00" * 32
    k = hmac.new(k, v + b"\x00" + x + h, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    k = hmac.new(k, v + b"\x01" + x + h, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    while True:
        v = hmac.new(k, v, hashlib.sha256).digest()
        cand = int.from_bytes(v, "big")
        if 1 <= cand < N:
            return cand
        k = hmac.new(k, v + b"\x00", hashlib.sha256).digest()
        v = hmac.new(k, v, hashlib.sha256).digest()


def sign_digest(sk, digest):
    d = int.from_bytes(sk.to_string(), "big")
    z = int.from_bytes(digest, "big") % N
    while True:
        k = _rfc6979_k(d, z)
        R = _mul(G, k)
        if R is None:
            continue
        r = R[0] % N
        if r == 0:
            continue
        s = pow(k, N - 2, N) * (z + r * d) % N
        if s == 0:
            continue
        if s > N // 2:
            s = N - s
        return _der(r, s)


def verify_digest(pub, sig, digest):
    try:
        Q = _deser(pub)
        r, s = _under(sig)
        if not (1 <= r < N and 1 <= s < N):
            return False
        z = int.from_bytes(digest, "big") % N
        w = pow(s, N - 2, N)
        R = _add(_mul(G, z * w), _mul(Q, r * w))
        return R is not None and R[0] % N == r
    except Exception:
        return False


class Key:
    def __init__(self, raw):
        if len(raw) != 32:
            raise ValueError("bad private key")
        self.raw = raw

    def to_string(self): return self.raw

    def get_verifying_key(self):
        return PubKey(_mul(G, int.from_bytes(self.raw, "big")))


class PubKey:
    def __init__(self, pt):
        self.pt = pt

    def to_string(self): return _ser(self.pt)


def new_key():
    while True:
        raw = os.urandom(32)
        if 1 <= int.from_bytes(raw, "big") < N:
            return Key(raw)


def key_to_wif(sk): return b58check(bytes([WIF_VERSION]) + sk.to_string())


def wif_to_key(w):
    p = b58check_decode(w)
    if p[0] != WIF_VERSION:
        raise ValueError("not a WIF key")
    return Key(p[1:])


def pubkey(sk): return sk.get_verifying_key().to_string()
def address(sk): return b58check(bytes([ADDR_VERSION]) + hash160(pubkey(sk)))


def is_address(a):
    try:
        p = b58check_decode(a)
        return len(p) == 21 and p[0] == ADDR_VERSION
    except Exception:
        return False


def sign(sk, digest): return sign_digest(sk, digest)
def verify(pub, digest, sig): return verify_digest(pub, sig, digest)


def merkle_root(txids):
    if not txids:
        return b"\x00" * 32
    layer = [bytes.fromhex(t) for t in txids]
    while len(layer) > 1:
        if len(layer) % 2:
            layer.append(layer[-1])
        layer = [dsha256(layer[i] + layer[i + 1]) for i in range(0, len(layer), 2)]
    return layer[0]


# =====================================================================
# TRANSACTIONS
# =====================================================================
class TxIn:
    __slots__ = ("prev_txid", "index", "pub", "sig")

    def __init__(self, prev_txid, index, pub="", sig=""):
        self.prev_txid, self.index, self.pub, self.sig = prev_txid, index, pub, sig

    def to_dict(self):
        return {"prev_txid": self.prev_txid, "index": self.index,
                "pub": self.pub, "sig": self.sig}

    @classmethod
    def from_dict(cls, d):
        return cls(d["prev_txid"], d["index"], d.get("pub", ""), d.get("sig", ""))


class TxOut:
    __slots__ = ("value", "addr")

    def __init__(self, value, addr):
        self.value, self.addr = value, addr

    def to_dict(self): return {"value": self.value, "addr": self.addr}

    @classmethod
    def from_dict(cls, d): return cls(d["value"], d["addr"])


class Tx:
    def __init__(self, version=1, ins=None, outs=None):
        self.version, self.ins, self.outs = version, ins or [], outs or []

    def _stripped(self):
        return {"v": self.version,
                "ins": [{"prev_txid": i.prev_txid, "index": i.index} for i in self.ins],
                "outs": [o.to_dict() for o in self.outs]}

    def txid(self):
        return dsha256(json.dumps(self._stripped(), sort_keys=True).encode()).hex()

    def sighash(self, idx):
        d = self._stripped()
        d["ins"][idx]["pub"] = self.ins[idx].pub
        payload = (json.dumps(d, sort_keys=True).encode() + b"|" +
                   bytes.fromhex(self.ins[idx].prev_txid) +
                   self.ins[idx].index.to_bytes(4, "little"))
        return dsha256(payload)

    def sign_input(self, idx, sk):
        self.ins[idx].pub = pubkey(sk).hex()
        self.ins[idx].sig = sign(sk, self.sighash(idx)).hex()

    def verify_input(self, idx):
        try:
            return verify(bytes.fromhex(self.ins[idx].pub),
                          self.sighash(idx), bytes.fromhex(self.ins[idx].sig))
        except Exception:
            return False

    def is_coinbase(self):
        return len(self.ins) == 1 and self.ins[0].prev_txid == ZERO32

    def check_shape(self):
        if not self.ins: return "no-inputs"
        if not self.outs: return "no-outputs"
        if sum(o.value for o in self.outs) > MAX_MONEY: return "output-overflow"
        for o in self.outs:
            if o.value < 0: return "negative-output"
            if not is_address(o.addr): return "bad-address"
        if not self.is_coinbase():
            seen = set()
            for i in self.ins:
                k = (i.prev_txid, i.index)
                if k in seen: return "duplicate-input"
                seen.add(k)
        return None

    def to_dict(self):
        return {"v": self.version,
                "ins": [i.to_dict() for i in self.ins],
                "outs": [o.to_dict() for o in self.outs]}

    @classmethod
    def from_dict(cls, d):
        return cls(d.get("v", 1),
                   [TxIn.from_dict(x) for x in d["ins"]],
                   [TxOut.from_dict(x) for x in d["outs"]])


# =====================================================================
# BLOCKS
# =====================================================================
class Block:
    def __init__(self, height, prev, txs, time=0, target=None, nonce=0, version=1):
        self.version, self.height, self.prev = version, height, prev
        self.txs, self.time = txs, time
        self.target = MAX_TARGET if target is None else target
        self.nonce = nonce

    def merkle(self):
        return merkle_root([t.txid() for t in self.txs])

    def header(self):
        return (struct.pack("<I", self.version) + self.height.to_bytes(4, "little") +
                bytes.fromhex(self.prev) + self.merkle() +
                struct.pack("<Q", self.time) + self.target.to_bytes(32, "big") +
                self.nonce.to_bytes(8, "little"))

    @property
    def hash(self):
        return dsha256(self.header()).hex()

    def pow_ok(self):
        return int(self.hash, 16) <= self.target

    def size(self):
        return len(json.dumps(self.to_dict()))

    def to_dict(self):
        return {"version": self.version, "height": self.height, "prev": self.prev,
                "time": self.time, "target": self.target, "nonce": self.nonce,
                "txs": [t.to_dict() for t in self.txs]}

    @classmethod
    def from_dict(cls, d):
        return cls(d["height"], d["prev"], [Tx.from_dict(t) for t in d["txs"]],
                   d["time"], d["target"], d["nonce"], d.get("version", 1))


# =====================================================================
# CHAIN
# =====================================================================
class Chain:
    def __init__(self, path, meta):
        self.path, self.meta = path, meta
        self.lock = threading.RLock()
        self.all, self.utxo, self.mempool = {}, {}, {}
        self.tip, self.height = None, -1

    @classmethod
    def open(cls, path):
        with open(path) as f:
            lines = [l for l in f if l.strip()]
        c = cls(path, json.loads(lines[0])["meta"])
        for line in lines[1:]:
            b = Block.from_dict(json.loads(line))
            c.all[b.hash] = b
        err, _ = c._replay_best()
        if err:
            raise RuntimeError(f"corrupt chain: {err}")
        return c

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            f.write(json.dumps({"meta": self.meta}) + "\n")
            for b in self.all.values():
                f.write(json.dumps(b.to_dict()) + "\n")
        os.replace(tmp, self.path)

    def subsidy(self, height):
        if height >= MAX_BLOCKS:
            return 0
        era = height // HALVING_INTERVAL
        return 0 if era >= 64 else BLOCK_SUBSIDY >> era

    def next_target(self, height):
        if height == 0:
            return MAX_TARGET
        last = self.all[self.tip.hash]
        if height % RETARGET_INTERVAL:
            return last.target
        first = self.tip
        for _ in range(RETARGET_INTERVAL - 1):
            first = self.all[first.prev]
        actual = max(1, last.time - first.time)
        expected = TARGET_BLOCK_TIME * RETARGET_INTERVAL
        new = last.target * actual // expected
        new = min(max(new, last.target // 4), last.target * 4)
        return min(new, MAX_TARGET)

    def median_time_past(self):
        times, b = [], self.tip
        while b and len(times) < 11:
            times.append(b.time); b = self.all.get(b.prev)
        times.sort()
        return times[len(times) // 2]

    def _validate_tx(self, tx, seen=None):
        err = tx.check_shape()
        if err:
            return err, 0
        if tx.is_coinbase():
            return None, 0
        total_in = 0
        for i, inp in enumerate(tx.ins):
            key = (inp.prev_txid, inp.index)
            out = self.utxo.get(key)
            if out is None:
                return "missing-input", 0
            value, _addr, h, is_cb = out
            if is_cb and (self.height + 1) - h < COINBASE_MATURITY:
                return "immature-coinbase", 0
            if seen is not None:
                if key in seen:
                    return "double-spend-in-block", 0
                seen.add(key)
            if not tx.verify_input(i):
                return "bad-signature", 0
            total_in += value
        total_out = sum(o.value for o in tx.outs)
        if total_out > total_in:
            return "overspend", 0
        return None, total_in - total_out

    def _validate_block(self, b):
        expected_prev = ZERO32 if b.height == 0 else self.tip.hash
        if b.prev != expected_prev: return "bad-prev"
        if b.height != self.height + 1: return "bad-height"
        if b.target != self.next_target(b.height): return "bad-target"
        if not b.pow_ok(): return "bad-pow"
        if b.merkle() != merkle_root([t.txid() for t in b.txs]): return "bad-merkle"
        if b.size() > MAX_BLOCK_BYTES: return "too-big"
        if b.time > int(time.time()) + 7200: return "time-too-new"
        if b.height > 0 and b.time <= self.median_time_past(): return "time-too-old"
        if not b.txs or not b.txs[0].is_coinbase(): return "missing-coinbase"
        if sum(t.is_coinbase() for t in b.txs) != 1: return "multiple-coinbase"
        if b.txs[0].ins[0].index != b.height: return "bad-coinbase-index"
        err = b.txs[0].check_shape()
        if err: return "bad-coinbase:" + err

        fees, seen = 0, set()
        for tx in b.txs[1:]:
            err, fee = self._validate_tx(tx, seen)
            if err:
                return err
            fees += fee

        subsidy = self.subsidy(b.height)
        if sum(o.value for o in b.txs[0].outs) > subsidy + fees:
            return "coinbase-overpay"
        if b.height > 0:
            fund = subsidy - subsidy // 2
            if fund and not any(o.addr == self.meta["fund_address"] and o.value == fund
                                for o in b.txs[0].outs):
                return "missing-fund-output"
        return None

    def _connect(self, b):
        cb = b.txs[0]
        for i, o in enumerate(cb.outs):
            self.utxo[(cb.txid(), i)] = (o.value, o.addr, b.height, True)
        for tx in b.txs[1:]:
            for inp in tx.ins:
                self.utxo.pop((inp.prev_txid, inp.index), None)
            for i, o in enumerate(tx.outs):
                self.utxo[(tx.txid(), i)] = (o.value, o.addr, b.height, False)
        self.tip, self.height = b, b.height

    def _best_tip(self):
        children = {}
        for h, b in self.all.items():
            children.setdefault(b.prev, []).append(h)
        genesis = next((b for b in self.all.values() if b.height == 0), None)
        if genesis is None:
            return None
        best, best_work, stack = genesis, 0, [(genesis, 0)]
        while stack:
            b, work = stack.pop()
            work += MAX_TARGET // b.target
            if work > best_work:
                best, best_work = b, work
            for h in children.get(b.hash, []):
                stack.append((self.all[h], work))
        return best

    def _replay_best(self):
        tip = self._best_tip()
        if tip is None:
            return "empty", None
        path, b = [], tip
        while b:
            path.append(b); b = self.all.get(b.prev)
        path.reverse()
        self.utxo, self.tip, self.height = {}, None, -1
        for b in path:
            err = self._validate_block(b)
            if err:
                return err, b
            self._connect(b)
        return None, None

    def add_block(self, b):
        with self.lock:
            if b.hash in self.all:
                return True, "duplicate"
            self.all[b.hash] = b
            err, _bad = self._replay_best()
            if err:
                self.all.pop(b.hash, None)
                self._replay_best()
                return False, err
            self._prune_mempool()
            self.save()
            return True, "ok"

    def add_tx(self, tx):
        with self.lock:
            if tx.is_coinbase():
                return False, "coinbase"
            if tx.txid() in self.mempool:
                return True, "duplicate"
            err, _fee = self._validate_tx(tx)
            if err:
                return False, err
            spent = {(i.prev_txid, i.index) for t in self.mempool.values() for i in t.ins}
            if any((i.prev_txid, i.index) in spent for i in tx.ins):
                return False, "mempool-conflict"
            self.mempool[tx.txid()] = tx
            return True, "ok"

    def _prune_mempool(self):
        for tid, tx in list(self.mempool.items()):
            if any((i.prev_txid, i.index) not in self.utxo for i in tx.ins):
                del self.mempool[tid]

    def balance(self, addr):
        return sum(v for v, a, _h, _c in self.utxo.values() if a == addr)

    def coins_for(self, addr):
        return [(k, v) for k, (v, a, _h, _c) in self.utxo.items() if a == addr]

    def spendable(self, addr):
        out = []
        for k, (value, a, h, is_cb) in self.utxo.items():
            if a != addr:
                continue
            if is_cb and (self.height + 1) - h < COINBASE_MATURITY:
                continue
            out.append((k, value))
        return out

    def make_genesis(self):
        cb = Tx(1, [TxIn(ZERO32, 0, "", sha256(GENESIS_TAG.encode()).hex())],
                [TxOut(BLOCK_SUBSIDY, self.meta["fund_address"])])
        b = Block(0, ZERO32, [cb], time=GENESIS_TIME)
        while not b.pow_ok():
            b.nonce += 1
        return b


def init_chain(data_dir):
    os.makedirs(data_dir, exist_ok=True)
    path = os.path.join(data_dir, "chain.jsonl")
    if os.path.exists(path):
        raise SystemExit("chain already initialised in " + data_dir)
    fund = new_key()
    meta = {"name": NAME, "symbol": SYMBOL, "profile": PROFILE,
            "fund_address": address(fund)}
    c = Chain(path, meta)
    ok, msg = c.add_block(c.make_genesis())
    if not ok:
        raise SystemExit("genesis failed: " + msg)
    return c, fund


# =====================================================================
# WALLET
# =====================================================================
def load_keys(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [wif_to_key(w) for w in json.load(f)["keys"]]


def save_keys(path, keys):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"keys": [key_to_wif(k) for k in keys]}, f, indent=2)
    os.replace(tmp, path)


def add_key(path, key):
    keys = load_keys(path); keys.append(key); save_keys(path, keys)
    return address(key)


def build_payment(chain, sk, to, amount, fee):
    if amount <= 0:
        raise ValueError("amount must be positive")
    if fee < 0:
        raise ValueError("fee must not be negative")
    frm = address(sk)
    need = amount + fee
    picked, total = [], 0
    for (txid, idx), value in sorted(chain.spendable(frm), key=lambda x: -x[1]):
        picked.append((txid, idx)); total += value
        if total >= need:
            break
    if total < need:
        raise ValueError(f"insufficient spendable funds: have {total/UNIT:.8f}, "
                         f"need {need/UNIT:.8f}")
    outs = [TxOut(amount, to)]
    if total - need:
        outs.append(TxOut(total - need, frm))
    tx = Tx(1, [TxIn(t, i) for t, i in picked], outs)
    for i in range(len(tx.ins)):
        tx.sign_input(i, sk)
    return tx


# =====================================================================
# MINER
# =====================================================================
def build_template(chain, miner_addr):
    height = chain.height + 1
    subsidy = chain.subsidy(height)
    fund = chain.meta["fund_address"]

    chosen, fees, spent = [], 0, set()
    for tx in chain.mempool.values():
        if any((i.prev_txid, i.index) in spent for i in tx.ins):
            continue
        try:
            fee = (sum(chain.utxo[(i.prev_txid, i.index)][0] for i in tx.ins)
                   - sum(o.value for o in tx.outs))
        except KeyError:
            continue
        if fee < 0:
            continue
        chosen.append(tx); fees += fee
        spent |= {(i.prev_txid, i.index) for i in tx.ins}

    outs = [TxOut(subsidy - subsidy // 2, fund), TxOut(subsidy // 2 + fees, miner_addr)]
    coinbase = Tx(1, [TxIn(ZERO32, height, "", sha256(b"%d" % height).hex())], outs)
    return Block(height, chain.tip.hash, [coinbase] + chosen,
                 time=int(time.time()) + 1, target=chain.next_target(height))


def mine(chain, miner_addr, log_every=100_000):
    block = build_template(chain, miner_addr)
    start, tries = time.time(), 0
    print(f"mining height {block.height}  target {hex(block.target)}")
    while True:
        if block.pow_ok():
            elapsed = max(time.time() - start, 1e-9)
            print(f"\nsolved: {block.hash}  {tries} hashes  {tries/elapsed:,.0f} H/s")
            return block
        block.nonce += 1
        tries += 1
        if tries % log_every == 0:
            print(f"  {tries:,} hashes  {tries/max(time.time()-start,1e-9):,.0f} H/s", end="\r")
        if block.time < int(time.time()):
            block.time = int(time.time()) + 1


# =====================================================================
# P2P
# =====================================================================
MAX_LINE = 4_000_000
MAX_BLOCKS_PER_MSG = 200


class Peer:
    def __init__(self, node, sock, addr):
        self.node, self.sock, self.addr = node, sock, addr
        self.buf = b""
        self.alive = True
        self.port = None
        self.greeted = False
        self.synced = False
        self.send_lock = threading.Lock()

    def send(self, msg):
        with self.send_lock:
            try:
                self.sock.sendall(json.dumps(msg).encode() + b"\n")
            except OSError:
                self.alive = False

    def greet(self):
        if not self.greeted:
            self.greeted = True
            self.send({"t": "hello", "port": self.node.port})

    def read_loop(self):
        while self.alive:
            try:
                chunk = self.sock.recv(65536)
            except OSError:
                break
            if not chunk:
                break
            self.buf += chunk
            while b"\n" in self.buf:
                line, self.buf = self.buf.split(b"\n", 1)
                if len(line) > MAX_LINE:
                    self.alive = False
                    break
                try:
                    self.node.dispatch(self, json.loads(line))
                except Exception as e:
                    print(f"peer {self.addr} bad message: {e}")
        self.alive = False
        self.node.drop(self)


class Node:
    def __init__(self, chain, port, seeds=()):
        self.chain, self.port, self.seeds = chain, port, list(seeds)
        self.peers, self.seen_blocks, self.seen_tx = [], set(), set()

    def start(self):
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("0.0.0.0", self.port)); srv.listen(32)
        print(f"listening on :{self.port}")
        threading.Thread(target=self._accept, args=(srv,), daemon=True).start()
        for s in self.seeds:
            host, _, port = s.partition(":")
            try:
                self.connect(host, int(port))
            except OSError as e:
                print(f"seed {s} unreachable: {e}")
        threading.Event().wait()

    def _accept(self, srv):
        while True:
            sock, addr = srv.accept()
            p = Peer(self, sock, addr)
            self.peers.append(p)
            threading.Thread(target=p.read_loop, daemon=True).start()
            p.greet()

    def connect(self, host, port):
        sock = socket.create_connection((host, port), timeout=10)
        sock.settimeout(None)
        p = Peer(self, sock, (host, port))
        self.peers.append(p)
        threading.Thread(target=p.read_loop, daemon=True).start()
        p.greet()
        p.send({"t": "getblocks", "locator": [self.chain.tip.hash]})

    def drop(self, peer):
        if peer in self.peers:
            self.peers.remove(peer)

    def broadcast(self, msg, exclude=None):
        for p in list(self.peers):
            if p is not exclude:
                p.send(msg)

    def _blocks_from(self, start_height, count=MAX_BLOCKS_PER_MSG):
        hi = min(start_height + count - 1, self.chain.height)
        b, out = self.chain.tip, []
        while b and b.height > hi:
            b = self.chain.all.get(b.prev)
        while b and b.height >= start_height:
            out.append(b); b = self.chain.all.get(b.prev)
        return list(reversed(out))

    def dispatch(self, peer, m):
        t = m.get("t")
        if t == "hello":
            peer.port = m.get("port")
            peer.greet()
            if not peer.synced:
                peer.synced = True
                peer.send({"t": "getblocks", "locator": [self.chain.tip.hash]})
        elif t == "getblocks":
            locator = set(m.get("locator", []))
            start = next((b for b in self.chain.all.values() if b.hash in locator), None)
            height = start.height if start else max(0, self.chain.height - MAX_BLOCKS_PER_MSG)
            peer.send({"t": "blocks",
                       "blocks": [b.to_dict() for b in self._blocks_from(height)]})
        elif t == "blocks":
            for d in m.get("blocks", []):
                self.on_block(Block.from_dict(d), peer)
        elif t == "block":
            self.on_block(Block.from_dict(m["block"]), peer)
        elif t == "tx":
            self.on_tx(Tx.from_dict(m["tx"]), peer)
        elif t == "getpeers":
            peer.send({"t": "peers",
                       "peers": [f"{p.addr[0]}:{p.port}" for p in self.peers if p.port]})

    def on_block(self, b, peer=None):
        if b.hash in self.seen_blocks:
            return
        ok, msg = self.chain.add_block(b)
        if ok:
            self.seen_blocks.add(b.hash)
            print(f"block {b.height} {b.hash[:16]} ({msg})")
            self.broadcast({"t": "block", "block": b.to_dict()}, exclude=peer)
        else:
            print(f"rejected block {b.height} {b.hash[:16]}: {msg}")

    def on_tx(self, tx, peer=None):
        tid = tx.txid()
        if tid in self.seen_tx:
            return
        ok, _msg = self.chain.add_tx(tx)
        if ok:
            self.seen_tx.add(tid)
            self.broadcast({"t": "tx", "tx": tx.to_dict()}, exclude=peer)


# =====================================================================
# CLI
# =====================================================================
def to_units(s):
    return int((Decimal(s) * UNIT).to_integral_value())


def show(units):
    return f"{Decimal(units) / UNIT:.8f}"


def open_chain():
    if not os.path.exists(CHAIN_PATH):
        raise SystemExit(f"no chain in {DATA} — run: python xypher.py init")
    return Chain.open(CHAIN_PATH)


def cmd_init(a):
    _, fund = init_chain(DATA)
    save_keys(KEYS_PATH, [fund])
    print(f"chain initialised in {DATA}")
    print(f"fund address (holds the 10 XYPH/block share): {address(fund)}")
    print(f"fund WIF saved to {KEYS_PATH} — back this up")


def cmd_address(a):
    if a.action == "new":
        print(add_key(KEYS_PATH, new_key()))
    else:
        for k in load_keys(KEYS_PATH):
            print(address(k))


def cmd_balance(a):
    c = open_chain()
    immature = c.balance(a.address) - sum(v for _, v in c.spendable(a.address))
    print(f"{a.address}: {show(c.balance(a.address))} XYPH ({show(immature)} immature)")


def cmd_info(a):
    c = open_chain()
    print(f"{NAME} ({SYMBOL}) profile={PROFILE}")
    print(f"height {c.height}  tip {c.tip.hash}")
    print(f"supply {show(sum(v for v, *_ in c.utxo.values()))} XYPH in UTXO set")
    print(f"next subsidy {show(c.subsidy(c.height + 1))} XYPH  "
          f"blocks left to cap {max(0, MAX_BLOCKS - c.height)}")
    print(f"next target {hex(c.next_target(c.height + 1))}")


def cmd_send(a):
    c = open_chain()
    keys = {address(k): k for k in load_keys(KEYS_PATH)}
    if a.sender not in keys:
        raise SystemExit("sender not in wallet")
    tx = build_payment(c, keys[a.sender], a.to, to_units(a.amount), to_units(a.fee))
    ok, msg = c.add_tx(tx)
    print(f"{tx.txid()} -> {msg}")


def cmd_mine(a):
    c = open_chain()
    start = c.height
    while True:
        b = mine(c, a.to)
        ok, msg = c.add_block(b)
        print(f"block {b.height} accepted: {msg}\n")
        if a.blocks and b.height - start >= a.blocks:
            return


def cmd_validate(a):
    c = open_chain()
    print(f"valid, height {c.height}, {len(c.utxo)} utxos")


def cmd_node(a):
    Node(open_chain(), a.port, a.seed).start()


def cmd_selftest(a):
    global COINBASE_MATURITY
    saved = COINBASE_MATURITY
    COINBASE_MATURITY = 3
    d = tempfile.mkdtemp()
    try:
        # --- crypto vectors ----------------------------------------
        one = Key(b"\x00" * 31 + b"\x01")
        assert pubkey(one) == GX.to_bytes(32, "big") + GY.to_bytes(32, "big"), "G mismatch"
        dg = sha256(b"xypher")
        sg = sign(one, dg)
        assert verify(pubkey(one), dg, sg), "sign/verify roundtrip failed"
        assert not verify(pubkey(one), sha256(b"other"), sg), "tampered digest accepted"
        bad = bytearray(sg); bad[-2] ^= 0x01
        assert not verify(pubkey(one), dg, bytes(bad)), "tampered sig accepted"
        print("crypto vectors ok")

        # --- chain lifecycle ---------------------------------------
        chain, fund = init_chain(d)
        keys = os.path.join(d, "wallet.json")
        save_keys(keys, [fund])
        a_addr = add_key(keys, new_key())
        b_addr = address(new_key())
        fund_addr = chain.meta["fund_address"]

        for _ in range(5):
            ok, msg = chain.add_block(mine(chain, a_addr, log_every=10 ** 9))
            assert ok, msg

        assert chain.balance(a_addr) == 5 * MINER_SHARE
        assert chain.balance(fund_addr) == 5 * (BLOCK_SUBSIDY - MINER_SHARE)
        assert len(chain.spendable(a_addr)) == 3, len(chain.spendable(a_addr))
        print("mining + split + maturity ok")

        sk = load_keys(keys)[0]
        tx = build_payment(chain, sk, b_addr, 3 * UNIT, UNIT // 100)
        assert chain.add_tx(tx)[0], "valid tx rejected"
        tx2 = build_payment(chain, sk, b_addr, 2 * UNIT, UNIT // 100)
        ok, msg = chain.add_tx(tx2)
        assert not ok and msg == "mempool-conflict", (ok, msg)
        print("double-spend rejected ok")

        assert chain.add_block(mine(chain, a_addr, log_every=10 ** 9))[0]
        assert chain.balance(b_addr) == 3 * UNIT
        print("payment confirmed ok")

        tx3 = build_payment(chain, sk, b_addr, UNIT, 1000)
        tx3.ins[0].sig = "00" * 8
        ok, msg = chain.add_tx(tx3)
        assert not ok and msg == "bad-signature", (ok, msg)
        print("bad signature rejected ok")

        blk = mine(chain, a_addr, log_every=10 ** 9)
        blk.target //= 2
        ok, msg = chain.add_block(blk)
        assert not ok and msg == "bad-target", (ok, msg)
        print("wrong target rejected ok")

        try:
            build_payment(chain, sk, b_addr, 10_000 * UNIT, 0)
            raise AssertionError("overspend accepted")
        except ValueError:
            print("overspend rejected ok")

        assert Chain.open(os.path.join(d, "chain.jsonl")).height == chain.height
        print("persistence ok\nALL PASS")
    finally:
        shutil.rmtree(d, ignore_errors=True)
        COINBASE_MATURITY = saved


def main():
    if os.path.isdir("xypher") and os.path.basename(sys.argv[0]) in ("xypher.py", "-m"):
        print("note: a ./xypher/ directory exists; python -m xypher would load that instead",
              file=sys.stderr)
    p = argparse.ArgumentParser(prog="xypher", description="Xypher (XYPH) node")
    sub = p.add_subparsers(required=True)

    sub.add_parser("init").set_defaults(fn=cmd_init)

    s = sub.add_parser("address")
    s.add_argument("action", choices=["new", "list"]); s.set_defaults(fn=cmd_address)

    s = sub.add_parser("balance"); s.add_argument("address"); s.set_defaults(fn=cmd_balance)
    sub.add_parser("info").set_defaults(fn=cmd_info)

    s = sub.add_parser("send")
    s.add_argument("--from", dest="sender", required=True)
    s.add_argument("--to", required=True)
    s.add_argument("--amount", required=True)
    s.add_argument("--fee", default="0.0001")
    s.set_defaults(fn=cmd_send)

    s = sub.add_parser("mine")
    s.add_argument("--to", required=True)
    s.add_argument("--blocks", type=int, default=0)
    s.set_defaults(fn=cmd_mine)

    sub.add_parser("validate").set_defaults(fn=cmd_validate)
    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)

    s = sub.add_parser("node")
    s.add_argument("--port", type=int, default=9333)
    s.add_argument("--seed", action="append", default=[])
    s.set_defaults(fn=cmd_node)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
