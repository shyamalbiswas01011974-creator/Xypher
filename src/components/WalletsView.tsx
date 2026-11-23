import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LogOut,
  Plus,
  QrCode,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import {
  type EvmWalletName,
  XYPHER_COIN_ICON_PATH,
  getMetaMaskMobileDeepLink,
  getPhantomMobileDeepLink,
} from '../lib/metamask.ts';
import type { AddressInfo, ChainInfo, LocalWalletAccount, MarketTicker } from '../lib/types.ts';
import { ReceiveQrGenerator } from './QrCodeTools.tsx';
import { WalletMiningPanel } from './WalletMiningPanel.tsx';
import {
  SYMBOL,
  UNIT,
  XYPHER_CHAIN_ID_HEX,
  evmToXypherAddress,
  formatXYPH,
  truncateHash,
} from '../lib/xypherCrypto.ts';

interface WalletsViewProps {
  chainInfo: ChainInfo | null;
  marketTicker: MarketTicker | null;
  wallets: LocalWalletAccount[];
  balances: Record<string, AddressInfo>;
  loading: boolean;
  mmAccount: string | null;
  mmChainId: string | null;
  evmWalletName: EvmWalletName | null;
  phantomSolAccount: string | null;
  phantomSolBalance: number | null;
  publicBaseUrl: string | null;
  mmBusy: boolean;
  mmError: string | null;
  mmNotice: string | null;
  onConnectMetaMask: () => Promise<void>;
  onConnectPhantom: () => Promise<void>;
  onDisconnectPhantomSolana: () => Promise<void>;
  onAddXypherToMetaMask: () => Promise<void>;
  onWatchXyphToken: () => Promise<void>;
  onCreateWallet: (label: string) => void;
  onImportWif: (wif: string, label: string) => string | null;
  onDeleteWallet: (id: string) => void;
  onQuickSend: (address: string, useMetaMask?: boolean) => void;
  onGoToBuy: () => void;
  onInspectTx: (txid: string) => void;
  onRefreshBalances: () => Promise<void>;
}

export const WalletsView: React.FC<WalletsViewProps> = ({
  chainInfo,
  marketTicker,
  wallets,
  balances,
  loading,
  mmAccount,
  mmChainId,
  evmWalletName,
  phantomSolAccount,
  phantomSolBalance,
  publicBaseUrl,
  mmBusy,
  mmError,
  mmNotice,
  onConnectMetaMask,
  onConnectPhantom,
  onDisconnectPhantomSolana,
  onAddXypherToMetaMask,
  onWatchXyphToken,
  onCreateWallet,
  onImportWif,
  onDeleteWallet,
  onQuickSend,
  onGoToBuy,
  onInspectTx,
  onRefreshBalances,
}) => {
  const activeWalletLabel = evmWalletName || 'MetaMask';
  const phantomMobileUrl = useMemo(
    () => getPhantomMobileDeepLink(publicBaseUrl),
    [publicBaseUrl]
  );
  const metamaskBuyMobileUrl = useMemo(
    () => getMetaMaskMobileDeepLink(publicBaseUrl, '/?tab=buy'),
    [publicBaseUrl]
  );
  const mmXyphAddress = useMemo(
    () => (mmAccount ? evmToXypherAddress(mmAccount) : null),
    [mmAccount]
  );

  const isOnXypherChain =
    mmChainId?.toLowerCase() === XYPHER_CHAIN_ID_HEX.toLowerCase();

  const [selectedAddress, setSelectedAddress] = useState<string | null>(
    wallets[0]?.address ?? null
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  const [showImportModal, setShowImportModal] = useState(false);
  const [importWif, setImportWif] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const [receiveTarget, setReceiveTarget] = useState<{
    label: string;
    xyphAddress: string;
    evmAddress: string;
  } | null>(null);

  const [exportWallet, setExportWallet] = useState<LocalWalletAccount | null>(null);
  const [revealWif, setRevealWif] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeAddress = useMemo(() => {
    if (selectedAddress) {
      if (selectedAddress === mmXyphAddress) return selectedAddress;
      if (wallets.some((w) => w.address === selectedAddress)) return selectedAddress;
    }
    return mmXyphAddress ?? wallets[0]?.address ?? null;
  }, [selectedAddress, wallets, mmXyphAddress]);

  const totals = useMemo(() => {
    const counted = new Set<string>();
    let total = 0;
    let spendable = 0;
    const addAddr = (addr: string | null) => {
      if (!addr || counted.has(addr)) return;
      counted.add(addr);
      const b = balances[addr];
      if (b) {
        total += b.total;
        spendable += b.spendable;
      }
    };
    addAddr(mmXyphAddress);
    for (const w of wallets) addAddr(w.address);
    return { total, spendable, accountCount: counted.size };
  }, [wallets, balances, mmXyphAddress]);

  const mmBalance = mmXyphAddress ? balances[mmXyphAddress] : undefined;
  const selectedInfo = activeAddress ? balances[activeAddress] : undefined;
  const selectedMeta = useMemo(() => {
    if (!activeAddress) return null;
    if (activeAddress === mmXyphAddress && mmAccount) {
      return {
        label: `${activeWalletLabel} Account`,
        address: activeAddress,
        evmAddress: mmAccount,
      };
    }
    const local = wallets.find((w) => w.address === activeAddress);
    return local
      ? { label: local.label, address: local.address, evmAddress: local.evmAddress }
      : null;
  }, [activeAddress, mmXyphAddress, mmAccount, activeWalletLabel, wallets]);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateWallet(newLabel.trim() || `Wallet ${wallets.length + 1}`);
    setNewLabel('');
    setShowCreateModal(false);
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);
    const err = onImportWif(importWif, importLabel || 'Imported Wallet');
    if (err) {
      setImportError(err);
      return;
    }
    setImportWif('');
    setImportLabel('');
    setShowImportModal(false);
  };

  return (
    <div className="space-y-8">
      {/* Portfolio KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-[#222A38] rounded-lg bg-[#121721] divide-y sm:divide-y-0 sm:divide-x divide-[#222A38]">
        <div className="p-5 flex items-start gap-3.5">
          <img
            src={XYPHER_COIN_ICON_PATH}
            alt="Xypher (XYPH)"
            className="w-10 h-10 rounded-full object-cover ring-1 ring-white/15 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-xs text-[#8B98A8] font-medium">Total Portfolio Balance</p>
            <p className="mt-1.5 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums">
              {formatXYPH(totals.total, 4)}
              <span className="ml-1.5 text-sm font-normal text-[#8B98A8]">{SYMBOL}</span>
            </p>
            <p className="mt-1 text-xs text-[#6B7788] font-mono tabular-nums">
              {marketTicker
                ? `≈ ₹${((totals.total / UNIT) * marketTicker.priceInr).toFixed(2)} · ₹${marketTicker.priceInr.toFixed(5)}/${SYMBOL}`
                : `${formatXYPH(totals.total)} exact`}
            </p>
          </div>
        </div>

        <div className="p-5">
          <p className="text-xs text-[#8B98A8] font-medium">Available to Send</p>
          <p className="mt-2 text-2xl font-mono font-semibold text-emerald-400 tabular-nums">
            {formatXYPH(totals.spendable, 4)}
            <span className="ml-1.5 text-sm font-normal text-[#8B98A8]">{SYMBOL}</span>
          </p>
          <p className="mt-1 text-xs text-[#6B7788]">Confirmed on Xypher ledger</p>
        </div>

        <div className="p-5">
          <p className="text-xs text-[#8B98A8] font-medium">Web3 Wallet</p>
          <p className="mt-2 text-lg font-mono font-semibold text-[#E6EDF3] tabular-nums">
            {mmAccount
              ? `${activeWalletLabel} · ${isOnXypherChain ? 'Xypher' : 'Linked'}`
              : phantomSolAccount
              ? 'Phantom · Solana'
              : 'Not Linked'}
          </p>
          <p className="mt-1 text-xs text-[#6B7788] font-mono">
            Chain ID {chainInfo?.chainId ?? 5790032} ({chainInfo?.chainIdHex ?? XYPHER_CHAIN_ID_HEX})
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-[#8B98A8] font-medium">Your Addresses</p>
          <p className="mt-2 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums">
            {totals.accountCount}
          </p>
          <p className="mt-1 text-xs text-[#6B7788]">Local + MetaMask + Phantom</p>
        </div>
      </div>

      {/* MetaMask & Phantom Web3 Wallet Panel */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-amber-400" />
              <h2 className="text-base font-semibold text-[#E6EDF3]">
                MetaMask &amp; Phantom Wallet
              </h2>
            </div>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Connect MetaMask or Phantom Wallet (EVM &amp; Solana) to hold {SYMBOL}, view the coin logo, and sign real on-chain transactions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onGoToBuy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-md hover:bg-emerald-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Buy / Sell {SYMBOL}
            </button>
            <button
              type="button"
              onClick={() => void onWatchXyphToken()}
              disabled={mmBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:border-amber-500/50 hover:bg-[#232C3D] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <img
                src={XYPHER_COIN_ICON_PATH}
                alt="XYPH"
                className="w-4 h-4 rounded-full object-cover shrink-0"
              />
              Show Coin Picture
            </button>
            <button
              type="button"
              onClick={() => void onAddXypherToMetaMask()}
              disabled={mmBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              Add {SYMBOL} Network
            </button>
            <button
              type="button"
              onClick={() => void onConnectPhantom()}
              disabled={mmBusy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-violet-600 rounded-md hover:bg-violet-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Wallet className="w-3.5 h-3.5" />
              {mmBusy
                ? 'Connecting...'
                : evmWalletName === 'Phantom' || phantomSolAccount
                ? 'Reconnect Phantom'
                : 'Connect Phantom'}
            </button>
            {!mmAccount || evmWalletName === 'Phantom' ? (
              <button
                type="button"
                onClick={() => void onConnectMetaMask()}
                disabled={mmBusy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Wallet className="w-3.5 h-3.5" />
                {mmBusy ? 'Connecting...' : 'Connect MetaMask'}
              </button>
            ) : !isOnXypherChain ? (
              <button
                type="button"
                onClick={() => void onAddXypherToMetaMask()}
                disabled={mmBusy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                Switch to Xypher
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onQuickSend(mmAccount, true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Send via {activeWalletLabel}
              </button>
            )}
          </div>
        </div>

        {mmNotice && (
          <div className="px-5 py-3 border-b border-[#222A38] bg-emerald-500/10 text-xs text-emerald-300">
            {mmNotice}
          </div>
        )}

        {mmError && (
          <div className="px-5 py-3 border-b border-[#222A38] bg-red-500/10 text-xs text-red-300">
            {mmError}
          </div>
        )}

        {mmAccount && mmXyphAddress && (
          <div
            onClick={() => setSelectedAddress(mmXyphAddress)}
            className={`px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer transition-colors ${
              phantomSolAccount ? 'border-b border-[#1D2432]' : ''
            } ${
              activeAddress === mmXyphAddress ? 'bg-[#19202D]' : 'hover:bg-[#161C27]'
            }`}
          >
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#8B98A8] w-28 shrink-0">
                  {activeWalletLabel} 0x
                </span>
                <span className="font-mono text-[#E6EDF3] truncate">{mmAccount}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyText(mmAccount, 'mm-evm');
                  }}
                  title={`Copy ${activeWalletLabel} 0x address`}
                  className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer shrink-0"
                >
                  {copiedId === 'mm-evm' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#8B98A8] w-28 shrink-0">Xypher Native</span>
                <span className="font-mono text-[#C9D3DF] truncate">{mmXyphAddress}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyText(mmXyphAddress, 'mm-xyph');
                  }}
                  title="Copy Xypher Base58Check address"
                  className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer shrink-0"
                >
                  {copiedId === 'mm-xyph' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 shrink-0">
              <div className="text-left lg:text-right">
                <div className="font-mono text-base font-semibold text-emerald-400 tabular-nums">
                  {formatXYPH(mmBalance?.spendable ?? 0, 4)} {SYMBOL}
                </div>
                <div className="text-[11px] text-[#8B98A8]">
                  {isOnXypherChain
                    ? `Active on Xypher Network (${activeWalletLabel})`
                    : `${activeWalletLabel} connected on chain ${mmChainId || 'EVM'}`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={onGoToBuy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-200 bg-emerald-500/15 border border-emerald-500/40 rounded hover:bg-emerald-500/25 whitespace-nowrap cursor-pointer"
                >
                  Buy {SYMBOL} (UPI)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setReceiveTarget({
                      label: `${activeWalletLabel} Account`,
                      xyphAddress: mmXyphAddress,
                      evmAddress: mmAccount,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] whitespace-nowrap cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  Receive QR
                </button>
                <button
                  type="button"
                  onClick={() => onQuickSend(mmAccount, true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 whitespace-nowrap cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {phantomSolAccount && (
          <div className="px-5 py-3.5 bg-[#111622] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-violet-400 font-medium w-28 shrink-0">Phantom Solana</span>
              <span className="font-mono text-[#E6EDF3] truncate">{phantomSolAccount}</span>
              <button
                type="button"
                onClick={() => copyText(phantomSolAccount, 'ph-sol')}
                title="Copy Phantom Solana address"
                className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer shrink-0"
              >
                {copiedId === 'ph-sol' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <div className="font-mono text-sm font-semibold text-[#E6EDF3] tabular-nums">
                {phantomSolBalance !== null ? `${phantomSolBalance.toFixed(4)} SOL` : 'Connected (Solana)'}
              </div>
              <button
                type="button"
                onClick={() => void onDisconnectPhantomSolana()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] whitespace-nowrap cursor-pointer"
              >
                <LogOut className="w-3 h-3" />
                Disconnect
              </button>
            </div>
          </div>
        )}

        {!mmAccount && !phantomSolAccount && (
          <div className="px-5 py-4 text-xs text-[#9AA6B6] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span>
              Connect MetaMask or Phantom Wallet to hold {SYMBOL}, buy/sell directly into your wallet, and sign real on-chain transactions.
            </span>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {phantomMobileUrl && (
                <a
                  href={phantomMobileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 font-medium whitespace-nowrap"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open in Phantom Mobile
                </a>
              )}
              <span className="font-mono text-[#6B7788] whitespace-nowrap">
                RPC: /evm-rpc · Chain 5790032
              </span>
            </div>
          </div>
        )}

        {/* Regional MetaMask Buy Guidance & Direct UPI Bypass */}
        <div className="px-5 py-3 border-t border-[#1D2432] bg-[#0F141E] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <p className="text-[#9AA6B6]">
            MetaMask&apos;s built-in Buy button is region-restricted and does not support custom networks. Use{' '}
            <span className="text-[#E6EDF3] font-medium">Buy {SYMBOL} via UPI</span> here instead — coins are credited automatically to your MetaMask 0x wallet on XYPH Network in any region.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onGoToBuy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0B0E14] bg-emerald-400 rounded hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Buy {SYMBOL} into MetaMask
            </button>
            {metamaskBuyMobileUrl && (
              <a
                href={metamaskBuyMobileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-medium whitespace-nowrap"
              >
                <ExternalLink className="w-3 h-3" />
                Open Buy in MetaMask App
              </a>
            )}
          </div>
        </div>
      </div>

      {/* XYPH 10-Minute Block Mining System */}
      <WalletMiningPanel
        wallets={wallets}
        balances={balances}
        mmAccount={mmAccount}
        activeWalletLabel={activeWalletLabel}
        onBlockMined={onRefreshBalances}
        onQuickSend={onQuickSend}
        onInspectTx={onInspectTx}
      />

      {/* Personal Local Wallet Addresses Table */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-[#222A38]">
          <div>
            <h2 className="text-base font-semibold text-[#E6EDF3]">Your Local Xypher Wallets</h2>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Every user receives a unique secp256k1 wallet generated locally in their browser with both Native Xypher and MetaMask-compatible 0x addresses.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setImportError(null);
                setShowImportModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import WIF
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Wallet
            </button>
          </div>
        </div>

        {wallets.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-[#8B98A8]">No local wallet addresses in this browser yet.</p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Wallet
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#222A38] text-xs font-medium text-[#8B98A8]">
                  <th className="py-3 px-5">Wallet</th>
                  <th className="py-3 px-4">Native &amp; MetaMask Address</th>
                  <th className="py-3 px-4 text-right">Balance ({SYMBOL})</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D2432] text-sm">
                {wallets.map((w) => {
                  const bal = balances[w.address];
                  const isSelected = w.address === activeAddress;
                  return (
                    <tr
                      key={w.id}
                      onClick={() => setSelectedAddress(w.address)}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? 'bg-[#19202D]' : 'hover:bg-[#161C27]'
                      }`}
                    >
                      <td className="py-3.5 px-5 whitespace-nowrap">
                        <div className="font-medium text-[#E6EDF3]">{w.label}</div>
                        <div className="text-xs text-[#6B7788]">secp256k1 P2PKH</div>
                      </td>
                      <td className="py-3.5 px-4 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-[#E6EDF3]">{w.address}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyText(w.address, `${w.id}-xyph`);
                            }}
                            title="Copy Xypher Base58Check address"
                            className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] transition-colors cursor-pointer"
                          >
                            {copiedId === `${w.id}-xyph` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-[#8B98A8]">
                            {w.evmAddress}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyText(w.evmAddress, `${w.id}-evm`);
                            }}
                            title="Copy MetaMask 0x address"
                            className="p-0.5 text-[#6B7788] hover:text-[#E6EDF3] transition-colors cursor-pointer"
                          >
                            {copiedId === `${w.id}-evm` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-emerald-400">
                          {loading && !bal ? '—' : `${formatXYPH(bal?.spendable ?? 0)} ${SYMBOL}`}
                        </div>
                        {marketTicker && bal && (
                          <div className="text-[11px] text-[#6B7788] mt-0.5">
                            ≈ ₹{((bal.spendable / UNIT) * marketTicker.priceInr).toFixed(2)}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div
                          className="inline-flex items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setReceiveTarget({
                                label: w.label,
                                xyphAddress: w.address,
                                evmAddress: w.evmAddress,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1D2534] border border-[#2A3446] rounded hover:border-amber-500/50 transition-colors cursor-pointer"
                          >
                            <QrCode className="w-3 h-3 text-amber-400" />
                            Receive QR
                          </button>
                          <button
                            type="button"
                            onClick={() => onQuickSend(w.address, false)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1D2534] border border-[#2A3446] rounded hover:border-amber-500/50 transition-colors cursor-pointer"
                          >
                            <Send className="w-3 h-3" />
                            Send
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRevealWif(false);
                              setExportWallet(w);
                            }}
                            title="Export WIF private key"
                            className="p-1.5 text-[#8B98A8] hover:text-[#E6EDF3] border border-transparent hover:border-[#2A3446] rounded transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          {wallets.length > 1 &&
                            (confirmDeleteId === w.id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteWallet(w.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2 py-1 text-xs font-medium text-red-300 bg-red-500/20 border border-red-500/40 rounded hover:bg-red-500/30 cursor-pointer"
                              >
                                Remove
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(w.id)}
                                title="Remove from browser vault"
                                className="p-1.5 text-[#6B7788] hover:text-red-400 rounded transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected Account UTXO & Transaction History */}
      {selectedMeta && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Confirmed XYPH Balance & UTXOs */}
          <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#222A38] flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[#E6EDF3]">
                  Wallet {SYMBOL} Balance &amp; UTXOs · {selectedMeta.label}
                </h3>
                <p className="text-xs text-[#8B98A8] font-mono mt-0.5">
                  {truncateHash(selectedMeta.address, 14, 10)}
                </p>
              </div>
              <span className="text-xs text-emerald-400 font-mono font-semibold tabular-nums">
                {formatXYPH(selectedInfo?.spendable ?? 0, 4)} {SYMBOL}
              </span>
            </div>

            {(() => {
              const utxoList = selectedInfo?.utxos ?? [];
              const utxoSpendable = utxoList
                .filter((u) => u.spendable)
                .reduce((acc, u) => acc + u.value, 0);
              const ledgerBalanceUnits = Math.max(
                0,
                (selectedInfo?.spendable ?? 0) - utxoSpendable
              );
              const hasAnyBalance = utxoList.length > 0 || ledgerBalanceUnits > 0;

              if (!selectedInfo || !hasAnyBalance) {
                return (
                  <div className="p-8 text-center text-xs text-[#8B98A8]">
                    No {SYMBOL} balance on this address yet. Receive {SYMBOL} via QR code or buy {SYMBOL} on the Buy &amp; Sell tab.
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#222A38] text-[#8B98A8]">
                        <th className="py-2.5 px-4">Source / Outpoint</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-4 text-right">Amount ({SYMBOL})</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1D2432]">
                      {ledgerBalanceUnits > 0 && (
                        <tr className="hover:bg-[#161C27]">
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-[#E6EDF3]">
                              XYPH Network Ledger Balance
                            </div>
                            <div className="text-[11px] text-[#6B7788]">
                              Confirmed &amp; spendable for Send, Sell &amp; MetaMask
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="text-emerald-400 font-medium">Available</span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-400 tabular-nums whitespace-nowrap">
                            {formatXYPH(ledgerBalanceUnits)} {SYMBOL}
                          </td>
                        </tr>
                      )}
                      {utxoList.map((u) => (
                        <tr key={`${u.txid}:${u.index}`} className="hover:bg-[#161C27]">
                          <td className="py-2.5 px-4 font-mono">
                            <button
                              type="button"
                              onClick={() => onInspectTx(u.txid)}
                              className="text-amber-400 hover:underline cursor-pointer"
                            >
                              {truncateHash(u.txid, 8, 6)}:{u.index}
                            </button>
                            <div className="text-[11px] text-[#6B7788]">
                              Block #{u.height} · {u.confirmations} conf
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            {u.spendable ? (
                              <span className="text-emerald-400 font-medium">Available</span>
                            ) : (
                              <span className="text-amber-400 font-medium">
                                Confirming ({u.blocksUntilMature} left)
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-[#E6EDF3] tabular-nums whitespace-nowrap">
                            {formatXYPH(u.value)} {SYMBOL}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>

          {/* Address Ledger History */}
          <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#222A38] flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[#E6EDF3]">
                  Transaction Activity · {selectedMeta.label}
                </h3>
                <p className="text-xs text-[#8B98A8] mt-0.5">
                  Confirmed native transfers and MetaMask transactions
                </p>
              </div>
              <span className="text-xs text-[#8B98A8] font-mono tabular-nums">
                {selectedInfo?.history.length ?? 0} entries
              </span>
            </div>

            {!selectedInfo || selectedInfo.history.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8B98A8]">
                No transactions recorded for this wallet yet.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#222A38] text-[#8B98A8]">
                      <th className="py-2.5 px-4">Transaction</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-4 text-right">Net ({SYMBOL})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D2432]">
                    {selectedInfo.history.map((h) => (
                      <tr key={h.txid} className="hover:bg-[#161C27]">
                        <td className="py-2.5 px-4 font-mono">
                          <button
                            type="button"
                            onClick={() => onInspectTx(h.txid)}
                            className="text-[#C9D3DF] hover:text-amber-400 hover:underline cursor-pointer"
                          >
                            {truncateHash(h.txid, 10, 6)}
                          </button>
                          <div className="text-[11px] text-[#6B7788]">
                            {h.blockHeight === null
                              ? 'Pending confirmation'
                              : `Block #${h.blockHeight} · ${new Date(h.time * 1000).toLocaleTimeString()}`}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {h.direction === 'sent' ? (
                            <span className="text-red-400 font-medium">Sent · Deducted</span>
                          ) : h.direction === 'received' ? (
                            <span className="text-emerald-400 font-medium">Received · Added</span>
                          ) : h.direction === 'mined' ? (
                            <span className="text-amber-400 font-medium">Reward · Added</span>
                          ) : (
                            <span className="text-[#9AA6B6]">Self Transfer</span>
                          )}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                            h.netChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {h.netChange >= 0 ? '+' : ''}
                          {formatXYPH(h.netChange)} {SYMBOL}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Receive QR Modal */}
      {receiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-xl border border-[#2A3446] rounded-lg bg-[#121721] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-amber-400" />
                <h3 className="text-base font-semibold text-[#E6EDF3]">
                  Receive {SYMBOL} QR · {receiveTarget.label}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#9AA6B6]">
              Scan this QR code from any Xypher wallet to send {SYMBOL} directly. Both Native and MetaMask (0x) addresses credit the exact same on-chain balance.
            </p>

            <ReceiveQrGenerator
              label={receiveTarget.label}
              xyphAddress={receiveTarget.xyphAddress}
              evmAddress={receiveTarget.evmAddress}
            />

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Address Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md border border-[#2A3446] rounded-lg bg-[#121721] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#E6EDF3]">Create Unique Wallet</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                  Wallet Label
                </label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={`e.g. Savings ${wallets.length + 1} or Trading`}
                  className="w-full px-3 py-2 text-sm bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  autoFocus
                />
              </div>
              <p className="text-xs text-[#8B98A8]">
                Generates a brand-new random 256-bit secp256k1 private key inside your browser and derives both a Xypher Base58Check (<span className="font-mono text-[#E6EDF3]">0x58</span>) and MetaMask-compatible <span className="font-mono text-[#E6EDF3]">0x</span> address.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer"
                >
                  Create Wallet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import WIF Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md border border-[#2A3446] rounded-lg bg-[#121721] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#E6EDF3]">Import WIF Private Key</h3>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                  Wallet Label
                </label>
                <input
                  type="text"
                  value={importLabel}
                  onChange={(e) => setImportLabel(e.target.value)}
                  placeholder="Imported Wallet"
                  className="w-full px-3 py-2 text-sm bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                  Xypher WIF Key (Version 0xA8)
                </label>
                <input
                  type="password"
                  value={importWif}
                  onChange={(e) => setImportWif(e.target.value)}
                  placeholder="Paste Base58Check WIF key"
                  className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              {importError && <p className="text-xs text-red-400">{importError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 text-xs font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer"
                >
                  Import Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Export WIF Backup Modal */}
      {exportWallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg border border-[#2A3446] rounded-lg bg-[#121721] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <h3 className="text-base font-semibold text-[#E6EDF3]">
                  Private Key Backup · {exportWallet.label}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setExportWallet(null)}
                className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-[#8B98A8] mb-1">Native Xypher Address</p>
                <div className="p-2.5 bg-[#0B0E14] border border-[#222A38] rounded font-mono text-xs text-[#E6EDF3] break-all">
                  {exportWallet.address}
                </div>
              </div>
              <div>
                <p className="text-xs text-[#8B98A8] mb-1">Linked MetaMask 0x Address</p>
                <div className="p-2.5 bg-[#0B0E14] border border-[#222A38] rounded font-mono text-xs text-[#C9D3DF] break-all">
                  {exportWallet.evmAddress}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-[#8B98A8]">WIF Private Key</p>
                  <button
                    type="button"
                    onClick={() => setRevealWif((r) => !r)}
                    className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 cursor-pointer"
                  >
                    {revealWif ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {revealWif ? 'Hide key' : 'Reveal key'}
                  </button>
                </div>
                <div className="p-2.5 bg-[#0B0E14] border border-amber-500/30 rounded font-mono text-xs text-amber-300 break-all">
                  {revealWif ? exportWallet.wif : '•'.repeat(51)}
                </div>
              </div>
              <p className="text-xs text-[#8B98A8] flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                Anyone with this WIF private key controls all funds at this address. Store it offline; it is directly compatible with Xypher Python CLI wallets.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => copyText(exportWallet.wif, 'export-wif')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer"
              >
                {copiedId === 'export-wif' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied WIF
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy WIF
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setExportWallet(null)}
                className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
