import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  IndianRupee,
  KeyRound,
  Link2,
  Lock,
  LogOut,
  Maximize2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { xypherApi } from '../lib/api.ts';
import {
  INITIAL_POOL_INR_RESERVE,
  INITIAL_POOL_XYPH_RESERVE,
  quoteBuyAmm,
  quoteSellAmm,
} from '../lib/marketMath.ts';
import {
  type EvmWalletName,
  XYPHER_COIN_ICON_PATH,
  formatWalletError,
  getPhantomMobileDeepLink,
  sendXyphViaMetaMask,
} from '../lib/metamask.ts';
import { LiveMarketPanel } from './LiveMarketPanel.tsx';
import type {
  AddressInfo,
  LocalWalletAccount,
  MarketTicker,
  PaymentAdminSummary,
  PaymentConfig,
  PaymentOrder,
  SellAdminSummary,
  SellOrder,
  SellPayoutMethod,
} from '../lib/types.ts';
import {
  NETWORK_FEE_UNITS,
  NETWORK_FEE_XYPH,
  NETWORK_NAME,
  SYMBOL,
  UNIT,
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

interface BuyViewProps {
  wallets: LocalWalletAccount[];
  balances: Record<string, AddressInfo>;
  marketTicker: MarketTicker | null;
  streamConnected: boolean;
  mmAccount: string | null;
  mmChainId: string | null;
  evmWalletName: EvmWalletName | null;
  mmBusy: boolean;
  mmError: string | null;
  mmNotice: string | null;
  publicBaseUrl: string | null;
  onConnectMetaMask: () => Promise<void>;
  onConnectPhantom: () => Promise<void>;
  onAddXypherToMetaMask: () => Promise<void>;
  onWatchXyphToken: () => Promise<void>;
  onMarketUpdated: (ticker: MarketTicker) => void;
  onOrderSettled: (order: PaymentOrder) => void;
  onSellSubmitted: (sellOrder: SellOrder) => void;
  onInspectTx: (txid: string) => void;
  onOpenCryptoExchange?: () => void;
}

const PRESET_INR = [1, 10, 50, 100];
const SELL_PERCENT_PRESETS = [25, 50, 75, 100];

export const BuyView: React.FC<BuyViewProps> = ({
  wallets,
  balances,
  marketTicker,
  streamConnected,
  mmAccount,
  mmChainId,
  evmWalletName,
  mmBusy,
  mmError,
  mmNotice,
  publicBaseUrl,
  onConnectMetaMask,
  onConnectPhantom,
  onAddXypherToMetaMask,
  onWatchXyphToken,
  onMarketUpdated,
  onOrderSettled,
  onSellSubmitted,
  onInspectTx,
  onOpenCryptoExchange,
}) => {
  const activeWalletLabel = evmWalletName || 'MetaMask';
  const [subTab, setSubTab] = useState<'buy' | 'sell' | 'merchant'>('buy');
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Buyer form state
  const [destType, setDestType] = useState<'metamask' | 'local' | 'custom'>(
    mmAccount ? 'metamask' : wallets.length > 0 ? 'local' : 'custom'
  );
  const [selectedLocalAddr, setSelectedLocalAddr] = useState<string>(wallets[0]?.address || '');
  const [customRecipient, setCustomRecipient] = useState<string>('');
  const [inrInput, setInrInput] = useState<string>('10');
  const [utrInput, setUtrInput] = useState<string>('');
  const [payerNameInput, setPayerNameInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<PaymentOrder | null>(null);
  const [myOrders, setMyOrders] = useState<PaymentOrder[]>([]);
  const [loadingMyOrders, setLoadingMyOrders] = useState(false);
  const [qrZoom, setQrZoom] = useState<1 | 1.25 | 1.5>(1.25);
  const [qrFullscreen, setQrFullscreen] = useState(false);

  // Seller form state (Sell XYPH at live coin market price -> UPI or Bank Account)
  const [sellSourceType, setSellSourceType] = useState<'metamask' | 'local'>(
    mmAccount ? 'metamask' : 'local'
  );
  const [sellLocalAddr, setSellLocalAddr] = useState<string>(wallets[0]?.address || '');
  const [sellAmountInput, setSellAmountInput] = useState<string>('');
  const [sellPayoutMethod, setSellPayoutMethod] = useState<SellPayoutMethod>('upi');
  const [sellUpiId, setSellUpiId] = useState<string>('');
  const [sellerNameInput, setSellerNameInput] = useState<string>('');
  const [sellBankAccount, setSellBankAccount] = useState<string>('');
  const [sellBankAccountConfirm, setSellBankAccountConfirm] = useState<string>('');
  const [sellBankIfsc, setSellBankIfsc] = useState<string>('');
  const [sellBankName, setSellBankName] = useState<string>('');
  const [sellAccountHolder, setSellAccountHolder] = useState<string>('');
  const [sellSubmitting, setSellSubmitting] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);
  const [createdSellOrder, setCreatedSellOrder] = useState<SellOrder | null>(null);
  const [mySellOrders, setMySellOrders] = useState<SellOrder[]>([]);
  const [loadingSellOrders, setLoadingSellOrders] = useState(false);

  // Merchant Desk state (token held strictly in React state memory, never localStorage)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [merchantDeskTab, setMerchantDeskTab] = useState<'buy' | 'sell'>('buy');
  const [passcodeInput, setPasscodeInput] = useState<string>('');
  const [confirmPasscodeInput, setConfirmPasscodeInput] = useState<string>('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [merchantOrders, setMerchantOrders] = useState<PaymentOrder[]>([]);
  const [merchantSummary, setMerchantSummary] = useState<PaymentAdminSummary | null>(null);
  const [merchantSellOrders, setMerchantSellOrders] = useState<SellOrder[]>([]);
  const [merchantSellSummary, setMerchantSellSummary] = useState<SellAdminSummary | null>(null);
  const [merchantFilter, setMerchantFilter] = useState<'all' | 'pending' | 'completed' | 'rejected'>(
    'all'
  );
  const [sellDeskFilter, setSellDeskFilter] = useState<'all' | 'pending_payout' | 'paid' | 'refunded'>(
    'all'
  );
  const [payoutUtrByOrder, setPayoutUtrByOrder] = useState<Record<string, string>>({});
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [merchantNotice, setMerchantNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Switch destination cleanly when MetaMask connects
  useEffect(() => {
    if (mmAccount) {
      setDestType('metamask');
      setSellSourceType('metamask');
    }
  }, [mmAccount]);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await xypherApi.getPaymentConfig();
      setConfig(cfg);
    } catch {
      // Ignore transient errors
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const activeRecipient = useMemo(() => {
    if (destType === 'metamask') return mmAccount || customRecipient.trim();
    if (destType === 'local') return selectedLocalAddr || wallets[0]?.address || '';
    return customRecipient.trim();
  }, [destType, mmAccount, selectedLocalAddr, wallets, customRecipient]);

  const recipientCheck = useMemo(() => {
    const trimmed = activeRecipient.trim();
    if (!trimmed) return { valid: false, xyph: null as string | null, evm: null as string | null };
    if (isValidEvmAddress(trimmed)) {
      return { valid: true, xyph: evmToXypherAddress(trimmed), evm: trimmed };
    }
    if (isValidAddress(trimmed)) {
      return { valid: true, xyph: trimmed, evm: xypherToEvmAddress(trimmed) };
    }
    return { valid: false, xyph: null, evm: null };
  }, [activeRecipient]);

  const parsedInr = useMemo(() => {
    const n = Number(inrInput);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Number(n.toFixed(2));
  }, [inrInput]);

  const poolInrReserve = marketTicker?.poolInrReserve ?? INITIAL_POOL_INR_RESERVE;
  const poolXyphReserve = marketTicker?.poolXyphReserve ?? INITIAL_POOL_XYPH_RESERVE;

  const buyAmmQuote = useMemo(
    () => quoteBuyAmm(parsedInr, poolInrReserve, poolXyphReserve),
    [parsedInr, poolInrReserve, poolXyphReserve]
  );
  const rate = marketTicker?.xyphPerInr ?? config?.rateXyphPerInr ?? 100;
  const calculatedXyph = useMemo(
    () => Number(buyAmmQuote.outputAmount.toFixed(2)),
    [buyAmmQuote.outputAmount]
  );

  // Live Market & Sell computations
  const liveSellPriceInr = marketTicker?.sellPriceInr ?? 0.01;
  const mmXyphAddress = useMemo(
    () => (mmAccount ? evmToXypherAddress(mmAccount) : null),
    [mmAccount]
  );
  const effectiveSellMode: 'metamask' | 'local' =
    sellSourceType === 'metamask' && mmAccount ? 'metamask' : 'local';
  const activeSellLocalWallet = useMemo(
    () => wallets.find((w) => w.address === sellLocalAddr) || wallets[0] || null,
    [wallets, sellLocalAddr]
  );
  const activeSellerXyph =
    effectiveSellMode === 'metamask' ? mmXyphAddress : activeSellLocalWallet?.address || null;
  const sellerBalance = activeSellerXyph ? balances[activeSellerXyph] : undefined;
  const sellerSpendableUnits = sellerBalance?.spendable ?? 0;

  const sellParsed = useMemo(() => {
    try {
      const units = sellAmountInput.trim() ? parseXYPHToUnits(sellAmountInput) : 0;
      const xyph = units / UNIT;
      const feeUnits = NETWORK_FEE_UNITS;
      const quote = quoteSellAmm(xyph, poolInrReserve, poolXyphReserve);
      const estInr = quote.outputAmount;
      const sufficient = units > 0 && sellerSpendableUnits >= units + feeUnits;
      return { valid: true, units, xyph, feeUnits, estInr, quote, sufficient };
    } catch {
      return {
        valid: false,
        units: 0,
        xyph: 0,
        feeUnits: NETWORK_FEE_UNITS,
        estInr: 0,
        quote: quoteSellAmm(0, poolInrReserve, poolXyphReserve),
        sufficient: false,
      };
    }
  }, [sellAmountInput, sellerSpendableUnits, poolInrReserve, poolXyphReserve]);

  const upiValid = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9.-]{2,32}$/.test(sellUpiId.trim());
  const cleanBankAcct = sellBankAccount.replace(/\s+/g, '');
  const cleanBankAcctConfirm = sellBankAccountConfirm.replace(/\s+/g, '');
  const cleanIfsc = sellBankIfsc.trim().toUpperCase();
  const bankAcctValid = /^\d{9,18}$/.test(cleanBankAcct);
  const bankAcctMatches = cleanBankAcct.length > 0 && cleanBankAcct === cleanBankAcctConfirm;
  const bankIfscValid = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc);
  const bankNameValid = sellBankName.trim().length >= 2;
  const bankHolderValid = sellAccountHolder.trim().length >= 2;
  const bankFormValid =
    bankAcctValid && bankAcctMatches && bankIfscValid && bankNameValid && bankHolderValid;
  const sellPayoutValid = sellPayoutMethod === 'upi' ? upiValid : bankFormValid;

  const loadBuyerOrders = useCallback(async () => {
    const addrs = new Set<string>();
    if (mmXyphAddress) addrs.add(mmXyphAddress);
    for (const w of wallets) addrs.add(w.address);
    if (recipientCheck.xyph) addrs.add(recipientCheck.xyph);
    if (addrs.size === 0) return;

    setLoadingMyOrders(true);
    try {
      const results = await Promise.all(
        Array.from(addrs).map((a) =>
          xypherApi
            .getPaymentOrdersForAddress(a)
            .then((r) => r.orders)
            .catch(() => [] as PaymentOrder[])
        )
      );
      const dedup = new Map<string, PaymentOrder>();
      for (const list of results) {
        for (const o of list) dedup.set(o.id, o);
      }
      const sorted = Array.from(dedup.values()).sort((a, b) => b.createdAt - a.createdAt);
      setMyOrders(sorted);
    } finally {
      setLoadingMyOrders(false);
    }
  }, [mmXyphAddress, wallets, recipientCheck.xyph]);

  const loadMySellOrders = useCallback(async () => {
    const addrs = new Set<string>();
    if (mmXyphAddress) addrs.add(mmXyphAddress);
    for (const w of wallets) addrs.add(w.address);
    if (addrs.size === 0) return;

    setLoadingSellOrders(true);
    try {
      const results = await Promise.all(
        Array.from(addrs).map((a) =>
          xypherApi
            .getSellOrdersForAddress(a)
            .then((r) => r.orders)
            .catch(() => [] as SellOrder[])
        )
      );
      const dedup = new Map<string, SellOrder>();
      for (const list of results) {
        for (const o of list) dedup.set(o.id, o);
      }
      const sorted = Array.from(dedup.values()).sort((a, b) => b.createdAt - a.createdAt);
      setMySellOrders(sorted);
    } finally {
      setLoadingSellOrders(false);
    }
  }, [mmXyphAddress, wallets]);

  useEffect(() => {
    void loadBuyerOrders();
    void loadMySellOrders();
  }, [loadBuyerOrders, loadMySellOrders]);

  const loadMerchantDesk = useCallback(async () => {
    if (!adminToken) return;
    try {
      const [buyData, sellData] = await Promise.all([
        xypherApi.getMerchantOrders(adminToken),
        xypherApi.getMerchantSellOrders(adminToken),
      ]);
      setMerchantOrders(buyData.orders);
      setMerchantSummary(buyData.summary);
      setMerchantSellOrders(sellData.orders);
      setMerchantSellSummary(sellData.summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load merchant desk';
      if (/sign-in|expired|401/i.test(msg)) {
        setAdminToken(null);
      }
      setMerchantNotice({ kind: 'err', text: msg });
    }
  }, [adminToken]);

  useEffect(() => {
    if (subTab === 'merchant' && adminToken) {
      void loadMerchantDesk();
    }
  }, [subTab, adminToken, loadMerchantDesk]);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuyError(null);
    setCreatedOrder(null);

    if (!recipientCheck.valid || !normalizeToXypherAddress(activeRecipient)) {
      setBuyError('Select or enter a valid MetaMask (0x...) or Xypher wallet address.');
      return;
    }
    const minInr = config?.minInr ?? 1;
    const maxInr = config?.maxInr ?? 10000;
    if (parsedInr < minInr || parsedInr > maxInr) {
      setBuyError(`Amount must be between ₹${minInr} and ₹${maxInr.toLocaleString()}.`);
      return;
    }
    const cleanUtr = utrInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,32}$/.test(cleanUtr)) {
      setBuyError('Enter the 12-digit UPI UTR / Reference Number from your UPI payment receipt.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await xypherApi.createPaymentOrder({
        inrAmount: parsedInr,
        recipientAddress: activeRecipient.trim(),
        payerName: payerNameInput.trim(),
        utr: cleanUtr,
      });
      setCreatedOrder(res.order);
      if (res.market) onMarketUpdated(res.market);
      if (res.order.status === 'completed') {
        onOrderSettled(res.order);
      }
      setUtrInput('');
      await loadBuyerOrders();
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : 'Could not submit payment order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSellPercent = (pct: number) => {
    const feeUnits = NETWORK_FEE_UNITS;
    const avail = Math.max(0, sellerSpendableUnits - feeUnits);
    const chosen = Math.floor((avail * pct) / 100);
    if (chosen <= 0) {
      setSellAmountInput('');
      return;
    }
    setSellAmountInput((chosen / UNIT).toFixed(4).replace(/\.?0+$/, ''));
    setSellError(null);
  };

  const handleSellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSellError(null);
    setCreatedSellOrder(null);

    const minSell = config?.minSellXyph ?? 1;
    if (!sellParsed.valid || sellParsed.xyph < minSell) {
      setSellError(`Enter at least ${minSell} ${SYMBOL} to sell at live market price.`);
      return;
    }
    if (!sellParsed.sufficient) {
      setSellError(
        `Insufficient spendable ${SYMBOL} balance (requires sell amount + ${NETWORK_FEE_XYPH} ${SYMBOL} ${NETWORK_NAME} fee).`
      );
      return;
    }
    if (sellPayoutMethod === 'upi') {
      if (!upiValid) {
        setSellError('Enter a valid UPI ID (e.g. yourname@okaxis, phone@ybl, or name@yesfam).');
        return;
      }
    } else {
      if (!bankHolderValid) {
        setSellError('Enter the bank account holder name.');
        return;
      }
      if (!bankAcctValid) {
        setSellError('Enter a valid bank account number (9 to 18 digits).');
        return;
      }
      if (!bankAcctMatches) {
        setSellError('Bank account number and confirmation do not match.');
        return;
      }
      if (!bankIfscValid) {
        setSellError('Enter a valid 11-character IFSC code (e.g. SBIN0001234, HDFC0000123).');
        return;
      }
      if (!bankNameValid) {
        setSellError('Enter your bank name (e.g. State Bank of India, HDFC Bank).');
        return;
      }
    }

    const treasuryXyph = marketTicker?.treasuryXyphAddress || config?.treasuryXyphAddress;
    const treasuryEvm = marketTicker?.treasuryEvmAddress || config?.treasuryEvmAddress;
    if (!treasuryXyph || !treasuryEvm) {
      setSellError('Treasury escrow address is still loading; please try again in a moment.');
      return;
    }

    setSellSubmitting(true);
    try {
      let depositTxid = '';

      if (effectiveSellMode === 'metamask') {
        if (!mmAccount) throw new Error('Connect MetaMask before selling from MetaMask.');
        depositTxid = await sendXyphViaMetaMask({
          fromEvm: mmAccount,
          toEvm: treasuryEvm,
          amountUnits: sellParsed.units,
          publicBaseUrl,
        });
      } else {
        if (!activeSellLocalWallet) {
          throw new Error('Select a local wallet to sell from.');
        }
        const freshAddr = await xypherApi.getAddress(activeSellLocalWallet.address);
        const coins = freshAddr.utxos
          .filter((u) => u.spendable)
          .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));
        const utxoSum = coins.reduce((acc, c) => acc + c.value, 0);
        const need = sellParsed.units + sellParsed.feeUnits;
        const priv = wifToKey(activeSellLocalWallet.wif);

        if (utxoSum >= need && freshAddr.spendable >= need && utxoSum <= freshAddr.spendable) {
          const tx = buildSignedTx(
            priv,
            coins,
            treasuryXyph,
            sellParsed.units,
            sellParsed.feeUnits
          );
          const sub = await xypherApi.submitTx(tx);
          depositTxid = sub.txid;
        } else {
          const { nonce } = await xypherApi.getBridgeNonce(activeSellLocalWallet.address);
          const timestamp = Math.floor(Date.now() / 1000);
          const payload = `xypher-bridge-v1|${activeSellLocalWallet.address}|${treasuryXyph}|${sellParsed.units}|${sellParsed.feeUnits}|${nonce}|${timestamp}`;
          const digest = sha256(utf8ToBytes(payload));
          const sigHex = bytesToHex(signDigest(priv, digest));
          const sub = await xypherApi.submitBridgeTransfer({
            fromXyph: activeSellLocalWallet.address,
            toAddress: treasuryXyph,
            amountUnits: sellParsed.units,
            feeUnits: sellParsed.feeUnits,
            timestamp,
            pubHex: activeSellLocalWallet.pubHex,
            sigHex,
          });
          depositTxid = sub.txid;
        }
      }

      const sellRes = await xypherApi.createSellOrder(
        sellPayoutMethod === 'bank'
          ? {
              depositTxid,
              payoutMethod: 'bank',
              bankAccountNumber: cleanBankAcct,
              bankIfsc: cleanIfsc,
              bankName: sellBankName.trim(),
              accountHolderName: sellAccountHolder.trim(),
              sellerName: sellAccountHolder.trim(),
            }
          : {
              depositTxid,
              payoutMethod: 'upi',
              upiId: sellUpiId.trim(),
              sellerName: sellerNameInput.trim(),
            }
      );

      setCreatedSellOrder(sellRes.order);
      setSellAmountInput('');
      if (sellRes.market) {
        onMarketUpdated(sellRes.market);
      }
      onSellSubmitted(sellRes.order);
      await loadMySellOrders();
    } catch (err) {
      setSellError(formatWalletError(err));
    } finally {
      setSellSubmitting(false);
    }
  };

  const handleMerchantSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (passcodeInput.trim().length < 6) {
      setAuthError('Passcode must be at least 6 characters.');
      return;
    }
    if (passcodeInput.trim() !== confirmPasscodeInput.trim()) {
      setAuthError('Passcodes do not match.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await xypherApi.setupMerchantAdmin(passcodeInput.trim());
      setAdminToken(res.token);
      setPasscodeInput('');
      setConfirmPasscodeInput('');
      await loadConfig();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleMerchantLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await xypherApi.loginMerchantAdmin(passcodeInput.trim());
      setAdminToken(res.token);
      setPasscodeInput('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleApproveOrder = async (orderId: string) => {
    if (!adminToken) return;
    setActionOrderId(orderId);
    setMerchantNotice(null);
    try {
      const res = await xypherApi.approveMerchantOrder(adminToken, orderId);
      setMerchantNotice({
        kind: 'ok',
        text: `Verified ${res.order.id}: credited ${res.order.xyphAmount.toLocaleString()} ${SYMBOL} to ${truncateHash(
          res.order.recipientEvm,
          10,
          6
        )} (Block #${res.order.blockHeight ?? '?'}).`,
      });
      if (res.market) onMarketUpdated(res.market);
      onOrderSettled(res.order);
      await Promise.all([loadMerchantDesk(), loadBuyerOrders()]);
    } catch (err) {
      setMerchantNotice({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to credit order',
      });
    } finally {
      setActionOrderId(null);
    }
  };

  const handleRejectOrder = async (orderId: string) => {
    if (!adminToken) return;
    setActionOrderId(orderId);
    setMerchantNotice(null);
    try {
      const res = await xypherApi.rejectMerchantOrder(
        adminToken,
        orderId,
        'UPI payment not confirmed for submitted UTR'
      );
      if (res.market) onMarketUpdated(res.market);
      setMerchantNotice({
        kind: 'ok',
        text: `Marked order ${res.order.id} as rejected.`,
      });
      await Promise.all([loadMerchantDesk(), loadBuyerOrders()]);
    } catch (err) {
      setMerchantNotice({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to reject order',
      });
    } finally {
      setActionOrderId(null);
    }
  };

  const handleMarkSellPaid = async (orderId: string) => {
    if (!adminToken) return;
    const payoutUtr = (payoutUtrByOrder[orderId] || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(payoutUtr)) {
      setMerchantNotice({
        kind: 'err',
        text: 'Enter the UPI / IMPS / NEFT Reference UTR (6–32 letters/digits) before marking paid.',
      });
      return;
    }
    setActionOrderId(orderId);
    setMerchantNotice(null);
    try {
      const res = await xypherApi.markSellOrderPaid(adminToken, orderId, payoutUtr);
      const destText =
        res.order.payoutMethod === 'bank'
          ? `${res.order.bankName || 'Bank'} (${res.order.bankAccountMasked || res.order.bankIfsc})`
          : res.order.upiId;
      setMerchantNotice({
        kind: 'ok',
        text: `Marked ${res.order.id} paid (₹${res.order.inrPayout.toFixed(2)} sent to ${destText}, Ref ${res.order.payoutUtr}).`,
      });
      await Promise.all([loadMerchantDesk(), loadMySellOrders()]);
    } catch (err) {
      setMerchantNotice({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to mark sell order paid',
      });
    } finally {
      setActionOrderId(null);
    }
  };

  const handleRefundSell = async (orderId: string) => {
    if (!adminToken) return;
    setActionOrderId(orderId);
    setMerchantNotice(null);
    try {
      const res = await xypherApi.refundSellOrder(
        adminToken,
        orderId,
        'Merchant refunded XYPH back to seller wallet'
      );
      if (res.market) onMarketUpdated(res.market);
      setMerchantNotice({
        kind: 'ok',
        text: `Refunded ${res.order.xyphAmount.toLocaleString()} ${SYMBOL} back to ${truncateHash(
          res.order.sellerEvm,
          10,
          6
        )} on-chain.`,
      });
      await Promise.all([loadMerchantDesk(), loadMySellOrders()]);
    } catch (err) {
      setMerchantNotice({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to refund XYPH',
      });
    } finally {
      setActionOrderId(null);
    }
  };

  const upiDeepLink = useMemo(() => {
    const upiId = config?.upiId || 'aryabiswas@yesfam';
    const name = config?.merchantName || 'Arya Biswas';
    const amount = parsedInr >= 1 ? parsedInr.toFixed(2) : '1.00';
    const note = `Buy ${calculatedXyph || 100} ${SYMBOL}`;
    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
      name
    )}&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent(note)}`;
  }, [config, parsedInr, calculatedXyph]);

  const metamaskMobileDeepLink = useMemo(() => {
    const origin =
      publicBaseUrl && /^https?:\/\//.test(publicBaseUrl)
        ? publicBaseUrl.replace(/\/$/, '')
        : typeof window !== 'undefined'
        ? window.location.origin
        : '';
    const stripped = origin.replace(/^https?:\/\//, '');
    return stripped ? `https://metamask.app.link/dapp/${stripped}/?tab=buy` : null;
  }, [publicBaseUrl]);

  const phantomMobileDeepLink = useMemo(
    () => getPhantomMobileDeepLink(publicBaseUrl),
    [publicBaseUrl]
  );

  const isOnXypherChain = mmChainId?.toLowerCase() === XYPHER_CHAIN_ID_HEX.toLowerCase();

  const filteredMerchantOrders = useMemo(() => {
    if (merchantFilter === 'all') return merchantOrders;
    return merchantOrders.filter((o) => o.status === merchantFilter);
  }, [merchantOrders, merchantFilter]);

  const filteredSellOrders = useMemo(() => {
    if (sellDeskFilter === 'all') return merchantSellOrders;
    return merchantSellOrders.filter((o) => o.status === sellDeskFilter);
  }, [merchantSellOrders, sellDeskFilter]);

  const isUp = (marketTicker?.change24hPercent ?? 0) >= 0;

  return (
    <div className="space-y-6">
      {/* Live XYPH Market Price Header & 24h KPI Strip */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#222A38] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <img
              src={XYPHER_COIN_ICON_PATH}
              alt="Xypher (XYPH)"
              className="w-11 h-11 rounded-full object-cover ring-1 ring-white/15 shrink-0"
            />
            <div>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 className="text-base font-semibold text-[#E6EDF3]">
                  {SYMBOL} / INR Live Market
                </h2>
                <span className="font-mono text-2xl font-semibold text-[#E6EDF3] tabular-nums">
                  ₹{(marketTicker?.priceInr ?? 0.01).toFixed(5)}
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-mono text-xs font-medium tabular-nums ${
                    isUp ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {isUp ? (
                    <TrendingUp className="w-3.5 h-3.5" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5" />
                  )}
                  {isUp ? '+' : ''}
                  {(marketTicker?.change24hPercent ?? 0).toFixed(2)}%
                </span>
              </div>
              <p className="text-xs text-[#8B98A8] font-mono tabular-nums mt-0.5">
                ₹1 ≈ {(marketTicker?.xyphPerInr ?? 100).toFixed(2)} {SYMBOL} · $
                {(marketTicker?.priceUsd ?? 0.000119).toFixed(6)} USD · Driven 100% by Real Buys &amp; Sells
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="inline-flex items-center gap-1 p-1 bg-[#0B0E14] border border-[#1E2533] rounded-md shrink-0 self-start lg:self-auto">
            <button
              type="button"
              onClick={() => setSubTab('buy')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                subTab === 'buy'
                  ? 'bg-[#1D2534] text-emerald-400'
                  : 'text-[#8B98A8] hover:text-[#E6EDF3]'
              }`}
            >
              Buy {SYMBOL}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('sell')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                subTab === 'sell'
                  ? 'bg-[#1D2534] text-amber-400'
                  : 'text-[#8B98A8] hover:text-[#E6EDF3]'
              }`}
            >
              Sell {SYMBOL} (Live Price)
            </button>
            {onOpenCryptoExchange && (
              <button
                type="button"
                onClick={onOpenCryptoExchange}
                className="px-3.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap text-sky-300 hover:bg-[#1D2534] hover:text-sky-200"
              >
                Buy / Swap with Crypto (9 Coins)
              </button>
            )}
            <button
              type="button"
              onClick={() => setSubTab('merchant')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                subTab === 'merchant'
                  ? 'bg-[#1D2534] text-[#E6EDF3]'
                  : 'text-[#8B98A8] hover:text-[#E6EDF3]'
              }`}
            >
              Merchant Desk
            </button>
          </div>
        </div>

        {/* 24h Market KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#1D2432] text-xs">
          <div className="p-3.5 px-5">
            <div className="text-[#8B98A8]">24h High</div>
            <div className="mt-1 font-mono font-semibold text-[#E6EDF3] tabular-nums">
              ₹{(marketTicker?.high24hInr ?? 0.01).toFixed(5)}
            </div>
          </div>
          <div className="p-3.5 px-5">
            <div className="text-[#8B98A8]">24h Low</div>
            <div className="mt-1 font-mono font-semibold text-[#E6EDF3] tabular-nums">
              ₹{(marketTicker?.low24hInr ?? 0.01).toFixed(5)}
            </div>
          </div>
          <div className="p-3.5 px-5">
            <div className="text-[#8B98A8]">24h Total Volume</div>
            <div className="mt-1 font-mono font-semibold text-[#E6EDF3] tabular-nums">
              {(marketTicker?.volume24hXyph ?? 0).toLocaleString()} {SYMBOL}
            </div>
            <div className="text-[11px] font-mono text-[#6B7788] tabular-nums">
              ₹{(marketTicker?.volume24hInr ?? 0).toFixed(2)}
            </div>
          </div>
          <div className="p-3.5 px-5">
            <div className="text-[#8B98A8]">Live Market Cap</div>
            <div className="mt-1 font-mono font-semibold text-amber-400 tabular-nums">
              ₹{(marketTicker?.marketCapInr ?? 0).toLocaleString()}
            </div>
            <div className="text-[11px] font-mono text-[#6B7788] tabular-nums">
              {(marketTicker?.circulatingSupplyXyph ?? 0).toLocaleString()} {SYMBOL}
            </div>
          </div>
        </div>
      </div>

      {/* Real-Time Buy/Sell Price Curve, Pressure Bar & Live Trade Feed */}
      <LiveMarketPanel
        marketTicker={marketTicker}
        streamConnected={streamConnected}
        onInspectTx={onInspectTx}
      />

      {subTab === 'buy' ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Buy Order Form */}
            <form
              onSubmit={handleSubmitOrder}
              className="lg:col-span-7 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5"
            >
              {/* MetaMask & Phantom Quick Connect Strip */}
              <div className="p-3.5 rounded-md bg-[#0B0E14] border border-[#1E2533] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-[#E6EDF3]">
                    Buying directly into MetaMask or Phantom Wallet
                  </p>
                  <p className="text-[11px] text-[#8B98A8]">
                    {mmAccount
                      ? `${activeWalletLabel} Connected: ${truncateHash(mmAccount, 8, 6)}${
                          isOnXypherChain
                            ? ' · Xypher Network active'
                            : ' · Add Xypher Network to view XYPH balance'
                        }`
                      : 'Connect MetaMask or Phantom, or paste your 0x... address below so purchased XYPH credits straight to your wallet.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void onWatchXyphToken()}
                    disabled={mmBusy}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded hover:border-amber-500/50 hover:bg-[#232C3D] whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    <img
                      src={XYPHER_COIN_ICON_PATH}
                      alt="XYPH"
                      className="w-3.5 h-3.5 rounded-full object-cover shrink-0"
                    />
                    Show {SYMBOL} Picture
                  </button>
                  <button
                    type="button"
                    onClick={() => void onAddXypherToMetaMask()}
                    disabled={mmBusy}
                    className="px-2.5 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    Add {SYMBOL} Network
                  </button>
                  {(!mmAccount || evmWalletName !== 'Phantom') && (
                    <button
                      type="button"
                      onClick={() => void onConnectPhantom()}
                      disabled={mmBusy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 rounded hover:bg-violet-500 whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      {mmBusy ? 'Connecting...' : 'Connect Phantom'}
                    </button>
                  )}
                  {(!mmAccount || evmWalletName === 'Phantom') && (
                    <button
                      type="button"
                      onClick={() => void onConnectMetaMask()}
                      disabled={mmBusy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {mmBusy ? 'Connecting...' : 'Connect MetaMask'}
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-md border border-[#222A38] bg-[#0E131D] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#9AA6B6]">
                <span>
                  Buying {SYMBOL} here via UPI works in India and all regions — bypassing MetaMask&apos;s region-locked built-in Buy button. Coins arrive directly in your connected MetaMask (0x) or local wallet on XYPH Network.
                </span>
                {mmAccount && !isOnXypherChain && (
                  <button
                    type="button"
                    onClick={() => void onAddXypherToMetaMask()}
                    disabled={mmBusy}
                    className="px-2.5 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded hover:bg-amber-500/20 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    Switch MetaMask to XYPH Network
                  </button>
                )}
              </div>

              {mmNotice && (
                <div className="p-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300">
                  {mmNotice}
                </div>
              )}

              {mmError && (
                <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
                  {mmError}
                </div>
              )}

              {/* Destination Wallet Selector */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[#9AA6B6]">
                    Receive {SYMBOL} Into Wallet
                  </label>
                  <div className="inline-flex items-center gap-1 p-0.5 bg-[#0B0E14] border border-[#1E2533] rounded text-[11px]">
                    <button
                      type="button"
                      onClick={() => setDestType('metamask')}
                      className={`px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                        destType === 'metamask'
                          ? 'bg-[#1D2534] text-amber-400 font-medium'
                          : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                      }`}
                    >
                      {mmAccount ? `${activeWalletLabel} 0x` : 'MetaMask / Phantom'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestType('local')}
                      className={`px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                        destType === 'local'
                          ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                          : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                      }`}
                    >
                      Local Wallet
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestType('custom')}
                      className={`px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                        destType === 'custom'
                          ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                          : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                      }`}
                    >
                      Paste Address
                    </button>
                  </div>
                </div>

                {destType === 'metamask' ? (
                  mmAccount ? (
                    <div className="px-3 py-2.5 bg-[#0B0E14] border border-emerald-500/30 rounded-md font-mono text-xs text-[#E6EDF3] break-all">
                      {mmAccount}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={customRecipient}
                      onChange={(e) => setCustomRecipient(e.target.value)}
                      placeholder="Paste your MetaMask or Phantom 0x... address (or click Connect above)"
                      spellCheck={false}
                      className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                    />
                  )
                ) : destType === 'local' ? (
                  <select
                    value={selectedLocalAddr}
                    onChange={(e) => setSelectedLocalAddr(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  >
                    {wallets.map((w) => (
                      <option key={w.id} value={w.address}>
                        {w.label} · {truncateHash(w.address, 10, 6)} ({truncateHash(w.evmAddress, 6, 4)})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={customRecipient}
                    onChange={(e) => setCustomRecipient(e.target.value)}
                    placeholder="Paste any MetaMask 0x... or Xypher Base58Check address"
                    spellCheck={false}
                    className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  />
                )}

                {activeRecipient.trim() && (
                  <p
                    className={`text-[11px] font-mono ${
                      recipientCheck.valid ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {recipientCheck.valid && recipientCheck.evm && recipientCheck.xyph
                      ? `Verified · Credits both MetaMask (${truncateHash(
                          recipientCheck.evm,
                          8,
                          6
                        )}) & Xypher (${truncateHash(recipientCheck.xyph, 8, 6)})`
                      : 'Invalid wallet address format'}
                  </p>
                )}
              </div>

              {/* Amount in INR & Live Market AMM Conversion */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#9AA6B6]">
                    Amount to Pay (INR ₹)
                  </label>
                  <span className="text-xs font-mono text-amber-400 tabular-nums">
                    Live Spot: ₹1 ≈ {rate.toFixed(2)} {SYMBOL}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PRESET_INR.map((amt) => {
                    const presetOut = quoteBuyAmm(amt, poolInrReserve, poolXyphReserve).outputAmount;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setInrInput(String(amt))}
                        className={`py-2 px-3 rounded-md border text-xs font-mono transition-colors cursor-pointer tabular-nums ${
                          parsedInr === amt
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300 font-semibold'
                            : 'border-[#222A38] bg-[#0B0E14] text-[#C9D3DF] hover:border-[#344156]'
                        }`}
                      >
                        ₹{amt} → {Math.round(presetOut).toLocaleString()}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <IndianRupee className="w-3.5 h-3.5 text-[#8B98A8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="number"
                      min={config?.minInr ?? 1}
                      max={config?.maxInr ?? 10000}
                      step="1"
                      value={inrInput}
                      onChange={(e) => setInrInput(e.target.value)}
                      placeholder="Enter INR amount"
                      className="w-full pl-8 pr-3 py-2.5 text-sm font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
                      required
                    />
                  </div>
                  <div className="px-3.5 py-2.5 rounded-md bg-[#0B0E14] border border-[#222A38] flex items-center justify-between">
                    <span className="text-xs text-[#8B98A8]">You Receive</span>
                    <span className="font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                      {calculatedXyph.toLocaleString()} {SYMBOL}
                    </span>
                  </div>
                </div>

                {parsedInr > 0 && (
                  <div className="px-3.5 py-2 rounded-md bg-[#0B0E14] border border-emerald-500/20 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                    <span className="text-[#8B98A8]">
                      Live Buy Impact (instant on-chain credit):
                    </span>
                    <span className="text-emerald-400">
                      Price moves UP +{buyAmmQuote.priceImpactPercent.toFixed(2)}% (₹
                      {buyAmmQuote.spotBeforeInr.toFixed(5)} → ₹{buyAmmQuote.spotAfterInr.toFixed(5)})
                    </span>
                  </div>
                )}
              </div>

              {/* Step 2: Submit UPI UTR / Reference */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#1D2432]">
                <div>
                  <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                    UPI UTR / Reference Number *
                  </label>
                  <input
                    type="text"
                    value={utrInput}
                    onChange={(e) => setUtrInput(e.target.value)}
                    placeholder="e.g. 432619847512"
                    spellCheck={false}
                    className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                    Your Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={payerNameInput}
                    onChange={(e) => setPayerNameInput(e.target.value)}
                    placeholder="Name shown in UPI app"
                    className="w-full px-3 py-2.5 text-xs bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {buyError && (
                <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
                  {buyError}
                </div>
              )}

              {createdOrder && (
                <div className="p-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {createdOrder.status === 'completed'
                      ? `Payment Confirmed · ${createdOrder.xyphAmount.toLocaleString()} ${SYMBOL} Credited Automatically to Your Wallet!`
                      : `Order ${createdOrder.id} Submitted for Verification`}
                  </div>
                  <p className="text-xs text-[#C9D3DF]">
                    Paid <span className="font-mono">₹{createdOrder.inrAmount}</span> (UTR{' '}
                    <span className="font-mono text-[#E6EDF3]">{createdOrder.utr}</span>) for{' '}
                    <span className="font-mono text-emerald-400 font-semibold">
                      {createdOrder.xyphAmount.toLocaleString()} {SYMBOL}
                    </span>
                    {createdOrder.status === 'completed' ? (
                      <>
                        {' '}
                        confirmed on-chain
                        {createdOrder.blockHeight !== null ? ` in Block #${createdOrder.blockHeight.toLocaleString()}` : ''}{' '}
                        and credited directly to your wallet ({truncateHash(createdOrder.recipientEvm, 8, 6)}).
                      </>
                    ) : (
                      <>
                        . Once verified on the Merchant Desk, your {SYMBOL} will credit directly to your wallet.
                      </>
                    )}
                  </p>
                  {createdOrder.txid && (
                    <div className="pt-0.5 flex flex-wrap items-center gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => onInspectTx(createdOrder.txid!)}
                        className="font-mono text-amber-400 hover:underline cursor-pointer"
                      >
                        View On-Chain TX: {truncateHash(createdOrder.txid, 10, 8)}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex items-center justify-between gap-4 border-t border-[#1D2432]">
                <span className="text-xs text-[#8B98A8]">
                  Scan QR &rarr; Pay ₹{parsedInr || 1} &rarr; Submit UTR &rarr; Coins credit automatically
                </span>
                <button
                  type="submit"
                  disabled={submitting || !recipientCheck.valid || parsedInr < 1}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  {submitting
                    ? 'Crediting Wallet...'
                    : `Confirm ₹${parsedInr || 0} & Receive ${calculatedXyph.toLocaleString()} ${SYMBOL}`}
                </button>
              </div>
            </form>

            {/* Right: Zoomed-In Official Uploaded UPI QR Code Card */}
            <div className="lg:col-span-5 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#E6EDF3]">Official UPI Payment QR</h3>
                  <p className="text-xs text-[#8B98A8] mt-0.5">
                    Scan with FamApp, GPay, PhonePe, Paytm, or BHIM
                  </p>
                </div>
                <span className="text-sm font-mono font-semibold text-amber-400 tabular-nums whitespace-nowrap">
                  ₹{parsedInr || 1}
                </span>
              </div>

              {/* Zoom Toolbar */}
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <div className="inline-flex items-center gap-1 p-0.5 rounded bg-[#0B0E14] border border-[#1E2533]">
                  <button
                    type="button"
                    onClick={() => setQrZoom(1)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                      qrZoom === 1
                        ? 'bg-[#1D2534] text-amber-400 font-semibold'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                    title="Normal QR view"
                  >
                    <ZoomOut className="w-3 h-3" />
                    1x
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrZoom(1.25)}
                    className={`px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                      qrZoom === 1.25
                        ? 'bg-[#1D2534] text-amber-400 font-semibold'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    1.25x Zoom
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrZoom(1.5)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                      qrZoom === 1.5
                        ? 'bg-[#1D2534] text-amber-400 font-semibold'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    <ZoomIn className="w-3 h-3" />
                    1.5x Max
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setQrFullscreen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded hover:bg-amber-500/20 cursor-pointer whitespace-nowrap"
                >
                  <Maximize2 className="w-3 h-3" />
                  Full Screen QR
                </button>
              </div>

              <button
                type="button"
                onClick={() => setQrFullscreen(true)}
                title="Click to open Full Screen Zoom QR"
                className="w-full rounded-lg overflow-hidden border-2 border-amber-500/40 bg-white flex items-center justify-center p-2 cursor-zoom-in group"
              >
                <div className="w-full max-w-[380px] aspect-square overflow-hidden flex items-center justify-center rounded-md">
                  <img
                    src={
                      config?.qrImagePath ||
                      '/assets/aistudio/WhatsApp_Image_2026-11-21_at_4.30.20_PM_00d00dfc.jpeg'
                    }
                    alt="Arya Biswas UPI QR Code (aryabiswas@yesfam)"
                    className={`w-full h-full object-contain transition-transform duration-200 ${
                      qrZoom === 1.5
                        ? 'scale-[1.45]'
                        : qrZoom === 1.25
                        ? 'scale-[1.22]'
                        : 'scale-100'
                    }`}
                  />
                </div>
              </button>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between py-2 px-3 rounded-md bg-[#0B0E14] border border-[#1E2533]">
                  <span className="text-[#8B98A8]">Merchant Name</span>
                  <span className="font-medium text-[#E6EDF3]">
                    {config?.merchantName || 'Arya Biswas'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-2 px-3 rounded-md bg-[#0B0E14] border border-[#1E2533] gap-2">
                  <span className="text-[#8B98A8] shrink-0">UPI ID</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[#E6EDF3] truncate">
                      {config?.upiId || 'aryabiswas@yesfam'}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText(config?.upiId || 'aryabiswas@yesfam', 'upi-id')}
                      className="text-[#8B98A8] hover:text-amber-400 cursor-pointer shrink-0"
                      title="Copy UPI ID"
                    >
                      {copiedId === 'upi-id' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <a
                  href={upiDeepLink}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  Pay ₹{parsedInr || 1} via UPI App
                </a>

                {metamaskMobileDeepLink && (
                  <a
                    href={metamaskMobileDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                    Open in MetaMask Mobile Browser
                  </a>
                )}

                {phantomMobileDeepLink && (
                  <a
                    href={phantomMobileDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:border-violet-400/50 hover:bg-[#232C3D] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-violet-400" />
                    Open in Phantom Mobile Browser
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Buyer's Submitted Orders */}
          <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#222A38] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#E6EDF3]">Your UPI Buy Orders</h3>
                <p className="text-xs text-[#8B98A8] mt-0.5">
                  Live status of orders linked to your MetaMask and local browser wallets
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadBuyerOrders()}
                disabled={loadingMyOrders}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingMyOrders ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {myOrders.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8B98A8]">
                No UPI purchase orders submitted for your wallet yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#222A38] text-[#8B98A8]">
                      <th className="py-3 px-5">Order / UTR</th>
                      <th className="py-3 px-4">Receiving Wallet</th>
                      <th className="py-3 px-4 text-right">Paid (INR)</th>
                      <th className="py-3 px-4 text-right">Payout ({SYMBOL})</th>
                      <th className="py-3 px-5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D2432]">
                    {myOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-[#161C27]">
                        <td className="py-3 px-5 font-mono">
                          <div className="text-[#E6EDF3]">{o.id}</div>
                          <div className="text-[11px] text-[#8B98A8]">UTR: {o.utr}</div>
                        </td>
                        <td className="py-3 px-4 font-mono">
                          <div className="text-[#C9D3DF]">{truncateHash(o.recipientEvm, 10, 6)}</div>
                          <div className="text-[11px] text-[#6B7788]">
                            {truncateHash(o.recipientXyph, 10, 6)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-[#E6EDF3] tabular-nums">
                          ₹{o.inrAmount.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-400 tabular-nums">
                          {o.xyphAmount.toLocaleString()} {SYMBOL}
                        </td>
                        <td className="py-3 px-5 text-right">
                          {o.status === 'completed' ? (
                            <div className="space-y-0.5">
                              <span className="text-emerald-400 font-medium">Credited</span>
                              {o.txid && (
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => onInspectTx(o.txid!)}
                                    className="font-mono text-[11px] text-amber-400 hover:underline cursor-pointer"
                                  >
                                    {truncateHash(o.txid, 8, 6)}
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : o.status === 'rejected' ? (
                            <span className="text-red-400 font-medium">Rejected</span>
                          ) : (
                            <span className="text-amber-400 font-medium">Pending Verification</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : subTab === 'sell' ? (
        /* SELL XYPH AT LIVE COIN MARKET PRICE -> UPI INR PAYOUT */
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={handleSellSubmit}
              className="lg:col-span-7 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#E6EDF3]">
                    Sell {SYMBOL} &amp; Transfer INR to Bank Account or UPI
                  </h3>
                  <p className="text-xs text-[#8B98A8] mt-0.5">
                    Sign a real on-chain transfer on {NETWORK_NAME} ({NETWORK_FEE_XYPH} {SYMBOL} network fee) to lock live price and transfer INR to your Bank Account (IMPS/NEFT) or UPI ID.
                  </p>
                </div>
                <div className="inline-flex items-center gap-1 p-0.5 bg-[#0B0E14] border border-[#1E2533] rounded text-[11px] shrink-0">
                  <button
                    type="button"
                    onClick={() => setSellSourceType('metamask')}
                    className={`px-2.5 py-1 rounded cursor-pointer whitespace-nowrap ${
                      effectiveSellMode === 'metamask'
                        ? 'bg-[#1D2534] text-amber-400 font-medium'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    {mmAccount ? activeWalletLabel : 'MetaMask / Phantom'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellSourceType('local')}
                    className={`px-2.5 py-1 rounded cursor-pointer whitespace-nowrap ${
                      effectiveSellMode === 'local'
                        ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    Local Wallet
                  </button>
                </div>
              </div>

              {/* Source Wallet Selector & Balance */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#9AA6B6] font-medium">Sell From Wallet</span>
                  <span className="font-mono text-emerald-400 tabular-nums">
                    Available: {formatXYPH(sellerSpendableUnits, 4)} {SYMBOL} (≈ ₹
                    {((sellerSpendableUnits / UNIT) * liveSellPriceInr).toFixed(2)})
                  </span>
                </div>

                {effectiveSellMode === 'metamask' ? (
                  mmAccount ? (
                    <div className="px-3 py-2.5 bg-[#0B0E14] border border-emerald-500/30 rounded-md font-mono text-xs text-[#E6EDF3] break-all">
                      {mmAccount}
                    </div>
                  ) : (
                    <div className="p-3 bg-[#0B0E14] border border-[#222A38] rounded-md flex flex-wrap items-center justify-between gap-2.5">
                      <span className="text-xs text-[#8B98A8]">
                        Connect MetaMask or Phantom to sell directly from your Web3 wallet.
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void onConnectPhantom()}
                          disabled={mmBusy}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 rounded hover:bg-violet-500 whitespace-nowrap cursor-pointer disabled:opacity-50"
                        >
                          Connect Phantom
                        </button>
                        <button
                          type="button"
                          onClick={() => void onConnectMetaMask()}
                          disabled={mmBusy}
                          className="px-3 py-1.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 whitespace-nowrap cursor-pointer disabled:opacity-50"
                        >
                          Connect MetaMask
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <select
                    value={activeSellLocalWallet?.address || ''}
                    onChange={(e) => setSellLocalAddr(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  >
                    {wallets.map((w) => (
                      <option key={w.id} value={w.address}>
                        {w.label} · {formatXYPH(balances[w.address]?.spendable ?? 0, 4)} {SYMBOL} (
                        {truncateHash(w.address, 8, 6)})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Amount to Sell + Percentage Presets */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-[#9AA6B6] font-medium">Amount to Sell ({SYMBOL})</label>
                  <span className="font-mono text-amber-400 tabular-nums">
                    Live Rate: 1 {SYMBOL} = ₹{liveSellPriceInr.toFixed(5)}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {SELL_PERCENT_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleSellPercent(pct)}
                      className="py-1.5 px-2.5 rounded-md border border-[#222A38] bg-[#0B0E14] text-xs font-mono text-[#C9D3DF] hover:border-amber-500/60 hover:text-amber-300 transition-colors cursor-pointer"
                    >
                      {pct === 100 ? 'MAX' : `${pct}%`}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={sellAmountInput}
                      onChange={(e) => setSellAmountInput(e.target.value)}
                      placeholder={`Min ${config?.minSellXyph ?? 1} ${SYMBOL}`}
                      className="w-full px-3.5 pr-16 py-2.5 text-sm font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
                      required
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-[#8B98A8]">
                      {SYMBOL}
                    </span>
                  </div>
                  <div className="px-3.5 py-2.5 rounded-md bg-[#0B0E14] border border-[#222A38] flex items-center justify-between">
                    <span className="text-xs text-[#8B98A8]">Live AMM Payout</span>
                    <span className="font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                      ₹{sellParsed.estInr.toFixed(2)}
                    </span>
                  </div>
                </div>

                {sellParsed.xyph > 0 && (
                  <div className="px-3.5 py-2 rounded-md bg-[#0B0E14] border border-red-500/20 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                    <span className="text-[#8B98A8]">
                      Live Sell Impact (instant on-chain):
                    </span>
                    <span className="text-red-400">
                      Price moves DOWN {sellParsed.quote.priceImpactPercent.toFixed(2)}% (₹
                      {sellParsed.quote.spotBeforeInr.toFixed(5)} → ₹
                      {sellParsed.quote.spotAfterInr.toFixed(5)})
                    </span>
                  </div>
                )}
              </div>

              {/* Seller Payout Destination: UPI vs Bank Account Transfer */}
              <div className="space-y-4 pt-3 border-t border-[#1D2432]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[#C9D3DF]">
                    Receive INR Payout Via
                  </label>
                  <div className="inline-flex items-center gap-1 p-0.5 bg-[#0B0E14] border border-[#1E2533] rounded text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSellPayoutMethod('upi');
                        setSellError(null);
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded cursor-pointer whitespace-nowrap ${
                        sellPayoutMethod === 'upi'
                          ? 'bg-[#1D2534] text-amber-400 font-semibold'
                          : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      UPI ID
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSellPayoutMethod('bank');
                        setSellError(null);
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded cursor-pointer whitespace-nowrap ${
                        sellPayoutMethod === 'bank'
                          ? 'bg-[#1D2534] text-emerald-400 font-semibold'
                          : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                      }`}
                    >
                      <Building2 className="w-3.5 h-3.5" />
                      Bank Account (IMPS / NEFT)
                    </button>
                  </div>
                </div>

                {sellPayoutMethod === 'upi' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                        Your UPI ID (to Receive INR) *
                      </label>
                      <input
                        type="text"
                        value={sellUpiId}
                        onChange={(e) => setSellUpiId(e.target.value)}
                        placeholder="e.g. yourname@okaxis or phone@ybl"
                        spellCheck={false}
                        className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                        Account Holder Name (Optional)
                      </label>
                      <input
                        type="text"
                        value={sellerNameInput}
                        onChange={(e) => setSellerNameInput(e.target.value)}
                        placeholder="Your name on UPI"
                        className="w-full px-3 py-2.5 text-xs bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                          Account Holder Name *
                        </label>
                        <input
                          type="text"
                          value={sellAccountHolder}
                          onChange={(e) => setSellAccountHolder(e.target.value)}
                          placeholder="Full name as per bank passbook"
                          className="w-full px-3 py-2.5 text-xs bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-emerald-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                          Bank Name *
                        </label>
                        <input
                          type="text"
                          value={sellBankName}
                          onChange={(e) => setSellBankName(e.target.value)}
                          placeholder="e.g. State Bank of India, HDFC Bank"
                          className="w-full px-3 py-2.5 text-xs bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-emerald-500"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                          Bank Account Number *
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={sellBankAccount}
                          onChange={(e) => setSellBankAccount(e.target.value.replace(/[^\d]/g, '').slice(0, 18))}
                          placeholder="9 to 18 digit account number"
                          spellCheck={false}
                          className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-emerald-500 tabular-nums"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                          Confirm Account Number *
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={sellBankAccountConfirm}
                          onChange={(e) =>
                            setSellBankAccountConfirm(e.target.value.replace(/[^\d]/g, '').slice(0, 18))
                          }
                          placeholder="Re-enter bank account number"
                          spellCheck={false}
                          className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-emerald-500 tabular-nums"
                          required
                        />
                        {sellBankAccountConfirm.length > 0 && !bankAcctMatches && (
                          <p className="mt-1 text-[11px] text-red-400">Account numbers do not match</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                      <div>
                        <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                          IFSC Code (11 Characters) *
                        </label>
                        <input
                          type="text"
                          value={sellBankIfsc}
                          onChange={(e) =>
                            setSellBankIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))
                          }
                          placeholder="e.g. SBIN0001234"
                          spellCheck={false}
                          className="w-full px-3 py-2.5 text-xs font-mono uppercase bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-emerald-500"
                          required
                        />
                      </div>
                      <div className="text-[11px] text-[#8B98A8] pt-4">
                        Your account number is masked publicly (e.g. <span className="font-mono text-[#C9D3DF]">••••••1234</span>) and visible only to the authenticated Merchant Desk for IMPS / NEFT bank transfer.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {sellError && (
                <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
                  {sellError}
                </div>
              )}

              {createdSellOrder && (
                <div className="p-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Sell Order {createdSellOrder.id} Locked at Live Market Price
                  </div>
                  <p className="text-xs text-[#C9D3DF]">
                    Verified on-chain escrow of{' '}
                    <span className="font-mono text-[#E6EDF3]">
                      {createdSellOrder.xyphAmount.toLocaleString()} {SYMBOL}
                    </span>{' '}
                    at <span className="font-mono">₹{createdSellOrder.executionPriceInr.toFixed(5)}/{SYMBOL}</span>.
                    Payout of{' '}
                    <span className="font-mono text-emerald-400 font-semibold">
                      ₹{createdSellOrder.inrPayout.toFixed(2)}
                    </span>{' '}
                    queued to{' '}
                    <span className="font-mono text-[#E6EDF3]">
                      {createdSellOrder.payoutMethod === 'bank'
                        ? `${createdSellOrder.bankName} ${createdSellOrder.bankAccountMasked} (${createdSellOrder.bankIfsc})`
                        : createdSellOrder.upiId}
                    </span>
                    .
                  </p>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-4 border-t border-[#1D2432]">
                <span className="text-xs text-[#8B98A8]">
                  {NETWORK_NAME} Fee: <span className="font-mono text-amber-400">{NETWORK_FEE_XYPH} {SYMBOL}</span> · Locks live INR payout
                </span>
                <button
                  type="submit"
                  disabled={
                    sellSubmitting ||
                    !sellParsed.sufficient ||
                    !sellPayoutValid ||
                    sellParsed.xyph < (config?.minSellXyph ?? 1)
                  }
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ArrowDownUp className="w-3.5 h-3.5" />
                  {sellSubmitting
                    ? 'Signing & Locking...'
                    : `Sell ${sellParsed.xyph > 0 ? sellParsed.xyph.toLocaleString() : '0'} ${SYMBOL} (₹${sellParsed.estInr.toFixed(2)})`}
                </button>
              </div>
            </form>

            {/* Right: Live Market Execution & Treasury Escrow Details */}
            <div className="lg:col-span-5 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[#E6EDF3]">
                  Live Market Execution &amp; Bank / UPI Payout
                </h3>
                <p className="text-xs text-[#8B98A8] mt-1">
                  Every sell order is cryptographically verified on {NETWORK_NAME} before locking your live INR transfer.
                </p>
              </div>

              <div className="divide-y divide-[#1D2432] border border-[#1E2533] rounded-md bg-[#0B0E14] text-xs">
                <div className="px-3.5 py-2.5 flex justify-between gap-2">
                  <span className="text-[#8B98A8]">Live Market Sell Price</span>
                  <span className="font-mono text-emerald-400 font-semibold tabular-nums">
                    ₹{liveSellPriceInr.toFixed(5)} / {SYMBOL}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex justify-between gap-2">
                  <span className="text-[#8B98A8]">100 {SYMBOL} Value</span>
                  <span className="font-mono text-[#E6EDF3] tabular-nums">
                    ₹{(liveSellPriceInr * 100).toFixed(3)} INR
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex justify-between gap-2">
                  <span className="text-[#8B98A8]">{NETWORK_NAME} Fee</span>
                  <span className="font-mono text-amber-400 tabular-nums">
                    {NETWORK_FEE_XYPH} {SYMBOL} (flat on-chain)
                  </span>
                </div>
                <div className="px-3.5 py-2.5 flex justify-between gap-2">
                  <span className="text-[#8B98A8]">Supported Payout Rails</span>
                  <span className="font-mono text-emerald-400">Bank (IMPS / NEFT) &amp; UPI</span>
                </div>
                <div className="px-3.5 py-2.5 flex justify-between gap-2">
                  <span className="text-[#8B98A8]">Minimum Sell</span>
                  <span className="font-mono text-[#E6EDF3]">
                    {config?.minSellXyph ?? 1} {SYMBOL}
                  </span>
                </div>
              </div>

              {(marketTicker?.treasuryEvmAddress || config?.treasuryEvmAddress) && (
                <div className="space-y-1.5 text-xs">
                  <span className="text-[#8B98A8]">Official Treasury Escrow Address</span>
                  <div className="p-2.5 rounded bg-[#0B0E14] border border-[#1E2533] font-mono text-[11px] text-[#C9D3DF] break-all">
                    {marketTicker?.treasuryEvmAddress || config?.treasuryEvmAddress}
                  </div>
                </div>
              )}

              <ol className="text-xs text-[#9AA6B6] space-y-1.5 list-decimal list-inside pt-2 border-t border-[#1D2432]">
                <li>Choose UPI ID or Bank Account Number + IFSC where you want INR transferred.</li>
                <li>Click Sell to sign and send {SYMBOL} (+ {NETWORK_FEE_XYPH} {SYMBOL} network fee) to the Xypher Treasury.</li>
                <li>Your live INR payout locks instantly and appears on the Merchant Desk for Bank / UPI transfer.</li>
              </ol>
            </div>
          </div>

          {/* Seller's Live Sell Orders Table */}
          <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#222A38] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#E6EDF3]">Your Live Sell Orders</h3>
                <p className="text-xs text-[#8B98A8] mt-0.5">
                  On-chain verified sell orders locked at live market price
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadMySellOrders()}
                disabled={loadingSellOrders}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSellOrders ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {mySellOrders.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8B98A8]">
                No sell orders submitted for your wallet yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#222A38] text-[#8B98A8]">
                      <th className="py-3 px-5">Sell Order / Escrow Tx</th>
                      <th className="py-3 px-4">Payout Destination (Bank / UPI)</th>
                      <th className="py-3 px-4 text-right">Sold ({SYMBOL})</th>
                      <th className="py-3 px-4 text-right">Locked Price</th>
                      <th className="py-3 px-4 text-right">INR Payout</th>
                      <th className="py-3 px-5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D2432]">
                    {mySellOrders.map((s) => {
                      const isBank = s.payoutMethod === 'bank';
                      return (
                        <tr key={s.id} className="hover:bg-[#161C27]">
                          <td className="py-3 px-5 font-mono">
                            <div className="text-[#E6EDF3]">{s.id}</div>
                            <button
                              type="button"
                              onClick={() => onInspectTx(s.depositTxid)}
                              className="text-[11px] text-amber-400 hover:underline cursor-pointer"
                            >
                              Tx: {truncateHash(s.depositTxid, 8, 6)}
                            </button>
                          </td>
                          <td className="py-3 px-4">
                            {isBank ? (
                              <div className="space-y-0.5">
                                <div className="text-[#E6EDF3] font-medium">
                                  {s.bankName || 'Bank Transfer'}{' '}
                                  <span className="text-[11px] text-emerald-400 font-mono">
                                    (IMPS/NEFT)
                                  </span>
                                </div>
                                <div className="font-mono text-[11px] text-[#C9D3DF]">
                                  {s.bankAccountMasked || '••••'} · IFSC {s.bankIfsc || '—'}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <div className="font-mono text-[#C9D3DF]">{s.upiId}</div>
                                <div className="text-[11px] text-[#6B7788]">UPI Payout</div>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#E6EDF3] tabular-nums">
                            {s.xyphAmount.toLocaleString()} {SYMBOL}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#8B98A8] tabular-nums">
                            ₹{s.executionPriceInr.toFixed(5)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-emerald-400 font-semibold tabular-nums">
                            ₹{s.inrPayout.toFixed(2)}
                          </td>
                          <td className="py-3 px-5 text-right">
                            {s.status === 'paid' ? (
                              <div className="space-y-0.5">
                                <span className="text-emerald-400 font-medium">
                                  {isBank ? 'Paid to Bank' : 'Paid via UPI'}
                                </span>
                                {s.payoutUtr && (
                                  <div className="font-mono text-[11px] text-[#8B98A8]">
                                    Ref: {s.payoutUtr}
                                  </div>
                                )}
                              </div>
                            ) : s.status === 'refunded' ? (
                              <span className="text-amber-400 font-medium">Refunded XYPH</span>
                            ) : (
                              <span className="text-amber-300 font-medium">
                                {isBank ? 'Awaiting Bank Transfer' : 'Awaiting UPI Payout'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* MERCHANT DESK: BUY ORDERS & SELL PAYOUTS */
        <div className="space-y-6">
          {!adminToken ? (
            <div className="max-w-lg mx-auto border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5">
              <div className="flex items-start gap-3">
                <KeyRound className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-base font-semibold text-[#E6EDF3]">
                    {config?.adminConfigured
                      ? 'Merchant Desk Sign In'
                      : 'Set Up Merchant Admin Passcode'}
                  </h3>
                  <p className="text-xs text-[#8B98A8] mt-1">
                    {config?.adminConfigured
                      ? 'Enter your Merchant Admin passcode to verify incoming UPI buys and send UPI INR payouts for live XYPH sell orders.'
                      : 'Create a private Merchant Admin passcode to protect your Buy & Sell settlement desk. You can also set MERCHANT_ADMIN_PASSCODE in Secrets.'}
                  </p>
                </div>
              </div>

              {config && !config.adminConfigured ? (
                <form onSubmit={handleMerchantSetup} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-medium text-[#9AA6B6] mb-1">
                      Create Admin Passcode (min 6 characters)
                    </label>
                    <input
                      type="password"
                      value={passcodeInput}
                      onChange={(e) => setPasscodeInput(e.target.value)}
                      autoComplete="new-password"
                      className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9AA6B6] mb-1">
                      Confirm Passcode
                    </label>
                    <input
                      type="password"
                      value={confirmPasscodeInput}
                      onChange={(e) => setConfirmPasscodeInput(e.target.value)}
                      autoComplete="new-password"
                      className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>
                  {authError && <p className="text-xs text-red-400">{authError}</p>}
                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full py-2.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer disabled:opacity-50"
                  >
                    {authBusy ? 'Saving...' : 'Create Passcode & Open Merchant Desk'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleMerchantLogin} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-medium text-[#9AA6B6] mb-1">
                      Merchant Admin Passcode
                    </label>
                    <input
                      type="password"
                      value={passcodeInput}
                      onChange={(e) => setPasscodeInput(e.target.value)}
                      autoComplete="current-password"
                      className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>
                  {authError && <p className="text-xs text-red-400">{authError}</p>}
                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer disabled:opacity-50"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    {authBusy ? 'Signing In...' : 'Unlock Merchant Desk'}
                  </button>
                </form>
              )}
            </div>
          ) : (
            <>
              {/* Merchant Desk Sub-Navigation: Buy Orders vs Sell Payouts */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 p-1 bg-[#121721] border border-[#222A38] rounded-md text-xs">
                  <button
                    type="button"
                    onClick={() => setMerchantDeskTab('buy')}
                    className={`px-3.5 py-1.5 rounded font-medium cursor-pointer whitespace-nowrap ${
                      merchantDeskTab === 'buy'
                        ? 'bg-[#1D2534] text-emerald-400'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    Buy Orders ({merchantSummary?.pendingCount ?? 0} pending)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMerchantDeskTab('sell')}
                    className={`px-3.5 py-1.5 rounded font-medium cursor-pointer whitespace-nowrap ${
                      merchantDeskTab === 'sell'
                        ? 'bg-[#1D2534] text-amber-400'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    Sell Payouts ({merchantSellSummary?.pendingPayoutCount ?? 0} pending)
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadMerchantDesk()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminToken(null)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#8B98A8] hover:text-[#E6EDF3] border border-[#2A3446] rounded cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Lock
                  </button>
                </div>
              </div>

              {merchantNotice && (
                <div
                  className={`p-3.5 rounded-md border text-xs ${
                    merchantNotice.kind === 'ok'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-300'
                  }`}
                >
                  {merchantNotice.text}
                </div>
              )}

              {merchantDeskTab === 'buy' ? (
                <>
                  {/* Buy KPI Strip */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#222A38] rounded-lg bg-[#121721] divide-y lg:divide-y-0 lg:divide-x divide-[#222A38]">
                    <div className="p-5">
                      <p className="text-xs text-[#8B98A8]">Total INR Received</p>
                      <p className="mt-2 text-2xl font-mono font-semibold text-emerald-400 tabular-nums">
                        ₹{(merchantSummary?.totalInrReceived ?? 0).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-[#6B7788] font-mono">
                        {config?.upiId || 'aryabiswas@yesfam'}
                      </p>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-[#8B98A8]">Total {SYMBOL} Credited</p>
                      <p className="mt-2 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums">
                        {(merchantSummary?.totalXyphDisbursed ?? 0).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-[#6B7788]">Rate: ₹1 = 100 {SYMBOL}</p>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-[#8B98A8]">Pending Verification</p>
                      <p className="mt-2 text-2xl font-mono font-semibold text-amber-400 tabular-nums">
                        {merchantSummary?.pendingCount ?? 0}
                      </p>
                      <p className="mt-1 text-xs text-[#6B7788]">Awaiting UTR check</p>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-[#8B98A8]">Completed Buys</p>
                      <p className="mt-2 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums">
                        {merchantSummary?.completedCount ?? 0}
                      </p>
                      <p className="mt-1 text-xs text-[#6B7788]">
                        {merchantSummary?.totalOrders ?? 0} total submitted
                      </p>
                    </div>
                  </div>

                  <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[#222A38]">
                      <div className="inline-flex items-center gap-1 p-1 bg-[#0B0E14] border border-[#1E2533] rounded-md text-xs">
                        {(['all', 'pending', 'completed', 'rejected'] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setMerchantFilter(f)}
                            className={`px-3 py-1 rounded capitalize cursor-pointer ${
                              merchantFilter === f
                                ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                                : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filteredMerchantOrders.length === 0 ? (
                      <div className="p-10 text-center text-xs text-[#8B98A8]">
                        No incoming UPI buy orders matching this filter yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[#222A38] text-[#8B98A8]">
                              <th className="py-3 px-5">Order &amp; UTR</th>
                              <th className="py-3 px-4">Buyer &amp; Wallet</th>
                              <th className="py-3 px-4 text-right">INR Paid</th>
                              <th className="py-3 px-4 text-right">Send {SYMBOL}</th>
                              <th className="py-3 px-5 text-right">Action / Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1D2432]">
                            {filteredMerchantOrders.map((o) => (
                              <tr key={o.id} className="hover:bg-[#161C27]">
                                <td className="py-3.5 px-5 font-mono">
                                  <div className="text-[#E6EDF3] font-medium">{o.utr}</div>
                                  <div className="text-[11px] text-[#6B7788]">
                                    {o.id} · {new Date(o.createdAt * 1000).toLocaleString()}
                                  </div>
                                </td>
                                <td className="py-3.5 px-4">
                                  <div className="text-[#E6EDF3] font-medium">{o.payerName}</div>
                                  <div className="font-mono text-[11px] text-[#8B98A8]">
                                    MetaMask: {truncateHash(o.recipientEvm, 10, 6)}
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 text-right font-mono text-[#E6EDF3] tabular-nums whitespace-nowrap">
                                  ₹{o.inrAmount.toLocaleString()}
                                </td>
                                <td className="py-3.5 px-4 text-right font-mono text-emerald-400 tabular-nums whitespace-nowrap">
                                  {o.xyphAmount.toLocaleString()} {SYMBOL}
                                </td>
                                <td className="py-3.5 px-5 text-right whitespace-nowrap">
                                  {o.status === 'pending' ? (
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void handleApproveOrder(o.id)}
                                        disabled={actionOrderId === o.id}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#0B0E14] bg-emerald-400 hover:bg-emerald-300 rounded cursor-pointer disabled:opacity-50"
                                      >
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                        {actionOrderId === o.id ? 'Sending...' : 'Verify & Send XYPH'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleRejectOrder(o.id)}
                                        disabled={actionOrderId === o.id}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-300 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 rounded cursor-pointer disabled:opacity-50"
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                        Reject
                                      </button>
                                    </div>
                                  ) : o.status === 'completed' ? (
                                    <div className="space-y-0.5">
                                      <span className="text-emerald-400 font-medium">Completed</span>
                                      {o.txid && (
                                        <div>
                                          <button
                                            type="button"
                                            onClick={() => onInspectTx(o.txid!)}
                                            className="font-mono text-[11px] text-amber-400 hover:underline cursor-pointer"
                                          >
                                            {truncateHash(o.txid, 8, 6)}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-red-400 font-medium">Rejected</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* MERCHANT SELL PAYOUTS QUEUE */
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#222A38] rounded-lg bg-[#121721] divide-y lg:divide-y-0 lg:divide-x divide-[#222A38]">
                    <div className="p-5">
                      <p className="text-xs text-[#8B98A8]">Pending INR Payouts</p>
                      <p className="mt-2 text-2xl font-mono font-semibold text-amber-400 tabular-nums">
                        ₹{(merchantSellSummary?.pendingInrOwed ?? 0).toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-[#6B7788]">
                        {merchantSellSummary?.pendingPayoutCount ?? 0} awaiting UPI transfer
                      </p>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-[#8B98A8]">Total INR Paid Out</p>
                      <p className="mt-2 text-2xl font-mono font-semibold text-emerald-400 tabular-nums">
                        ₹{(merchantSellSummary?.totalInrPaidOut ?? 0).toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-[#6B7788]">
                        {merchantSellSummary?.paidCount ?? 0} settled via UPI
                      </p>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-[#8B98A8]">{SYMBOL} Received in Escrow</p>
                      <p className="mt-2 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums">
                        {(merchantSellSummary?.totalXyphSold ?? 0).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-[#6B7788]">Verified on-chain transfers</p>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-[#8B98A8]">Live Spot Price</p>
                      <p className="mt-2 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums">
                        ₹{liveSellPriceInr.toFixed(5)}
                      </p>
                      <p className="mt-1 text-xs text-[#6B7788]">Per 1 {SYMBOL}</p>
                    </div>
                  </div>

                  <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[#222A38]">
                      <div className="inline-flex items-center gap-1 p-1 bg-[#0B0E14] border border-[#1E2533] rounded-md text-xs">
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'pending_payout', label: 'Pending Payout' },
                            { id: 'paid', label: 'Paid' },
                            { id: 'refunded', label: 'Refunded' },
                          ] as const
                        ).map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setSellDeskFilter(f.id)}
                            className={`px-3 py-1 rounded cursor-pointer whitespace-nowrap ${
                              sellDeskFilter === f.id
                                ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                                : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filteredSellOrders.length === 0 ? (
                      <div className="p-10 text-center text-xs text-[#8B98A8]">
                        No sell orders matching this filter yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[#222A38] text-[#8B98A8]">
                              <th className="py-3 px-5">Sell Order &amp; Escrow Tx</th>
                              <th className="py-3 px-4">Seller Bank Account / UPI</th>
                              <th className="py-3 px-4 text-right">{SYMBOL} Received</th>
                              <th className="py-3 px-4 text-right">INR to Pay</th>
                              <th className="py-3 px-5 text-right">Settlement Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1D2432]">
                            {filteredSellOrders.map((s) => {
                              const isBank = s.payoutMethod === 'bank';
                              const paySellerLink = !isBank
                                ? `upi://pay?pa=${encodeURIComponent(
                                    s.upiId
                                  )}&pn=${encodeURIComponent(s.sellerName)}&am=${encodeURIComponent(
                                    s.inrPayout.toFixed(2)
                                  )}&cu=INR&tn=${encodeURIComponent(`XYPH Sell ${s.id}`)}`
                                : null;
                              const fullBankAcct = s.bankAccountNumber || s.bankAccountMasked || '';
                              return (
                                <tr key={s.id} className="hover:bg-[#161C27]">
                                  <td className="py-3.5 px-5 font-mono">
                                    <div className="text-[#E6EDF3] font-medium">{s.id}</div>
                                    <button
                                      type="button"
                                      onClick={() => onInspectTx(s.depositTxid)}
                                      className="text-[11px] text-amber-400 hover:underline cursor-pointer"
                                    >
                                      Escrow: {truncateHash(s.depositTxid, 8, 6)}
                                    </button>
                                  </td>
                                  <td className="py-3.5 px-4">
                                    {isBank ? (
                                      <div className="space-y-1">
                                        <div className="text-[#E6EDF3] font-medium flex items-center gap-1.5">
                                          <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                          <span>{s.accountHolderName || s.sellerName}</span>
                                          <span className="text-[11px] text-[#8B98A8] font-normal">
                                            ({s.bankName || 'Bank'})
                                          </span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-emerald-300">
                                          <span>A/C: {fullBankAcct}</span>
                                          <button
                                            type="button"
                                            onClick={() => copyText(fullBankAcct, `bank-acct-${s.id}`)}
                                            className="text-[#8B98A8] hover:text-emerald-400 cursor-pointer"
                                            title="Copy Bank Account Number"
                                          >
                                            {copiedId === `bank-acct-${s.id}` ? (
                                              <Check className="w-3 h-3 text-emerald-400" />
                                            ) : (
                                              <Copy className="w-3 h-3" />
                                            )}
                                          </button>
                                          <span className="text-[#6B7788]">|</span>
                                          <span className="text-amber-300">IFSC: {s.bankIfsc}</span>
                                          {s.bankIfsc && (
                                            <button
                                              type="button"
                                              onClick={() => copyText(s.bankIfsc!, `bank-ifsc-${s.id}`)}
                                              className="text-[#8B98A8] hover:text-amber-400 cursor-pointer"
                                              title="Copy IFSC Code"
                                            >
                                              {copiedId === `bank-ifsc-${s.id}` ? (
                                                <Check className="w-3 h-3 text-emerald-400" />
                                              ) : (
                                                <Copy className="w-3 h-3" />
                                              )}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="text-[#E6EDF3] font-medium">{s.sellerName}</div>
                                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-amber-300">
                                          <span>{s.upiId}</span>
                                          <button
                                            type="button"
                                            onClick={() => copyText(s.upiId, `sell-upi-${s.id}`)}
                                            className="text-[#8B98A8] hover:text-amber-400 cursor-pointer"
                                            title="Copy seller UPI ID"
                                          >
                                            {copiedId === `sell-upi-${s.id}` ? (
                                              <Check className="w-3 h-3 text-emerald-400" />
                                            ) : (
                                              <Copy className="w-3 h-3" />
                                            )}
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </td>
                                  <td className="py-3.5 px-4 text-right font-mono text-[#E6EDF3] tabular-nums whitespace-nowrap">
                                    <div>
                                      {s.xyphAmount.toLocaleString()} {SYMBOL}
                                    </div>
                                    <div className="text-[11px] text-[#6B7788]">
                                      @ ₹{s.executionPriceInr.toFixed(5)}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-semibold tabular-nums whitespace-nowrap">
                                    ₹{s.inrPayout.toFixed(2)}
                                  </td>
                                  <td className="py-3.5 px-5 text-right whitespace-nowrap">
                                    {s.status === 'pending_payout' ? (
                                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                                        {paySellerLink && (
                                          <a
                                            href={paySellerLink}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded hover:bg-amber-500/20"
                                          >
                                            <Smartphone className="w-3.5 h-3.5" />
                                            Pay UPI
                                          </a>
                                        )}
                                        <input
                                          type="text"
                                          value={payoutUtrByOrder[s.id] || ''}
                                          onChange={(e) =>
                                            setPayoutUtrByOrder((prev) => ({
                                              ...prev,
                                              [s.id]: e.target.value,
                                            }))
                                          }
                                          placeholder={isBank ? 'IMPS / NEFT Ref' : 'Payout UTR'}
                                          className="w-32 px-2 py-1.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded text-[#E6EDF3] focus:outline-none focus:border-emerald-500"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => void handleMarkSellPaid(s.id)}
                                          disabled={actionOrderId === s.id}
                                          className="px-2.5 py-1.5 text-xs font-semibold text-[#0B0E14] bg-emerald-400 hover:bg-emerald-300 rounded cursor-pointer disabled:opacity-50"
                                        >
                                          Mark Paid
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleRefundSell(s.id)}
                                          disabled={actionOrderId === s.id}
                                          title="Refund XYPH back to seller wallet"
                                          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-red-300 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 rounded cursor-pointer disabled:opacity-50"
                                        >
                                          <RotateCcw className="w-3 h-3" />
                                          Refund
                                        </button>
                                      </div>
                                    ) : s.status === 'paid' ? (
                                      <div className="space-y-0.5">
                                        <span className="text-emerald-400 font-medium">
                                          {isBank ? 'Paid (Bank)' : 'Paid (UPI)'}
                                        </span>
                                        {s.payoutUtr && (
                                          <div className="font-mono text-[11px] text-[#8B98A8]">
                                            Ref: {s.payoutUtr}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-amber-400 font-medium">Refunded</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Fullscreen Zoomed Official UPI QR Lightbox Modal */}
      {qrFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setQrFullscreen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-[#2A3446] bg-[#121721] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-[#222A38] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#E6EDF3]">
                  Scan Official UPI QR · Pay ₹{parsedInr || 1}
                </h3>
                <p className="text-xs text-[#8B98A8] font-mono">
                  {config?.upiId || 'aryabiswas@yesfam'} · {config?.merchantName || 'Arya Biswas'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrFullscreen(false)}
                className="p-1.5 text-[#8B98A8] hover:text-[#E6EDF3] rounded hover:bg-[#1B2230] cursor-pointer"
                aria-label="Close fullscreen QR"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 bg-white flex items-center justify-center">
              <img
                src={
                  config?.qrImagePath ||
                  '/assets/aistudio/WhatsApp_Image_2026-11-21_at_4.30.20_PM_00d00dfc.jpeg'
                }
                alt="Zoomed Official UPI QR Code"
                className="w-full max-w-[440px] max-h-[70vh] object-contain"
              />
            </div>
            <div className="px-5 py-3.5 border-t border-[#222A38] flex flex-wrap items-center justify-between gap-3 text-xs">
              <button
                type="button"
                onClick={() => copyText(config?.upiId || 'aryabiswas@yesfam', 'fs-upi')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] cursor-pointer"
              >
                {copiedId === 'fs-upi' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedId === 'fs-upi' ? 'Copied UPI ID' : config?.upiId || 'aryabiswas@yesfam'}
              </button>
              <button
                type="button"
                onClick={() => setQrFullscreen(false)}
                className="px-4 py-1.5 font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 cursor-pointer"
              >
                Done Scanning
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
