import { decodeRlp, encodeRlp, getBytes, hexlify, toUtf8Bytes, toUtf8String } from 'ethers';

export interface BlockExtraDataDecoded {
  hex: string;
  extraVanity: string;
  validatorBytes: string;
  gasTarget: number;
  baseFeeChangeDenominator: number;
  signedData: string;
  byteLength: number;
}

export interface EncodeBlockExtraDataInput {
  version?: [number, number, number];
  client?: string;
  runtime?: string;
  os?: string;
  validatorBytesHex?: string;
  gasTarget?: number;
  baseFeeChangeDenominator?: number;
  signedDataHex: string; // 65 bytes (130 hex chars, optional 0x prefix)
}

function uintToMinimalHex(n: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  if (safe === 0) return '0x';
  let hex = safe.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  return '0x' + hex;
}

function minimalHexToUint(hex: string): number {
  const clean = hex.replace(/^0x/i, '');
  if (!clean) return 0;
  return parseInt(clean, 16);
}

function normalizeHexNoPrefix(hex: string): string {
  return hex.trim().replace(/^0x/i, '').toLowerCase();
}

/**
 * Encodes Polygon-Bor / EVM EIP-1559 compatible block extraData:
 *   [32 bytes ExtraVanity (RLP client tuple zero-padded to 32B)]
 * + [RLP([validatorBytes, gasTarget, baseFeeChangeDenominator])]
 * + [65 bytes secp256k1 SignedData (r || s || v)]
 */
export function encodeBlockExtraData(input: EncodeBlockExtraDataInput): BlockExtraDataDecoded {
  const [vMaj, vMin, vPatch] = input.version ?? [2, 0, 0];
  const client = input.client ?? 'xypherd';
  const runtime = input.runtime ?? 'cpp17';
  const os = input.os ?? 'linux';
  const gasTarget = input.gasTarget ?? 16_000_000;
  const baseFeeChangeDenominator = input.baseFeeChangeDenominator ?? 64;
  const validatorHex = input.validatorBytesHex
    ? '0x' + normalizeHexNoPrefix(input.validatorBytesHex)
    : '0x';

  // 1. 32-byte ExtraVanity (RLP list of [versionBytes, client, runtime, os], right-padded with 0x00 to 32 bytes)
  const versionHex =
    '0x' +
    [vMaj, vMin, vPatch]
      .map((b) => Math.max(0, Math.min(255, b)).toString(16).padStart(2, '0'))
      .join('');

  const vanityRlpHex = encodeRlp([
    versionHex,
    hexlify(toUtf8Bytes(client)),
    hexlify(toUtf8Bytes(runtime)),
    hexlify(toUtf8Bytes(os)),
  ]);
  const vanityRlpNoPrefix = normalizeHexNoPrefix(vanityRlpHex);
  const vanityPadded32 = vanityRlpNoPrefix.slice(0, 64).padEnd(64, '0');

  // 2. RLP-encoded Bor/EIP-1559 config tuple: [ValidatorBytes, GasTarget, BaseFeeChangeDenominator]
  const configRlpHex = encodeRlp([
    validatorHex,
    uintToMinimalHex(gasTarget),
    uintToMinimalHex(baseFeeChangeDenominator),
  ]);
  const configNoPrefix = normalizeHexNoPrefix(configRlpHex);

  // 3. 65-byte Validator SignedData (r || s || v)
  const signedNoPrefix = normalizeHexNoPrefix(input.signedDataHex).padStart(130, '0').slice(0, 130);

  const fullHex = '0x' + vanityPadded32 + configNoPrefix + signedNoPrefix;
  return {
    hex: fullHex,
    extraVanity: `${client}/${runtime}/${os}`,
    validatorBytes: validatorHex === '0x' ? '(none)' : validatorHex,
    gasTarget,
    baseFeeChangeDenominator,
    signedData: '0x' + signedNoPrefix,
    byteLength: (fullHex.length - 2) / 2,
  };
}

/**
 * Computes exact RLP item length from the first byte of an RLP buffer so trailing zero padding
 * inside the 32-byte ExtraVanity slot can be stripped before calling decodeRlp().
 */
function rlpItemByteLength(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const first = bytes[0];
  if (first <= 0x7f) return 1;
  if (first <= 0xb7) return 1 + (first - 0x80);
  if (first <= 0xbf) {
    const lenOfLen = first - 0xb7;
    if (1 + lenOfLen > bytes.length) return bytes.length;
    let payloadLen = 0;
    for (let i = 0; i < lenOfLen; i++) payloadLen = (payloadLen << 8) | bytes[1 + i];
    return 1 + lenOfLen + payloadLen;
  }
  if (first <= 0xf7) return 1 + (first - 0xc0);
  const lenOfLen = first - 0xf7;
  if (1 + lenOfLen > bytes.length) return bytes.length;
  let payloadLen = 0;
  for (let i = 0; i < lenOfLen; i++) payloadLen = (payloadLen << 8) | bytes[1 + i];
  return 1 + lenOfLen + payloadLen;
}

/**
 * Decodes any Bor / EIP-1559 / Xypher block extraData hex into its human-readable fields:
 * ExtraVanity, ValidatorBytes, GasTarget, BaseFeeChangeDenominator, and 65-byte SignedData.
 */
export function decodeBlockExtraData(rawHex: string): BlockExtraDataDecoded {
  const clean = normalizeHexNoPrefix(rawHex);
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error('Enter a valid even-length hexadecimal extraData string (0x...).');
  }
  const bytes = getBytes('0x' + clean);
  if (bytes.length < 32 + 65) {
    throw new Error(
      `Block extraData must be at least 97 bytes (32B ExtraVanity + config + 65B SignedData); got ${bytes.length} bytes.`
    );
  }

  // 1. Decode 32-byte ExtraVanity
  const vanitySlice = bytes.slice(0, 32);
  let extraVanity = '';
  try {
    const rlpLen = rlpItemByteLength(vanitySlice);
    const decoded = decodeRlp(vanitySlice.slice(0, Math.min(32, rlpLen)));
    if (Array.isArray(decoded) && decoded.length >= 4) {
      const parts = decoded.slice(1).map((item) => {
        if (typeof item === 'string') {
          return toUtf8String(item);
        }
        return '';
      });
      extraVanity = parts.filter(Boolean).join('/');
    } else if (typeof decoded === 'string') {
      extraVanity = toUtf8String(decoded);
    }
  } catch {
    // Fallback: strip trailing null bytes and decode as UTF-8 text
    let end = vanitySlice.length;
    while (end > 0 && vanitySlice[end - 1] === 0) end--;
    try {
      extraVanity = toUtf8String(vanitySlice.slice(0, end));
    } catch {
      extraVanity = hexlify(vanitySlice);
    }
  }
  if (!extraVanity) extraVanity = '(none)';

  // 2. Last 65 bytes = SignedData (r || s || v)
  const signedSlice = bytes.slice(bytes.length - 65);
  const signedData = hexlify(signedSlice);

  // 3. Middle bytes = RLP config ([ValidatorBytes, GasTarget, BaseFeeChangeDenominator]) or raw validator bytes
  const middleSlice = bytes.slice(32, bytes.length - 65);
  let validatorBytes = '(none)';
  let gasTarget = 0;
  let baseFeeChangeDenominator = 0;

  if (middleSlice.length > 0) {
    try {
      const middleDecoded = decodeRlp(middleSlice);
      if (Array.isArray(middleDecoded)) {
        const valRaw = typeof middleDecoded[0] === 'string' ? middleDecoded[0] : '0x';
        validatorBytes = valRaw === '0x' || valRaw === '' ? '(none)' : valRaw;
        if (typeof middleDecoded[1] === 'string') {
          gasTarget = minimalHexToUint(middleDecoded[1]);
        }
        if (typeof middleDecoded[2] === 'string') {
          baseFeeChangeDenominator = minimalHexToUint(middleDecoded[2]);
        }
      } else if (typeof middleDecoded === 'string') {
        validatorBytes = middleDecoded === '0x' ? '(none)' : middleDecoded;
      }
    } catch {
      validatorBytes = hexlify(middleSlice);
    }
  }

  return {
    hex: '0x' + clean,
    extraVanity,
    validatorBytes,
    gasTarget,
    baseFeeChangeDenominator,
    signedData,
    byteLength: bytes.length,
  };
}
