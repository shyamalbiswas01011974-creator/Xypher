import type { LocalWalletAccount } from './types.ts';
import {
  addressFromPrivate,
  bytesToHex,
  generatePrivateKey,
  keyToWif,
  pubkeyFromPrivate,
  wifToKey,
  xypherToEvmAddress,
} from './xypherCrypto.ts';

const STORAGE_KEY = 'xypher.vault.v2';

export function loadLocalWallets(): LocalWalletAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: LocalWalletAccount[] = [];
    for (const item of parsed) {
      if (!item || typeof item.wif !== 'string') continue;
      try {
        const priv = wifToKey(item.wif);
        const pub = pubkeyFromPrivate(priv);
        const address = addressFromPrivate(priv);
        valid.push({
          id: typeof item.id === 'string' ? item.id : address.slice(0, 12),
          label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : 'Account',
          address,
          evmAddress: xypherToEvmAddress(address),
          pubHex: bytesToHex(pub),
          wif: item.wif,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        });
      } catch {
        // Skip invalid stored WIF entries
      }
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveLocalWallets(wallets: LocalWalletAccount[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
}

export function createWalletAccount(label: string): LocalWalletAccount {
  const priv = generatePrivateKey();
  const pub = pubkeyFromPrivate(priv);
  const address = addressFromPrivate(priv);
  const wif = keyToWif(priv);
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${address.slice(0, 8)}`,
    label: label.trim() || 'My Wallet',
    address,
    evmAddress: xypherToEvmAddress(address),
    pubHex: bytesToHex(pub),
    wif,
    createdAt: Date.now(),
  };
}

export function importWalletFromWif(wif: string, label: string): LocalWalletAccount {
  const priv = wifToKey(wif.trim());
  const pub = pubkeyFromPrivate(priv);
  const address = addressFromPrivate(priv);
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${address.slice(0, 8)}`,
    label: label.trim() || 'Imported Wallet',
    address,
    evmAddress: xypherToEvmAddress(address),
    pubHex: bytesToHex(pub),
    wif: keyToWif(priv),
    createdAt: Date.now(),
  };
}
