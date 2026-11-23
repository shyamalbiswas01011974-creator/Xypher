import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Link2,
  Lock,
  QrCode,
  ScanLine,
  Send,
  Wallet,
} from 'lucide-react';
import { xypherApi } from '../lib/api.ts';
import { type EvmWalletName, formatWalletError, sendXyphViaMetaMask } from '../lib/metamask.ts';
import type { ParsedXypherQr } from '../lib/qrPayload.ts';
import type {
  AddressInfo,
  ChainInfo,
  LocalWalletAccount,
  TransferAccountingReceipt,
} from '../lib/types.ts';
import { QrScannerModal, ReceiveQrGenerator } from './QrCodeTools.tsx';
import {
  NETWORK_FEE_UNITS,
  NETWORK_FEE_XYPH,
  NETWORK_NAME,
  SYMBOL,
  XYPHER_CHAIN_ID,
  XYPHER_CHAIN_ID_HEX,
  buildSignedTx,
  bytesToHex,
  evmToXypherAddress,
  formatXYPH,
  isValidAddress,
  isValidEvmAddress,
  normalizeToXypherAddress,
  parseXYPHToUnits,
  sha256,
  signDigest,
  truncateHash,
  utf8ToBytes,
  wifToKey,
  xypherToEvmAddress,
} from '../lib/xypherCrypto.ts';

interface SendViewProps {
  chainInfo: ChainInfo | null;
  wallets: LocalWalletAccount[];
  balances: Record<string, AddressInfo>;
  mmAccount: string | null;
  evmWalletName: EvmWalletName | null;
  publicBaseUrl: string | null;
  initialFromAddress?: string | null;
  initialUseMetaMask?: boolean;
  onConnectMetaMask: () => Promise<void>;
  onConnectPhantom: () => Promise<void>;
  onBroadcastSuccess: (txid: string, amountUnits: number, to: string) => void;
  onInspectTx: (txid: string) => void;
}

export const SendView: React.FC<SendViewProps> = ({
  chainInfo,
  wallets,
  balances,
  mmAccount,
  evmWalletName,
  publicBaseUrl,
  initialFromAddress,
  initialUseMetaMask = false,
  onConnectMetaMask,
  onConnectPhantom,
  onBroadcastSuccess,
  onInspectTx,
}) => {
  const activeWalletLabel = evmWalletName || 'MetaMask';
  const [viewMode, setViewMode] = useState<'send' | 'receive'>('send');
  const [signingMode, setSigningMode] = useState<'local' | 'metamask'>(
    initialUseMetaMask && mmAccount ? 'metamask' : 'local'
  );
  const [fromAddress, setFromAddress] = useState<string>(
    initialFromAddress && !isValidEvmAddress(initialFromAddress)
      ? initialFromAddress
      : wallets[0]?.address || ''
  );
  const [receiveAccountKey, setReceiveAccountKey] = useState<string>(
    mmAccount ? 'metamask' : wallets[0]?.address || ''
  );
  const [toAddress, setToAddress] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [feeInput, setFeeInput] = useState(String(NETWORK_FEE_XYPH));
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedTxid, setSubmittedTxid] = useState<string | null>(null);
  const [submittedReceipt, setSubmittedReceipt] = useState<TransferAccountingReceipt | null>(null);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [qrScanNotice, setQrScanNotice] = useState<string | null>(null);

  const [liveSenderInfo, setLiveSenderInfo] = useState<AddressInfo | null>(null);
  const userPickedWalletRef = useRef(Boolean(initialFromAddress || initialUseMetaMask));

  useEffect(() => {
    if (initialUseMetaMask && mmAccount) {
      userPickedWalletRef.current = true;
      setSigningMode('metamask');
    } else if (initialFromAddress && wallets.some((w) => w.address === initialFromAddress)) {
      userPickedWalletRef.current = true;
      setSigningMode('local');
      setFromAddress(initialFromAddress);
    }
  }, [initialFromAddress, initialUseMetaMask, mmAccount, wallets]);

  const effectiveMode: 'local' | 'metamask' =
    signingMode === 'metamask' && mmAccount ? 'metamask' : 'local';

  const effectiveFrom = useMemo(() => {
    if (fromAddress && wallets.some((w) => w.address === fromAddress)) return fromAddress;
    return wallets[0]?.address || '';
  }, [fromAddress, wallets]);

  const mmXyphAddress = useMemo(
    () => (mmAccount ? evmToXypherAddress(mmAccount) : null),
    [mmAccount]
  );

  const sourceWallet = wallets.find((w) => w.address === effectiveFrom);
  const activeSenderXyph = effectiveMode === 'metamask' ? mmXyphAddress : effectiveFrom;

  const senderWalletOptions = useMemo(() => {
    const opts: Array<{
      mode: 'metamask' | 'local';
      address: string;
      label: string;
      spendable: number;
    }> = [];
    if (mmAccount && mmXyphAddress) {
      opts.push({
        mode: 'metamask',
        address: mmXyphAddress,
        label: `${activeWalletLabel} (${truncateHash(mmAccount, 6, 4)})`,
        spendable: balances[mmXyphAddress]?.spendable ?? 0,
      });
    }
    for (const w of wallets) {
      opts.push({
        mode: 'local',
        address: w.address,
        label: `${w.label} (${truncateHash(w.address, 6, 4)})`,
        spendable: balances[w.address]?.spendable ?? 0,
      });
    }
    return opts;
  }, [mmAccount, mmXyphAddress, activeWalletLabel, wallets, balances]);

  const highestBalanceWallet = useMemo(() => {
    if (senderWalletOptions.length === 0) return null;
    return [...senderWalletOptions].sort((a, b) => b.spendable - a.spendable)[0];
  }, [senderWalletOptions]);

  // If no explicit wallet was chosen, auto-select the wallet holding the highest spendable balance (e.g. mining wallet)
  useEffect(() => {
    if (userPickedWalletRef.current || !highestBalanceWallet) return;
    if (highestBalanceWallet.spendable <= 0) return;
    const currentBal = activeSenderXyph ? balances[activeSenderXyph]?.spendable ?? 0 : 0;
    if (currentBal < highestBalanceWallet.spendable) {
      setSigningMode(highestBalanceWallet.mode);
      if (highestBalanceWallet.mode === 'local') {
        setFromAddress(highestBalanceWallet.address);
      }
    }
  }, [highestBalanceWallet, activeSenderXyph, balances]);

  // Fetch live on-chain balance for the active sender so newly mined blocks appear immediately
  useEffect(() => {
    if (!activeSenderXyph) {
      setLiveSenderInfo(null);
      return;
    }
    let cancelled = false;
    void xypherApi
      .getAddress(activeSenderXyph)
      .then((info) => {
        if (!cancelled) setLiveSenderInfo(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeSenderXyph, balances]);

  const sourceBalance = useMemo(() => {
    if (!activeSenderXyph) return undefined;
    if (liveSenderInfo && liveSenderInfo.address === activeSenderXyph) {
      return liveSenderInfo;
    }
    return balances[activeSenderXyph];
  }, [activeSenderXyph, balances, liveSenderInfo]);

  const spendableUtxos = useMemo(
    () => (sourceBalance?.utxos || []).filter((u) => u.spendable),
    [sourceBalance]
  );

  const addressCheck = useMemo(() => {
    const trimmed = toAddress.trim();
    if (!trimmed) return { valid: false, message: '', xyph: null as string | null, evm: null as string | null };
    if (isValidEvmAddress(trimmed)) {
      const xyph = evmToXypherAddress(trimmed);
      return {
        valid: true,
        message: `Valid MetaMask 0x address · maps to ${truncateHash(xyph, 10, 6)}`,
        xyph,
        evm: trimmed,
      };
    }
    if (isValidAddress(trimmed)) {
      const evm = xypherToEvmAddress(trimmed);
      return {
        valid: true,
        message: `Valid Xypher Base58Check address · maps to ${truncateHash(evm, 10, 6)}`,
        xyph: trimmed,
        evm,
      };
    }
    return {
      valid: false,
      message: 'Enter a valid Xypher Base58Check address or MetaMask 0x address',
      xyph: null,
      evm: null,
    };
  }, [toAddress]);

  const preview = useMemo(() => {
    try {
      const amountUnits = amountInput.trim() ? parseXYPHToUnits(amountInput) : 0;
      const feeUnits =
        effectiveMode === 'metamask'
          ? NETWORK_FEE_UNITS
          : feeInput.trim()
          ? parseXYPHToUnits(feeInput)
          : NETWORK_FEE_UNITS;
      const need = amountUnits > 0 ? amountUnits + feeUnits : 0;
      const sorted = [...spendableUtxos].sort((a, b) => b.value - a.value);
      const selected: typeof spendableUtxos = [];
      let totalIn = 0;
      for (const u of sorted) {
        if (need === 0) break;
        selected.push(u);
        totalIn += u.value;
        if (totalIn >= need) break;
      }
      const change = Math.max(0, totalIn - need);
      const sufficient = amountUnits > 0 && (sourceBalance?.spendable ?? 0) >= need;
      return {
        validNumbers: true,
        amountUnits,
        feeUnits,
        need,
        selected,
        totalIn,
        change,
        sufficient,
      };
    } catch {
      return {
        validNumbers: false,
        amountUnits: 0,
        feeUnits: NETWORK_FEE_UNITS,
        need: 0,
        selected: [],
        totalIn: 0,
        change: 0,
        sufficient: false,
      };
    }
  }, [amountInput, feeInput, spendableUtxos, effectiveMode, sourceBalance]);

  const handleSetMax = () => {
    if (!sourceBalance) return;
    try {
      const feeUnits =
        effectiveMode === 'metamask'
          ? NETWORK_FEE_UNITS
          : Math.max(NETWORK_FEE_UNITS, feeInput.trim() ? parseXYPHToUnits(feeInput) : NETWORK_FEE_UNITS);
      const maxUnits = Math.max(0, sourceBalance.spendable - feeUnits);
      setAmountInput((maxUnits / 1e8).toFixed(8));
      setErrorMsg(null);
    } catch {
      setErrorMsg('Enter a valid fee before calculating maximum sendable amount');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmittedTxid(null);
    setSubmittedReceipt(null);

    const normalizedTo = normalizeToXypherAddress(toAddress.trim());
    if (!normalizedTo || !addressCheck.evm) {
      setErrorMsg('Recipient must be a valid Xypher Base58Check or MetaMask 0x address.');
      return;
    }
    if (!preview.validNumbers || preview.amountUnits <= 0) {
      setErrorMsg(`Enter a positive ${SYMBOL} amount.`);
      return;
    }
    if (preview.feeUnits < NETWORK_FEE_UNITS) {
      setErrorMsg(`${NETWORK_NAME} requires a minimum network fee of ${NETWORK_FEE_XYPH} ${SYMBOL}.`);
      return;
    }

    setSubmitting(true);
    try {
      if (effectiveMode === 'metamask') {
        if (!mmAccount || !mmXyphAddress) throw new Error('Connect MetaMask before sending.');

        // Step 1: Verify sender balance on live ledger FIRST before sending
        const verification = await xypherApi.verifyTransferBalance({
          fromAddress: mmXyphAddress,
          toAddress: normalizedTo,
          amountUnits: preview.amountUnits,
          feeUnits: preview.feeUnits,
        });
        const freshMm = await xypherApi.getAddress(mmXyphAddress);
        setLiveSenderInfo(freshMm);
        if (!verification.sufficient) {
          throw new Error(verification.message);
        }

        const txHash = await sendXyphViaMetaMask({
          fromEvm: mmAccount,
          toEvm: addressCheck.evm,
          amountUnits: preview.amountUnits,
          publicBaseUrl,
        });

        // Step 2: Immediately refresh live sender & receiver balances after confirmation
        const [updatedSender, updatedReceiver] = await Promise.all([
          xypherApi.getAddress(mmXyphAddress),
          xypherApi.getAddress(normalizedTo),
        ]);
        setLiveSenderInfo(updatedSender);
        setSubmittedTxid(txHash);
        setSubmittedReceipt({
          txid: txHash,
          blockHeight: null,
          fromAddress: mmAccount,
          toAddress: toAddress.trim(),
          amountUnits: preview.amountUnits,
          feeUnits: preview.feeUnits,
          senderBefore: verification.availableUnits,
          senderAfter: updatedSender.spendable,
          receiverBefore: verification.receiverBeforeUnits ?? 0,
          receiverAfter: updatedReceiver.spendable,
          verifiedSufficientBalance: true,
        });
        setAmountInput('');
        onBroadcastSuccess(txHash, preview.amountUnits, normalizedTo);
      } else {
        if (!sourceWallet) {
          throw new Error('Select a source wallet with a private key.');
        }

        // Step 1: Verify sender balance on live ledger FIRST before signing/broadcasting
        const verification = await xypherApi.verifyTransferBalance({
          fromAddress: sourceWallet.address,
          toAddress: normalizedTo,
          amountUnits: preview.amountUnits,
          feeUnits: preview.feeUnits,
        });
        const freshAddr = await xypherApi.getAddress(sourceWallet.address);
        setLiveSenderInfo(freshAddr);
        if (!verification.sufficient) {
          throw new Error(verification.message);
        }

        const coins = freshAddr.utxos
          .filter((u) => u.spendable)
          .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));
        const utxoSum = coins.reduce((acc, c) => acc + c.value, 0);
        const need = preview.amountUnits + preview.feeUnits;
        const priv = wifToKey(sourceWallet.wif);

        let res: {
          ok: boolean;
          txid: string;
          blockHeight?: number | null;
          accounting?: TransferAccountingReceipt;
        };

        if (utxoSum >= need && freshAddr.spendable >= need && utxoSum <= freshAddr.spendable) {
          const signedTx = buildSignedTx(
            priv,
            coins,
            normalizedTo,
            preview.amountUnits,
            preview.feeUnits
          );
          res = await xypherApi.submitTx(signedTx);
        } else {
          // Spend treasury-settled / EVM-received balance via client-signed secp256k1 transfer
          const { nonce } = await xypherApi.getBridgeNonce(sourceWallet.address);
          const timestamp = Math.floor(Date.now() / 1000);
          const payload = `xypher-bridge-v1|${sourceWallet.address}|${normalizedTo}|${preview.amountUnits}|${preview.feeUnits}|${nonce}|${timestamp}`;
          const sigBytes = signDigest(priv, sha256(utf8ToBytes(payload)));
          res = await xypherApi.submitBridgeTransfer({
            fromXyph: sourceWallet.address,
            toAddress: normalizedTo,
            amountUnits: preview.amountUnits,
            feeUnits: preview.feeUnits,
            timestamp,
            pubHex: sourceWallet.pubHex,
            sigHex: bytesToHex(sigBytes),
          });
        }

        // Step 2: Immediately refresh live sender & receiver balances after confirmation
        const [updatedSender, updatedReceiver] = await Promise.all([
          xypherApi.getAddress(sourceWallet.address),
          xypherApi.getAddress(normalizedTo),
        ]);
        setLiveSenderInfo(updatedSender);
        setSubmittedTxid(res.txid);
        setSubmittedReceipt(
          res.accounting
            ? {
                ...res.accounting,
                senderAfter: updatedSender.spendable,
                receiverAfter: updatedReceiver.spendable,
              }
            : {
                txid: res.txid,
                blockHeight: res.blockHeight ?? null,
                fromAddress: sourceWallet.address,
                toAddress: normalizedTo,
                amountUnits: preview.amountUnits,
                feeUnits: preview.feeUnits,
                senderBefore: verification.availableUnits,
                senderAfter: updatedSender.spendable,
                receiverBefore: verification.receiverBeforeUnits ?? 0,
                receiverAfter: updatedReceiver.spendable,
                verifiedSufficientBalance: true,
              }
        );
        setAmountInput('');
        onBroadcastSuccess(res.txid, preview.amountUnits, normalizedTo);
      }
    } catch (err) {
      setErrorMsg(
        effectiveMode === 'metamask'
          ? formatWalletError(err)
          : err instanceof Error
          ? err.message
          : 'Transaction broadcast failed'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const quickRecipients = useMemo(() => {
    const list: Array<{ label: string; address: string }> = [];
    if (mmAccount && effectiveMode !== 'metamask') {
      list.push({ label: `My ${activeWalletLabel}`, address: mmAccount });
    }
    for (const w of wallets) {
      if (w.address !== activeSenderXyph) {
        list.push({
          label: w.label,
          address: effectiveMode === 'metamask' ? w.evmAddress : w.address,
        });
      }
    }
    return list;
  }, [wallets, activeSenderXyph, mmAccount, activeWalletLabel, effectiveMode]);

  const receiveTargetAccount = useMemo(() => {
    if (receiveAccountKey === 'metamask' && mmAccount && mmXyphAddress) {
      return {
        label: `${activeWalletLabel} Account`,
        xyphAddress: mmXyphAddress,
        evmAddress: mmAccount,
      };
    }
    const found = wallets.find((w) => w.address === receiveAccountKey) || wallets[0];
    if (found) {
      return {
        label: found.label,
        xyphAddress: found.address,
        evmAddress: found.evmAddress,
      };
    }
    if (mmAccount && mmXyphAddress) {
      return {
        label: `${activeWalletLabel} Account`,
        xyphAddress: mmXyphAddress,
        evmAddress: mmAccount,
      };
    }
    return null;
  }, [receiveAccountKey, mmAccount, mmXyphAddress, activeWalletLabel, wallets]);

  const handleQrDetected = (parsed: ParsedXypherQr) => {
    setToAddress(parsed.address);
    if (parsed.amount) {
      setAmountInput(parsed.amount);
    }
    setErrorMsg(null);
    setQrScanNotice(
      parsed.amount
        ? `QR scanned: filled recipient ${truncateHash(parsed.address, 10, 6)} and ${parsed.amount} ${SYMBOL}.`
        : `QR scanned: filled recipient ${truncateHash(parsed.address, 10, 6)}.`
    );
    setShowQrScanner(false);
  };

  return (
    <div className="space-y-6">
      {/* Send / Receive QR Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-md border border-[#222A38] bg-[#121721]">
          <button
            type="button"
            onClick={() => setViewMode('send')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === 'send'
                ? 'bg-amber-500 text-[#0B0E14] font-semibold'
                : 'text-[#8B98A8] hover:text-[#E6EDF3]'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            Send {SYMBOL} (Scan QR)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('receive')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === 'receive'
                ? 'bg-amber-500 text-[#0B0E14] font-semibold'
                : 'text-[#8B98A8] hover:text-[#E6EDF3]'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            Receive Coin QR Generator
          </button>
        </div>

        {viewMode === 'send' && (
          <button
            type="button"
            onClick={() => setShowQrScanner(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md hover:bg-amber-500/20 whitespace-nowrap cursor-pointer"
          >
            <ScanLine className="w-3.5 h-3.5" />
            Scan QR to Send {SYMBOL}
          </button>
        )}
      </div>

      {viewMode === 'receive' ? (
        <div className="border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1D2432] pb-4">
            <div>
              <h2 className="text-base font-semibold text-[#E6EDF3]">
                Generate Receive {SYMBOL} QR Code
              </h2>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Create a scannable QR code for your wallet with an optional requested {SYMBOL} amount. Any sender can scan it to pay you instantly.
              </p>
            </div>
            <select
              value={receiveAccountKey}
              onChange={(e) => setReceiveAccountKey(e.target.value)}
              className="px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
            >
              {mmAccount && (
                <option value="metamask">
                  {activeWalletLabel} ({truncateHash(mmAccount, 8, 6)})
                </option>
              )}
              {wallets.map((w) => (
                <option key={w.id} value={w.address}>
                  {w.label} ({truncateHash(w.address, 8, 6)})
                </option>
              ))}
            </select>
          </div>

          {receiveTargetAccount ? (
            <ReceiveQrGenerator
              label={receiveTargetAccount.label}
              xyphAddress={receiveTargetAccount.xyphAddress}
              evmAddress={receiveTargetAccount.evmAddress}
            />
          ) : (
            <div className="p-6 text-center text-xs text-[#8B98A8]">
              Create a wallet or connect MetaMask / Phantom to generate your receive QR code.
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Payment Builder Form */}
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-7 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5"
          >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#E6EDF3]">Send {SYMBOL}</h2>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Send directly to any native Xypher, MetaMask, or Phantom <span className="font-mono">0x</span> address.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 p-1 bg-[#0B0E14] border border-[#1E2533] rounded-md shrink-0">
            <button
              type="button"
              onClick={() => {
                userPickedWalletRef.current = true;
                setSigningMode('local');
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                effectiveMode === 'local'
                  ? 'bg-[#1D2534] text-[#E6EDF3]'
                  : 'text-[#8B98A8] hover:text-[#E6EDF3]'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              Local
            </button>
            <button
              type="button"
              onClick={() => {
                userPickedWalletRef.current = true;
                setErrorMsg(null);
                if (mmAccount && evmWalletName !== 'Phantom') {
                  setSigningMode('metamask');
                } else {
                  void onConnectMetaMask().then(() => setSigningMode('metamask'));
                }
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                effectiveMode === 'metamask' && evmWalletName !== 'Phantom'
                  ? 'bg-[#1D2534] text-amber-400'
                  : 'text-[#8B98A8] hover:text-[#E6EDF3]'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              MetaMask
            </button>
            <button
              type="button"
              onClick={() => {
                userPickedWalletRef.current = true;
                setErrorMsg(null);
                if (mmAccount && evmWalletName === 'Phantom') {
                  setSigningMode('metamask');
                } else {
                  void onConnectPhantom().then(() => setSigningMode('metamask'));
                }
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                effectiveMode === 'metamask' && evmWalletName === 'Phantom'
                  ? 'bg-[#1D2534] text-violet-400'
                  : 'text-[#8B98A8] hover:text-[#E6EDF3]'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              Phantom
            </button>
          </div>
        </div>

        {effectiveMode === 'metamask' && mmAccount ? (
          <div className="p-3.5 rounded-md bg-[#0B0E14] border border-amber-500/30 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8B98A8]">Connected {activeWalletLabel} Sender</span>
              <span className="font-mono text-emerald-400 tabular-nums">
                {formatXYPH(sourceBalance?.spendable ?? 0, 4)} {SYMBOL}
              </span>
            </div>
            <div className="font-mono text-xs text-[#E6EDF3] break-all">{mmAccount}</div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">Source Wallet</label>
            <select
              value={effectiveFrom}
              onChange={(e) => {
                userPickedWalletRef.current = true;
                setFromAddress(e.target.value);
                setErrorMsg(null);
              }}
              className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
            >
              {wallets.map((w) => {
                const bal =
                  liveSenderInfo && liveSenderInfo.address === w.address
                    ? liveSenderInfo.spendable
                    : balances[w.address]?.spendable ?? 0;
                return (
                  <option key={w.id} value={w.address}>
                    {w.label} · {truncateHash(w.address, 8, 6)} ({formatXYPH(bal, 4)} {SYMBOL})
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center justify-between mb-1.5 gap-2">
            <label className="text-xs font-medium text-[#9AA6B6]">Recipient Address</label>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {quickRecipients.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[#6B7788]">Quick fill:</span>
                  {quickRecipients.slice(0, 3).map((r) => (
                    <button
                      key={r.address}
                      type="button"
                      onClick={() => setToAddress(r.address)}
                      className="text-amber-400 hover:text-amber-300 underline-offset-2 hover:underline cursor-pointer"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowQrScanner(true)}
                className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
              >
                <ScanLine className="w-3.5 h-3.5" />
                Scan QR
              </button>
            </div>
          </div>
          <input
            type="text"
            value={toAddress}
            onChange={(e) => {
              setToAddress(e.target.value);
              setQrScanNotice(null);
            }}
            placeholder="Scan QR or paste Xypher Base58Check / MetaMask 0x... address"
            spellCheck={false}
            className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
          />
          {qrScanNotice && (
            <p className="mt-1.5 text-xs text-emerald-400">{qrScanNotice}</p>
          )}
          {addressCheck.message && (
            <p
              className={`mt-1.5 text-xs ${
                addressCheck.valid ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {addressCheck.message}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[#9AA6B6]">Amount ({SYMBOL})</label>
              <button
                type="button"
                onClick={handleSetMax}
                className="text-xs text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
              >
                Send Max
              </button>
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00000000"
              className="w-full px-3 py-2.5 text-sm font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
            />
          </div>

          {effectiveMode === 'local' ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[#9AA6B6]">
                  {NETWORK_NAME} Fee ({NETWORK_FEE_XYPH} {SYMBOL} · Zero Fee)
                </label>
                <div className="flex items-center gap-2 text-[11px] font-mono text-[#8B98A8]">
                  {['0', '0.001', '0.01'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setFeeInput(preset)}
                      className={`hover:text-amber-400 cursor-pointer ${
                        feeInput === preset ? 'text-amber-400 font-semibold' : ''
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={feeInput}
                onChange={(e) => setFeeInput(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2.5 text-sm font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                {NETWORK_NAME} Gas Fee
              </label>
              <div className="px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#222A38] rounded-md text-emerald-400">
                {NETWORK_FEE_XYPH} {SYMBOL} · Zero Network Fee ({activeWalletLabel})
              </div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300 space-y-2">
            <div>{errorMsg}</div>
            {/insufficient/i.test(errorMsg) && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {highestBalanceWallet &&
                  highestBalanceWallet.address !== activeSenderXyph &&
                  highestBalanceWallet.spendable > (sourceBalance?.spendable ?? 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        userPickedWalletRef.current = true;
                        setSigningMode(highestBalanceWallet.mode);
                        if (highestBalanceWallet.mode === 'local') {
                          setFromAddress(highestBalanceWallet.address);
                        }
                        setErrorMsg(null);
                      }}
                      className="px-2.5 py-1.5 rounded bg-amber-500 text-[#0B0E14] font-semibold hover:bg-amber-400 cursor-pointer"
                    >
                      Switch to {highestBalanceWallet.label} (
                      {formatXYPH(highestBalanceWallet.spendable, 4)} {SYMBOL})
                    </button>
                  )}
                {(sourceBalance?.spendable ?? 0) > NETWORK_FEE_UNITS && (
                  <button
                    type="button"
                    onClick={handleSetMax}
                    className="px-2.5 py-1.5 rounded border border-red-400/40 bg-red-500/15 text-red-100 font-medium hover:bg-red-500/25 cursor-pointer"
                  >
                    Use Max Sendable ({formatXYPH((sourceBalance?.spendable ?? 0) - NETWORK_FEE_UNITS, 4)} {SYMBOL})
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {submittedTxid && (
          <div className="p-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Balance Verified &amp; Confirmed On-Chain · Sender Deducted &amp; Receiver Credited
            </div>
            <p className="font-mono text-xs text-[#E6EDF3] break-all">{submittedTxid}</p>

            {submittedReceipt && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div className="p-2.5 rounded bg-[#0B0E14]/90 border border-red-500/25 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8B98A8] font-medium">Sender Account</span>
                    <span className="font-mono font-semibold text-red-400 tabular-nums">
                      -{formatXYPH(submittedReceipt.amountUnits + submittedReceipt.feeUnits, 4)} {SYMBOL}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-[#6B7788] truncate">
                    {truncateHash(submittedReceipt.fromAddress, 10, 6)}
                  </div>
                  <div className="font-mono text-[11px] text-[#C9D3DF] tabular-nums">
                    {formatXYPH(submittedReceipt.senderBefore, 4)} →{' '}
                    <span className="text-[#E6EDF3] font-semibold">
                      {formatXYPH(submittedReceipt.senderAfter, 4)} {SYMBOL}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 rounded bg-[#0B0E14]/90 border border-emerald-500/25 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8B98A8] font-medium">Receiver Account</span>
                    <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                      +{formatXYPH(submittedReceipt.amountUnits, 4)} {SYMBOL}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-[#6B7788] truncate">
                    {truncateHash(submittedReceipt.toAddress, 10, 6)}
                  </div>
                  <div className="font-mono text-[11px] text-[#C9D3DF] tabular-nums">
                    {formatXYPH(submittedReceipt.receiverBefore, 4)} →{' '}
                    <span className="text-emerald-300 font-semibold">
                      {formatXYPH(submittedReceipt.receiverAfter, 4)} {SYMBOL}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-0.5 flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => onInspectTx(submittedTxid)}
                className="font-medium text-amber-400 hover:underline cursor-pointer"
              >
                View in Block Explorer
              </button>
              {submittedReceipt?.blockHeight !== null && submittedReceipt?.blockHeight !== undefined && (
                <span className="font-mono text-[11px] text-[#8B98A8]">
                  Block #{submittedReceipt.blockHeight}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="pt-2 flex items-center justify-between gap-4 border-t border-[#1D2432]">
          <div className="flex items-center gap-2 text-xs text-[#8B98A8]">
            <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            {effectiveMode === 'metamask'
              ? `Signed in ${activeWalletLabel} · Verified on /evm-rpc`
              : 'Signed client-side · Private key never leaves browser'}
          </div>
          <button
            type="submit"
            disabled={submitting || (effectiveMode === 'local' && !sourceWallet)}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            {submitting
              ? effectiveMode === 'metamask'
                ? `Confirm in ${activeWalletLabel}...`
                : 'Sending...'
              : effectiveMode === 'metamask'
              ? `Send via ${activeWalletLabel}`
              : `Send ${SYMBOL}`}
          </button>
        </div>
      </form>

      {/* Right: Transfer Breakdown */}
      <div className="lg:col-span-5 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[#E6EDF3]">
            {effectiveMode === 'metamask' ? `${activeWalletLabel} EVM Bridge Summary` : 'Transaction Breakdown'}
          </h3>
          <p className="text-xs text-[#8B98A8] mt-0.5">
            {effectiveMode === 'metamask'
              ? `Public Polygon-style EVM RPC on ${NETWORK_NAME} (Chain ID ${chainInfo?.chainId ?? XYPHER_CHAIN_ID})`
              : `Automatic UTXO coin selection · ${NETWORK_NAME} (${NETWORK_FEE_XYPH} ${SYMBOL} fee)`}
          </p>
        </div>

        <div className="space-y-3 text-xs border-y border-[#1D2432] py-4">
          <div className="flex justify-between">
            <span className="text-[#8B98A8]">Available Balance</span>
            <span className="font-mono text-[#E6EDF3] tabular-nums">
              {formatXYPH(sourceBalance?.spendable ?? 0)} {SYMBOL}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B98A8]">Receiver Account Adds</span>
            <span className="font-mono text-emerald-400 tabular-nums">
              {preview.validNumbers ? `+${formatXYPH(preview.amountUnits)}` : '—'} {SYMBOL}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B98A8]">{NETWORK_NAME} Fee</span>
            <span className="font-mono text-amber-400 tabular-nums">
              {preview.validNumbers ? formatXYPH(preview.feeUnits) : '—'} {SYMBOL}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B98A8]">Sender Balance After Send</span>
            <span
              className={`font-mono tabular-nums ${
                preview.sufficient ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {preview.sufficient
                ? formatXYPH(Math.max(0, (sourceBalance?.spendable ?? 0) - preview.need))
                : 'Insufficient balance'}{' '}
              {preview.sufficient ? SYMBOL : ''}
            </span>
          </div>
          {effectiveMode === 'metamask' && (
            <div className="flex justify-between">
              <span className="text-[#8B98A8]">Chain ID</span>
              <span className="font-mono text-amber-400 tabular-nums">
                {chainInfo?.chainId ?? XYPHER_CHAIN_ID} ({chainInfo?.chainIdHex ?? XYPHER_CHAIN_ID_HEX})
              </span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t border-[#1D2432] font-medium">
            <span className="text-[#C9D3DF]">Sender Account Deducts</span>
            <span className="font-mono text-red-400 tabular-nums">
              {preview.validNumbers ? `-${formatXYPH(preview.need)}` : '—'} {SYMBOL}
            </span>
          </div>
        </div>

        {effectiveMode === 'local' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#C9D3DF]">Selected UTXO Inputs</span>
              <span className="font-mono text-[#8B98A8] tabular-nums">
                {preview.selected.length} / {spendableUtxos.length}
              </span>
            </div>
            {preview.selected.length === 0 ? (
              <p className="text-xs text-[#6B7788] py-2">
                Enter an amount to preview selected inputs.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {preview.selected.map((u) => (
                  <div
                    key={`${u.txid}:${u.index}`}
                    className="flex items-center justify-between py-2 px-3 rounded bg-[#0B0E14] border border-[#1E2533] text-xs font-mono"
                  >
                    <span className="text-[#9AA6B6]">
                      {truncateHash(u.txid, 8, 6)}:{u.index}
                    </span>
                    <span className="text-[#E6EDF3] tabular-nums">{formatXYPH(u.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {preview.need > 0 && !preview.sufficient && (
          <p className="text-xs text-red-400 font-medium">
            Insufficient balance in wallet: available {formatXYPH(sourceBalance?.spendable ?? 0, 4)} {SYMBOL}, required {formatXYPH(preview.need, 4)} {SYMBOL}. Receive {SYMBOL} via your QR code or buy {SYMBOL} on the Buy &amp; Sell tab first.
          </p>
        )}

        {preview.sufficient && addressCheck.valid && activeSenderXyph && (
          <div className="p-3 rounded bg-[#0B0E14] border border-[#1E2533] text-xs space-y-1.5">
            <div className="text-[#8B98A8]">Settlement Path</div>
            <div className="flex items-center gap-2 font-mono text-[#C9D3DF]">
              <span>
                {truncateHash(
                  effectiveMode === 'metamask' && mmAccount ? mmAccount : activeSenderXyph,
                  7,
                  5
                )}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{truncateHash(toAddress.trim(), 7, 5)}</span>
            </div>
            <p className="text-[11px] text-[#6B7788]">
              Confirmed automatically on the Xypher ledger in ~1–2 seconds.
            </p>
          </div>
        )}
      </div>
    </div>
      )}

      {showQrScanner && (
        <QrScannerModal
          onDetected={handleQrDetected}
          onClose={() => setShowQrScanner(false)}
        />
      )}
    </div>
  );
};
