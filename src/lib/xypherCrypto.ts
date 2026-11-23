import type { BlockData, NetworkProfile, TxData, TxInData, TxOutData } from './types.ts';

// =====================================================================
// CONSENSUS CONSTANTS (matching xypher.py)
// =====================================================================
export const NAME = 'Xypher';
export const NETWORK_NAME = 'XYPH Network';
export const SYMBOL = 'XYPH';
export const DECIMALS = 8;
export const UNIT = 100_000_000; // 10 ** 8
export const XYPHER_CHAIN_ID = 5790032; // 0x585950 ("XYP" ASCII hex)
export const XYPHER_CHAIN_ID_HEX = '0x585950';
export const WEI_PER_UNIT = 10_000_000_000n; // 10 ** 10 (maps 8-decimal XYPH to 18-decimal MetaMask wei)
export const NETWORK_FEE_XYPH = 0; // Zero network fee on XYPH Network
export const NETWORK_FEE_UNITS = NETWORK_FEE_XYPH * UNIT; // 0 base units = 0 XYPH
export const NETWORK_FEE_WEI = BigInt(NETWORK_FEE_UNITS) * WEI_PER_UNIT; // 0 wei = 0 XYPH
export const XYPH_EVM_GAS_PRICE_WEI = 0n; // 0 wei per gas = 0 XYPH network fee
export const XYPH_EVM_GAS_PRICE_HEX = '0x0';

// Official XYPH ERC-20 Precompile Contract (for MetaMask wallet_watchAsset & coin logo display)
export const XYPH_TOKEN_NATIVE_ADDRESS = 'co7VoxuG5CgYv5KJFzhisr3rGdpBkZ2Rgv';
export const XYPH_TOKEN_CONTRACT_EVM = '0xF55faC0a9d26654481b8e9764841b62133B7e6AA';
export const XYPH_TOKEN_DECIMALS = 4;
export const XYPH_TOKEN_SCALE = 10_000; // 10^(8 - 4) maps 8-decimal native XYPH units to 4-decimal ERC-20 units

export const MAX_BLOCKS = 24_000_000; // Real 24,000,000 block capacity
export const MINING_BLOCK_TIME_SEC = 600; // 10 minutes per mined block
export const HALVING_YEARS = 10; // Reward halves every 10 years
export const HALVING_INTERVAL_BLOCKS = 525_600; // 10 years × 365 days × 24 hours × 6 blocks/hour
export const BLOCK_SUBSIDY = 1_000_000_000; // 10 XYPH initial block mining reward
export const MINER_SHARE = BLOCK_SUBSIDY; // Full 10 XYPH reward goes directly to the miner wallet
export const FUND_SHARE = 0; // No forced fund split on mined blocks
export const MAX_MONEY = HALVING_INTERVAL_BLOCKS * BLOCK_SUBSIDY * 2; // 10,512,000 XYPH geometric cap under 10-year halving
export const MAX_BLOCK_BYTES = 1_000_000;

export const GENESIS_TAG = 'XYPH Network genesis / 24M blocks / 1 XYPH fee / v2';
export const GENESIS_TIME = 1_760_000_000;
export const ZERO32 = '00'.repeat(32);

export const ADDR_VERSION = 0x58; // Base58Check prefix 'X'
export const WIF_VERSION = 0xa8;

export interface ProfileConfig {
  id: NetworkProfile;
  label: string;
  description: string;
  targetBlockTime: number;
  retargetInterval: number;
  halvingInterval: number;
  maturity: number;
  maxTarget: bigint;
}

export const PROFILE_CONFIGS: Record<NetworkProfile, ProfileConfig> = {
  'private-fast': {
    id: 'private-fast',
    label: 'XYPH Network Mainnet',
    description: 'Public XYPH Network: 10-minute block mining, 10 XYPH reward halving every 10 years (525,600 blocks), 0 XYPH network fee.',
    targetBlockTime: MINING_BLOCK_TIME_SEC,
    retargetInterval: 32,
    halvingInterval: HALVING_INTERVAL_BLOCKS,
    maturity: 1,
    maxTarget: 0x0000ffff00000000000000000000000000000000000000000000000000000000n,
  },
  'dev-medium': {
    id: 'dev-medium',
    label: 'XYPH Testnet (Medium PoW)',
    description: 'Public testnet: 10-minute block schedule, 10 XYPH reward halving every 10 years, 0 XYPH network fee.',
    targetBlockTime: MINING_BLOCK_TIME_SEC,
    retargetInterval: 32,
    halvingInterval: HALVING_INTERVAL_BLOCKS,
    maturity: 1,
    maxTarget: 0x00000fff00000000000000000000000000000000000000000000000000000000n,
  },
  'main-spec': {
    id: 'main-spec',
    label: 'XYPH Main Spec (Full PoW)',
    description: 'Full 24,000,000-block PoW specification: 600s (10 min) block mining, 10 XYPH reward halving every 10 years, 0 XYPH network fee.',
    targetBlockTime: MINING_BLOCK_TIME_SEC,
    retargetInterval: 2_016,
    halvingInterval: HALVING_INTERVAL_BLOCKS,
    maturity: 1,
    maxTarget: 0x000003ff00000000000000000000000000000000000000000000000000000000n,
  },
};

// =====================================================================
// BYTE & ENCODING HELPERS
// =====================================================================
const encoder = new TextEncoder();

export function utf8ToBytes(str: string): Uint8Array {
  return encoder.encode(str);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return n;
}

export function bigIntToBytes32(n: bigint): Uint8Array {
  return hexToBytes(n.toString(16).padStart(64, '0'));
}

export function u32le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, n >>> 0, true);
  return out;
}

export function u64le(n: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, BigInt(n), true);
  return out;
}

export function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  globalThis.crypto.getRandomValues(out);
  return out;
}

// =====================================================================
// PURE TYPESCRIPT SHA-256 (synchronous, isomorphic)
// =====================================================================
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_W = new Uint32Array(64);

export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const bitLen = len * 8;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(msg);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      SHA256_W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = SHA256_W[i - 15];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const w2 = SHA256_W[i - 2];
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      SHA256_W[i] = (SHA256_W[i - 16] + s0 + SHA256_W[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + SHA256_W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

export function dsha256(msg: Uint8Array): Uint8Array {
  return sha256(sha256(msg));
}

export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > 64) k = sha256(k);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const b = i < k.length ? k[i] : 0;
    ipad[i] = b ^ 0x36;
    opad[i] = b ^ 0x5c;
  }
  return sha256(concatBytes(opad, sha256(concatBytes(ipad, msg))));
}

// =====================================================================
// PURE TYPESCRIPT RIPEMD-160 (for Bitcoin/Xypher Hash160)
// =====================================================================
const RL = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
];
const RR = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
];
const SL = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];
const SR = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
];
const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function ripemdF(j: number, x: number, y: number, z: number): number {
  if (j < 16) return (x ^ y ^ z) >>> 0;
  if (j < 32) return ((x & y) | (~x & z)) >>> 0;
  if (j < 48) return ((x | ~y) ^ z) >>> 0;
  if (j < 64) return ((x & z) | (y & ~z)) >>> 0;
  return (x ^ (y | ~z)) >>> 0;
}

export function ripemd160(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const bitLen = len * 8;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(msg);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const X = new Uint32Array(16);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      X[i] = view.getUint32(offset + i * 4, true);
    }

    let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4;

    for (let j = 0; j < 80; j++) {
      const rnd = (j / 16) | 0;
      const tl = (rotl((al + ripemdF(j, bl, cl, dl) + X[RL[j]] + KL[rnd]) >>> 0, SL[j]) + el) >>> 0;
      al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = tl;

      const tr = (rotl((ar + ripemdF(79 - j, br, cr, dr) + X[RR[j]] + KR[rnd]) >>> 0, SR[j]) + er) >>> 0;
      ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = tr;
    }

    const t = (h1 + cl + dr) >>> 0;
    h1 = (h2 + dl + er) >>> 0;
    h2 = (h3 + el + ar) >>> 0;
    h3 = (h4 + al + br) >>> 0;
    h4 = (h0 + bl + cr) >>> 0;
    h0 = t;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, true);
  outView.setUint32(4, h1, true);
  outView.setUint32(8, h2, true);
  outView.setUint32(12, h3, true);
  outView.setUint32(16, h4, true);
  return out;
}

export function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

// =====================================================================
// BASE58 & BASE58CHECK
// =====================================================================
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58encode(raw: Uint8Array): string {
  let n = bytesToBigInt(raw);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function b58decode(str: string): Uint8Array {
  let n = 0n;
  for (let i = 0; i < str.length; i++) {
    const idx = B58.indexOf(str[i]);
    if (idx < 0) throw new Error('Invalid Base58 character');
    n = n * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (let i = 0; i < str.length; i++) {
    if (str[i] !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function b58checkEncode(payload: Uint8Array): string {
  const checksum = dsha256(payload).slice(0, 4);
  return b58encode(concatBytes(payload, checksum));
}

export function b58checkDecode(str: string): Uint8Array {
  const raw = b58decode(str);
  if (raw.length < 5) throw new Error('Base58Check too short');
  const payload = raw.slice(0, raw.length - 4);
  const chk = raw.slice(raw.length - 4);
  const expected = dsha256(payload).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (chk[i] !== expected[i]) throw new Error('Bad Base58Check checksum');
  }
  return payload;
}

// =====================================================================
// SECP256K1 (Jacobian coordinates, RFC6979, low-S DER)
// =====================================================================
export const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const SECP_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
export const SECP_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

type AffinePoint = [bigint, bigint];
type JacobianPoint = [bigint, bigint, bigint];
const INF: JacobianPoint = [0n, 1n, 0n];

function modP(x: bigint): bigint {
  const r = x % SECP_P;
  return r >= 0n ? r : r + SECP_P;
}

function modN(x: bigint): bigint {
  const r = x % SECP_N;
  return r >= 0n ? r : r + SECP_N;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInv(a: bigint, mod: bigint): bigint {
  return modPow(a, mod - 2n, mod);
}

function jDouble(pt: JacobianPoint): JacobianPoint {
  const [X, Y, Z] = pt;
  if (Y === 0n || Z === 0n) return INF;
  const yy = modP(Y * Y);
  const s = modP(4n * X * yy);
  const m = modP(3n * X * X);
  const x3 = modP(m * m - 2n * s);
  const y3 = modP(m * (s - x3) - 8n * yy * yy);
  const z3 = modP(2n * Y * Z);
  return [x3, y3, z3];
}

function jAdd(a: JacobianPoint, b: JacobianPoint): JacobianPoint {
  if (a[2] === 0n) return b;
  if (b[2] === 0n) return a;
  const [x1, y1, z1] = a;
  const [x2, y2, z2] = b;
  const z1z1 = modP(z1 * z1);
  const z2z2 = modP(z2 * z2);
  const u1 = modP(x1 * z2z2);
  const u2 = modP(x2 * z1z1);
  const s1 = modP(y1 * z2 * z2z2);
  const s2 = modP(y2 * z1 * z1z1);
  if (u1 === u2) {
    return s1 === s2 ? jDouble(a) : INF;
  }
  const h = modP(u2 - u1);
  const r = modP(s2 - s1);
  const h2 = modP(h * h);
  const h3 = modP(h * h2);
  const x3 = modP(r * r - h3 - 2n * u1 * h2);
  const y3 = modP(r * (u1 * h2 - x3) - s1 * h3);
  const z3 = modP(h * z1 * z2);
  return [x3, y3, z3];
}

function jMul(pt: AffinePoint, k: bigint): JacobianPoint {
  let scalar = modN(k);
  let out: JacobianPoint = INF;
  let add: JacobianPoint = [pt[0], pt[1], 1n];
  while (scalar > 0n) {
    if (scalar & 1n) out = jAdd(out, add);
    add = jDouble(add);
    scalar >>= 1n;
  }
  return out;
}

function toAffine(j: JacobianPoint): AffinePoint | null {
  const [X, Y, Z] = j;
  if (Z === 0n) return null;
  const zi = modInv(Z, SECP_P);
  const zi2 = modP(zi * zi);
  return [modP(X * zi2), modP(Y * zi2 * zi)];
}

function pointMul(pt: AffinePoint, k: bigint): AffinePoint | null {
  return toAffine(jMul(pt, k));
}

function pointAdd(a: AffinePoint | null, b: AffinePoint | null): AffinePoint | null {
  if (!a) return b;
  if (!b) return a;
  const [x1, y1] = a;
  const [x2, y2] = b;
  let lam: bigint;
  if (x1 === x2) {
    if (modP(y1 + y2) === 0n) return null;
    lam = modP(3n * x1 * x1 * modInv(modP(2n * y1), SECP_P));
  } else {
    lam = modP((y2 - y1) * modInv(modP(x2 - x1), SECP_P));
  }
  const x3 = modP(lam * lam - x1 - x2);
  const y3 = modP(lam * (x1 - x3) - y1);
  return [x3, y3];
}

function serializePoint(pt: AffinePoint): Uint8Array {
  return concatBytes(bigIntToBytes32(pt[0]), bigIntToBytes32(pt[1]));
}

function deserializePoint(raw: Uint8Array): AffinePoint {
  let slice = raw;
  if (slice.length === 65 && slice[0] === 4) {
    slice = slice.slice(1);
  }
  if (slice.length !== 64) {
    throw new Error('Bad public key length');
  }
  const x = bytesToBigInt(slice.slice(0, 32));
  const y = bytesToBigInt(slice.slice(32, 64));
  if (modP(y * y - x * x * x - 7n) !== 0n) {
    throw new Error('Point not on secp256k1 curve');
  }
  return [x, y];
}

function encodeDerInt(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  let bytes = hexToBytes(hex || '00');
  if (bytes[0] & 0x80) {
    bytes = concatBytes(Uint8Array.of(0x00), bytes);
  }
  return concatBytes(Uint8Array.of(0x02, bytes.length), bytes);
}

function encodeDer(r: bigint, s: bigint): Uint8Array {
  const body = concatBytes(encodeDerInt(r), encodeDerInt(s));
  return concatBytes(Uint8Array.of(0x30, body.length), body);
}

function decodeDer(der: Uint8Array): [bigint, bigint] {
  if (der.length < 8 || der[0] !== 0x30) throw new Error('Bad DER signature');
  let i = 2;
  const nums: bigint[] = [];
  for (let n = 0; n < 2; n++) {
    if (i >= der.length || der[i] !== 0x02) throw new Error('Bad DER integer marker');
    const len = der[i + 1];
    i += 2;
    if (i + len > der.length) throw new Error('Bad DER length');
    nums.push(bytesToBigInt(der.slice(i, i + len)));
    i += len;
  }
  return [nums[0], nums[1]];
}

function rfc6979K(d: bigint, z: bigint): bigint {
  const x = bigIntToBytes32(d);
  const h = bigIntToBytes32(z);
  let v: Uint8Array = new Uint8Array(32).fill(0x01);
  let k: Uint8Array = new Uint8Array(32).fill(0x00);
  k = hmacSha256(k, concatBytes(v, Uint8Array.of(0x00), x, h));
  v = hmacSha256(k, v);
  k = hmacSha256(k, concatBytes(v, Uint8Array.of(0x01), x, h));
  v = hmacSha256(k, v);
  while (true) {
    v = hmacSha256(k, v);
    const cand = bytesToBigInt(v);
    if (cand >= 1n && cand < SECP_N) return cand;
    k = hmacSha256(k, concatBytes(v, Uint8Array.of(0x00)));
    v = hmacSha256(k, v);
  }
}

export function generatePrivateKey(): Uint8Array {
  while (true) {
    const raw = randomBytes(32);
    const val = bytesToBigInt(raw);
    if (val >= 1n && val < SECP_N) return raw;
  }
}

export function pubkeyFromPrivate(priv: Uint8Array): Uint8Array {
  if (priv.length !== 32) throw new Error('Invalid private key length');
  const d = bytesToBigInt(priv);
  if (d < 1n || d >= SECP_N) throw new Error('Private key out of curve range');
  const pt = pointMul([SECP_GX, SECP_GY], d);
  if (!pt) throw new Error('Invalid key');
  return serializePoint(pt);
}

export function addressFromPubkey(pub: Uint8Array): string {
  return b58checkEncode(concatBytes(Uint8Array.of(ADDR_VERSION), hash160(pub)));
}

export function addressFromPrivate(priv: Uint8Array): string {
  return addressFromPubkey(pubkeyFromPrivate(priv));
}

export function keyToWif(priv: Uint8Array): string {
  if (priv.length !== 32) throw new Error('Invalid private key length');
  return b58checkEncode(concatBytes(Uint8Array.of(WIF_VERSION), priv));
}

export function wifToKey(wif: string): Uint8Array {
  const payload = b58checkDecode(wif.trim());
  if (payload.length !== 33 || payload[0] !== WIF_VERSION) {
    throw new Error('Not a valid Xypher WIF private key');
  }
  const raw = payload.slice(1);
  const val = bytesToBigInt(raw);
  if (val < 1n || val >= SECP_N) throw new Error('WIF key out of range');
  return raw;
}

export function isValidAddress(addr: string): boolean {
  if (typeof addr !== 'string' || addr.length < 26 || addr.length > 40) return false;
  try {
    const payload = b58checkDecode(addr);
    return payload.length === 21 && payload[0] === ADDR_VERSION;
  } catch {
    return false;
  }
}

export function isValidEvmAddress(addr: string): boolean {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

/**
 * Deterministic 1-to-1 mapping between a 20-byte EVM/MetaMask address (0x...)
 * and a valid 21-byte Xypher Base58Check address (version 0x58).
 */
export function evmToXypherAddress(evmAddr: string): string {
  const clean = evmAddr.trim();
  if (!isValidEvmAddress(clean)) {
    throw new Error('Invalid EVM 0x address');
  }
  const bytes20 = hexToBytes(clean.slice(2));
  return b58checkEncode(concatBytes(Uint8Array.of(ADDR_VERSION), bytes20));
}

export function xypherToEvmAddress(xyphAddr: string): string {
  const payload = b58checkDecode(xyphAddr.trim());
  if (payload.length !== 21 || payload[0] !== ADDR_VERSION) {
    throw new Error('Invalid Xypher Base58Check address');
  }
  return '0x' + bytesToHex(payload.slice(1));
}

export function normalizeToXypherAddress(input: string): string | null {
  const clean = input.trim();
  if (isValidAddress(clean)) return clean;
  if (isValidEvmAddress(clean)) return evmToXypherAddress(clean);
  return null;
}

export function signDigest(priv: Uint8Array, digest: Uint8Array): Uint8Array {
  const d = bytesToBigInt(priv);
  const z = modN(bytesToBigInt(digest));
  const k = rfc6979K(d, z);
  const R = pointMul([SECP_GX, SECP_GY], k);
  if (!R) throw new Error('Signing failed: point at infinity');
  const r = modN(R[0]);
  if (r === 0n) throw new Error('Signing failed: r=0');
  let s = modN(modInv(k, SECP_N) * (z + r * d));
  if (s === 0n) throw new Error('Signing failed: s=0');
  if (s > SECP_N / 2n) s = SECP_N - s;
  return encodeDer(r, s);
}

export function verifyDigest(pub: Uint8Array, digest: Uint8Array, sig: Uint8Array): boolean {
  try {
    const Q = deserializePoint(pub);
    const [r, s] = decodeDer(sig);
    if (r < 1n || r >= SECP_N || s < 1n || s >= SECP_N) return false;
    const z = modN(bytesToBigInt(digest));
    const w = modInv(s, SECP_N);
    const u1 = modN(z * w);
    const u2 = modN(r * w);
    const R = pointAdd(pointMul([SECP_GX, SECP_GY], u1), pointMul(Q, u2));
    return R !== null && modN(R[0]) === r;
  } catch {
    return false;
  }
}

// =====================================================================
// MERKLE ROOT & CANONICAL SERIALIZATION (exact match to xypher.py)
// =====================================================================
export function merkleRoot(txids: string[]): Uint8Array {
  if (txids.length === 0) return new Uint8Array(32);
  let layer = txids.map((id) => hexToBytes(id));
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(dsha256(concatBytes(layer[i], layer[i + 1])));
    }
    layer = next;
  }
  return layer[0];
}

// Matches Python json.dumps(obj, sort_keys=True) formatting (", " and ": ")
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(', ') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => `${JSON.stringify(k)}: ${canonicalJson(obj[k])}`).join(', ') + '}';
  }
  throw new Error('Unsupported type in canonicalJson');
}

// =====================================================================
// TRANSACTIONS
// =====================================================================
function strippedTx(tx: TxData): {
  v: number;
  ins: Array<{ prev_txid: string; index: number; pub?: string }>;
  outs: Array<{ value: number; addr: string }>;
} {
  return {
    v: tx.v,
    ins: tx.ins.map((i) => ({ prev_txid: i.prev_txid, index: i.index })),
    outs: tx.outs.map((o) => ({ value: o.value, addr: o.addr })),
  };
}

export function computeTxid(tx: TxData): string {
  return bytesToHex(dsha256(utf8ToBytes(canonicalJson(strippedTx(tx)))));
}

export function computeSighash(tx: TxData, idx: number): Uint8Array {
  const d = strippedTx(tx);
  d.ins[idx].pub = tx.ins[idx].pub;
  const payload = concatBytes(
    utf8ToBytes(canonicalJson(d)),
    Uint8Array.of(0x7c), // "|"
    hexToBytes(tx.ins[idx].prev_txid),
    u32le(tx.ins[idx].index)
  );
  return dsha256(payload);
}

export function signTxInput(tx: TxData, idx: number, priv: Uint8Array): void {
  const pub = pubkeyFromPrivate(priv);
  tx.ins[idx].pub = bytesToHex(pub);
  const digest = computeSighash(tx, idx);
  tx.ins[idx].sig = bytesToHex(signDigest(priv, digest));
}

export function verifyTxInput(tx: TxData, idx: number): boolean {
  try {
    const inp = tx.ins[idx];
    if (!inp.pub || !inp.sig) return false;
    const pubBytes = hexToBytes(inp.pub);
    const sigBytes = hexToBytes(inp.sig);
    const digest = computeSighash(tx, idx);
    return verifyDigest(pubBytes, digest, sigBytes);
  } catch {
    return false;
  }
}

export function isCoinbaseTx(tx: TxData): boolean {
  return tx.ins.length === 1 && tx.ins[0].prev_txid === ZERO32;
}

export function checkTxShape(tx: TxData): string | null {
  if (!tx || typeof tx !== 'object') return 'malformed-tx';
  if (!Array.isArray(tx.ins) || tx.ins.length === 0) return 'no-inputs';
  if (!Array.isArray(tx.outs) || tx.outs.length === 0) return 'no-outputs';
  let sumOut = 0;
  for (const o of tx.outs) {
    if (!o || typeof o.value !== 'number' || !Number.isInteger(o.value)) return 'bad-output-value';
    if (o.value < 0) return 'negative-output';
    if (!isValidAddress(o.addr)) return 'bad-address';
    sumOut += o.value;
    if (sumOut > MAX_MONEY) return 'output-overflow';
  }
  if (!isCoinbaseTx(tx)) {
    const seen = new Set<string>();
    for (const i of tx.ins) {
      if (!i || typeof i.prev_txid !== 'string' || !/^[0-9a-f]{64}$/.test(i.prev_txid)) {
        return 'bad-prev-txid';
      }
      if (typeof i.index !== 'number' || !Number.isInteger(i.index) || i.index < 0) {
        return 'bad-input-index';
      }
      const key = `${i.prev_txid}:${i.index}`;
      if (seen.has(key)) return 'duplicate-input';
      seen.add(key);
    }
  }
  return null;
}

export function buildSignedTx(
  priv: Uint8Array,
  coins: Array<{ txid: string; index: number; value: number }>,
  toAddress: string,
  amountUnits: number,
  feeUnits: number
): TxData {
  if (!Number.isInteger(amountUnits) || amountUnits <= 0) {
    throw new Error('Amount must be positive');
  }
  if (!Number.isInteger(feeUnits) || feeUnits < 0) {
    throw new Error('Fee must not be negative');
  }
  if (!isValidAddress(toAddress)) {
    throw new Error('Invalid destination Xypher address');
  }
  const fromAddress = addressFromPrivate(priv);
  const need = amountUnits + feeUnits;
  const sorted = [...coins].sort((a, b) => b.value - a.value);
  const picked: Array<{ txid: string; index: number; value: number }> = [];
  let total = 0;
  for (const c of sorted) {
    picked.push(c);
    total += c.value;
    if (total >= need) break;
  }
  if (total < need) {
    throw new Error(
      `Insufficient spendable funds: have ${formatXYPH(total)} ${SYMBOL}, need ${formatXYPH(need)} ${SYMBOL}`
    );
  }
  const outs: TxOutData[] = [{ value: amountUnits, addr: toAddress }];
  const change = total - need;
  if (change > 0) {
    outs.push({ value: change, addr: fromAddress });
  }
  const ins: TxInData[] = picked.map((c) => ({
    prev_txid: c.txid,
    index: c.index,
    pub: '',
    sig: '',
  }));
  const tx: TxData = { v: 1, ins, outs };
  for (let i = 0; i < tx.ins.length; i++) {
    signTxInput(tx, i, priv);
  }
  return tx;
}

// =====================================================================
// BLOCK HEADER & POW
// =====================================================================
export function serializeBlockHeader(block: BlockData, merkleBytes?: Uint8Array): Uint8Array {
  const merkle = merkleBytes ?? merkleRoot(block.txs.map((t) => computeTxid(t)));
  const targetBig = BigInt('0x' + block.target);
  return concatBytes(
    u32le(block.version),
    u32le(block.height),
    hexToBytes(block.prev),
    merkle,
    u64le(block.time),
    bigIntToBytes32(targetBig),
    u64le(block.nonce)
  );
}

export function computeBlockHash(block: BlockData, merkleBytes?: Uint8Array): string {
  return bytesToHex(dsha256(serializeBlockHeader(block, merkleBytes)));
}

export function isPowValid(hashHex: string, targetHex: string): boolean {
  return BigInt('0x' + hashHex) <= BigInt('0x' + targetHex);
}

// =====================================================================
// DISPLAY & UNIT CONVERSION HELPERS
// =====================================================================
export function formatXYPH(units: number, maxDecimals = 8): string {
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(units));
  const whole = Math.floor(abs / UNIT);
  const frac = String(abs % UNIT).padStart(DECIMALS, '0');
  const trimmedFrac = maxDecimals < 8 ? frac.slice(0, maxDecimals) : frac;
  return `${sign}${whole.toLocaleString('en-US')}.${trimmedFrac}`;
}

export function parseXYPHToUnits(input: string): number {
  const trimmed = input.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error('Invalid XYPH amount');
  }
  const [wholeStr = '0', fracStr = ''] = trimmed.split('.');
  if (fracStr.length > DECIMALS) {
    throw new Error('Maximum 8 decimal places allowed');
  }
  const whole = Number(wholeStr || '0');
  const frac = Number((fracStr + '00000000').slice(0, 8));
  const total = whole * UNIT + frac;
  if (!Number.isSafeInteger(total) || total > MAX_MONEY) {
    throw new Error('Amount exceeds maximum supply');
  }
  return total;
}

export function truncateHash(hash: string, start = 10, end = 8): string {
  if (!hash || hash.length <= start + end + 3) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}
