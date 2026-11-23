import { isValidAddress, isValidEvmAddress, normalizeToXypherAddress } from './xypherCrypto.ts';

export interface ParsedXypherQr {
  address: string;
  normalizedXyph: string;
  amount: string | null;
  format: 'xypher' | 'evm';
}

/**
 * Encodes a Xypher or MetaMask receiving address (and optional requested XYPH amount)
 * into a compact QR payload URI that any Xypher scanner can decode.
 */
export function buildXypherQrPayload(address: string, amountXyph?: string): string {
  const cleanAddr = address.trim();
  const cleanAmt = (amountXyph || '').trim();
  const parsedAmt = Number(cleanAmt);
  if (cleanAmt && Number.isFinite(parsedAmt) && parsedAmt > 0) {
    return `xypher:${cleanAddr}?amount=${cleanAmt}`;
  }
  return `xypher:${cleanAddr}`;
}

/**
 * Parses a scanned QR string supporting:
 *  - xypher:<address>?amount=<xyph>
 *  - ethereum:<0xaddress>[@chainId][?amount=...]
 *  - Raw Xypher Base58Check address
 *  - Raw MetaMask 0x EVM address
 */
export function parseXypherQrPayload(raw: string): ParsedXypherQr | null {
  const text = raw.trim();
  if (!text) return null;

  let candidateAddr = text;
  let amount: string | null = null;

  if (/^(xypher|ethereum):/i.test(text)) {
    const withoutScheme = text.replace(/^(xypher|ethereum):/i, '');
    const [pathPart, queryPart] = withoutScheme.split('?');
    // Strip optional EIP-681 @chainId suffix
    candidateAddr = pathPart.split('@')[0].trim();

    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      const rawAmount = params.get('amount') || params.get('value');
      if (rawAmount) {
        const num = Number(rawAmount);
        if (Number.isFinite(num) && num > 0) {
          amount = rawAmount.trim();
        }
      }
    }
  }

  if (isValidEvmAddress(candidateAddr)) {
    const normalizedXyph = normalizeToXypherAddress(candidateAddr);
    if (!normalizedXyph) return null;
    return {
      address: candidateAddr,
      normalizedXyph,
      amount,
      format: 'evm',
    };
  }

  if (isValidAddress(candidateAddr)) {
    return {
      address: candidateAddr,
      normalizedXyph: candidateAddr,
      amount,
      format: 'xypher',
    };
  }

  return null;
}
