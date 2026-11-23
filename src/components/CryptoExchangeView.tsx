import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowDownUp,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
  X,
  ZoomIn,
} from 'lucide-react';
import { xypherApi } from '../lib/api.ts';
import {
  type EvmWalletName,
  formatWalletError,
  getEthereumProvider,
  sendXyphNetworkTokenViaMetaMask,
  sendXyphViaMetaMask,
  watchExchangeTokenInMetaMask,
} from '../lib/metamask.ts';
import {
  buildWalletTransferUri,
  isDirectEvmCoin,
  isTronLinkAvailable,
  sendRealEvmTransfer,
  sendRealSolanaTransfer,
  sendRealTronTransfer,
} from '../lib/multiChainTransfer.ts';
import {
  EXTERNAL_PAYMENT_COINS,
  SUPPORTED_COIN_MAP,
  SUPPORTED_EXCHANGE_COINS,
  type SupportedCoinSymbol,
  XYPH_COLLECTION_NATIVE_ADDRESS,
  formatCoinAmount,
  validateCoinAddress,
  validateCoinRecipientOrMetaMask,
  validateCoinTxHash,
} from '../lib/supportedCoins.ts';
import type {
  AddressInfo,
  CryptoExchangeAsset,
  CryptoExchangeOrder,
  CryptoVaultSummary,
  LocalWalletAccount,
  MarketTicker,
  MetaMaskTokenBalanceItem,
  MetaMaskTokenDelivery,
} from '../lib/types.ts';
import {
  NETWORK_FEE_UNITS,
  NETWORK_FEE_XYPH,
  SYMBOL,
  UNIT,
  buildSignedTx,
  bytesToHex,
  evmToXypherAddress,
  formatXYPH,
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
import { CoinLogo } from './CoinLogo.tsx';

interface CryptoExchangeViewProps {
  wallets: LocalWalletAccount[];
  balances: Record<string, AddressInfo>;
  marketTicker: MarketTicker | null;
  mmAccount: string | null;
  evmWalletName: EvmWalletName | null;
  phantomSolAccount: string | null;
  publicBaseUrl: string | null;
  mmBusy: boolean;
  onConnectMetaMask: () => Promise<void>;
  onConnectPhantom: () => Promise<void>;
  onMarketUpdated: (ticker: MarketTicker) => void;
  onExchangeSettled: (order: CryptoExchangeOrder) => void;
  onInspectTx: (txid: string) => void;
}

type ExchangeSubTab = 'buy_crypto' | 'swap' | 'transfer' | 'vaults';

export const CryptoExchangeView: React.FC<CryptoExchangeViewProps> = ({
  wallets,
  balances,
  marketTicker,
  mmAccount,
  evmWalletName,
  phantomSolAccount,
  publicBaseUrl,
  mmBusy,
  onConnectMetaMask,
  onConnectPhantom,
  onMarketUpdated,
  onExchangeSettled,
  onInspectTx,
}) => {
  const activeWalletLabel = evmWalletName || 'MetaMask';
  const mmXyphAddress = useMemo(() => {
    if (!mmAccount) return null;
    try {
      return evmToXypherAddress(mmAccount);
    } catch {
      return null;
    }
  }, [mmAccount]);

  const [subTab, setSubTab] = useState<ExchangeSubTab>('buy_crypto');
  const [assets, setAssets] = useState<CryptoExchangeAsset[]>([]);
  const [summary, setSummary] = useState<CryptoVaultSummary | null>(null);
  const [orders, setOrders] = useState<CryptoExchangeOrder[]>([]);
  const [usdToInr, setUsdToInr] = useState<number>(84);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Copy & QR zoom states
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [qrModalAsset, setQrModalAsset] = useState<CryptoExchangeAsset | null>(null);
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});

  // Buy XYPH with Crypto state
  const [buyCoin, setBuyCoin] = useState<SupportedCoinSymbol>('ETH');
  const [buyAmountInput, setBuyAmountInput] = useState<string>('0.01');
  const [buyDestType, setBuyDestType] = useState<'metamask' | 'local' | 'custom'>(
    mmAccount ? 'metamask' : 'local'
  );
  const [buyLocalAddr, setBuyLocalAddr] = useState<string>(wallets[0]?.address || '');
  const [buyCustomAddr, setBuyCustomAddr] = useState<string>('');
  const [buyTxHash, setBuyTxHash] = useState<string>('');
  const [buyWalletPaying, setBuyWalletPaying] = useState(false);
  const [buySubmitting, setBuySubmitting] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buyReceipt, setBuyReceipt] = useState<CryptoExchangeOrder | null>(null);

  // Swap / Exchange Coins state (all 9 coins)
  const [fromCoin, setFromCoin] = useState<SupportedCoinSymbol>('XYPH');
  const [toCoin, setToCoin] = useState<SupportedCoinSymbol>('ETH');
  const [swapAmountInput, setSwapAmountInput] = useState<string>('10');
  const [swapRecipientInput, setSwapRecipientInput] = useState<string>(mmAccount || '');
  const [swapDepositTxHash, setSwapDepositTxHash] = useState<string>('');
  const [swapXyphSourceMode, setSwapXyphSourceMode] = useState<'local' | 'metamask'>(
    mmAccount ? 'metamask' : 'local'
  );
  const [swapXyphLocalAddr, setSwapXyphLocalAddr] = useState<string>(wallets[0]?.address || '');
  const [liveSwapSenderInfo, setLiveSwapSenderInfo] = useState<AddressInfo | null>(null);
  const userPickedSwapWalletRef = useRef(false);
  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapReceipt, setSwapReceipt] = useState<CryptoExchangeOrder | null>(null);
  const [swapTokenDelivery, setSwapTokenDelivery] = useState<MetaMaskTokenDelivery | null>(null);

  // MetaMask XYPH Network ERC-20 exchanged crypto balances & 1-click claim/watch state
  const [mmTokens, setMmTokens] = useState<MetaMaskTokenBalanceItem[]>([]);
  const [claimingOrderId, setClaimingOrderId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);
  const [watchingSymbol, setWatchingSymbol] = useState<string | null>(null);

  // Direct Transfer to Any Wallet state (all 9 coins in real)
  const [transferCoin, setTransferCoin] = useState<SupportedCoinSymbol>('XYPH');
  const [transferToInput, setTransferToInput] = useState<string>('');
  const [transferAmountInput, setTransferAmountInput] = useState<string>('10');
  const [transferExternalTxHash, setTransferExternalTxHash] = useState<string>('');
  const [transferQrDataUrl, setTransferQrDataUrl] = useState<string>('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferReceipt, setTransferReceipt] = useState<CryptoExchangeOrder | null>(null);

  // Real Exchange Payout Dispatch modal (for completing pending_payout swaps to any wallet)
  const [payoutOrder, setPayoutOrder] = useState<CryptoExchangeOrder | null>(null);
  const [payoutRecipientInput, setPayoutRecipientInput] = useState<string>('');
  const [payoutTxHashInput, setPayoutTxHashInput] = useState<string>('');
  const [payoutQrDataUrl, setPayoutQrDataUrl] = useState<string>('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutSuccessMsg, setPayoutSuccessMsg] = useState<string | null>(null);
  const [payoutTokenDelivery, setPayoutTokenDelivery] = useState<MetaMaskTokenDelivery | null>(null);

  // Orders filter
  const [orderCoinFilter, setOrderCoinFilter] = useState<string>('ALL');

  const loadMetaMaskTokens = useCallback(async (targetEvm?: string | null) => {
    const addr = (targetEvm ?? mmAccount)?.trim();
    if (!addr || !isValidEvmAddress(addr)) {
      setMmTokens([]);
      return;
    }
    try {
      const res = await xypherApi.getMetaMaskExchangeTokens(addr);
      setMmTokens(res.tokens || []);
    } catch {
      // Keep last known balances if server is restarting
    }
  }, [mmAccount]);

  const loadExchangeData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [assetRes, orderRes] = await Promise.all([
        xypherApi.getExchangeAssets(),
        xypherApi.getExchangeOrders(),
      ]);
      setAssets(assetRes.assets);
      setSummary(assetRes.summary);
      setUsdToInr(assetRes.usdToInr || 84);
      setOrders(orderRes.orders);
      await loadMetaMaskTokens();
    } catch {
      // Keep fallback definitions if server is restarting
    } finally {
      setLoadingAssets(false);
      setRefreshing(false);
    }
  }, [loadMetaMaskTokens]);

  useEffect(() => {
    void loadExchangeData();
  }, [loadExchangeData]);

  useEffect(() => {
    void loadMetaMaskTokens(mmAccount);
  }, [mmAccount, loadMetaMaskTokens]);

  const mmTokenMap = useMemo(() => {
    const m = {} as Partial<Record<SupportedCoinSymbol, MetaMaskTokenBalanceItem>>;
    for (const t of mmTokens) m[t.symbol] = t;
    return m;
  }, [mmTokens]);

  const heldMmTokens = useMemo(
    () => mmTokens.filter((t) => t.balanceNumeric > 0),
    [mmTokens]
  );

  const handleWatchTokenInMetaMask = async (
    symbol: SupportedCoinSymbol,
    contractAddress?: string | null,
    decimals?: number
  ) => {
    const coinDef = SUPPORTED_COIN_MAP[symbol];
    const resolvedContract = contractAddress || coinDef?.xyphTokenContract;
    const resolvedDecimals = decimals ?? coinDef?.tokenDecimals ?? 18;
    if (!resolvedContract) return;
    setWatchingSymbol(symbol);
    setClaimError(null);
    try {
      const added = await watchExchangeTokenInMetaMask({
        contractAddress: resolvedContract,
        symbol,
        decimals: resolvedDecimals,
        publicBaseUrl,
      });
      if (added) {
        setClaimNotice(
          `${symbol} token added to ${activeWalletLabel} on XYPH Network — open ${activeWalletLabel} (XYPH Network) to see your live ${symbol} balance.`
        );
      }
    } catch (err) {
      setClaimError(formatWalletError(err));
    } finally {
      setWatchingSymbol(null);
    }
  };

  const handleClaimOrderToMetaMask = async (
    order: CryptoExchangeOrder,
    overrideEvm?: string
  ) => {
    setClaimError(null);
    setClaimNotice(null);
    setClaimingOrderId(order.id);
    try {
      let targetEvm = (overrideEvm || mmAccount || '').trim();
      if (!targetEvm || !isValidEvmAddress(targetEvm)) {
        await onConnectMetaMask();
        const provider = getEthereumProvider('active');
        if (provider) {
          const accs = (await provider.request({ method: 'eth_accounts' })) as string[];
          targetEvm = accs?.[0] || '';
        }
      }
      if (!targetEvm || !isValidEvmAddress(targetEvm)) {
        throw new Error(
          `Connect ${activeWalletLabel} first so your ${order.toCoin} can be transferred directly to your 0x... wallet.`
        );
      }

      const res = await xypherApi.claimExchangeOrderToMetaMask(order.id, targetEvm);
      setSummary(res.summary);
      setOrders((prev) => prev.map((o) => (o.id === res.order.id ? res.order : o)));
      if (swapReceipt && swapReceipt.id === res.order.id) {
        setSwapReceipt(res.order);
        if (res.tokenDelivery) setSwapTokenDelivery(res.tokenDelivery);
      }
      if (payoutOrder && payoutOrder.id === res.order.id) {
        setPayoutOrder(res.order);
        setPayoutRecipientInput(res.order.recipientAddress);
        if (res.tokenDelivery) setPayoutTokenDelivery(res.tokenDelivery);
        setPayoutSuccessMsg(
          res.tokenDelivery
            ? `Delivered ${formatCoinAmount(res.tokenDelivery.amount, res.tokenDelivery.symbol)} ${res.tokenDelivery.symbol} on-chain to ${truncateHash(targetEvm, 10, 6)} (Block #${res.tokenDelivery.blockHeight} · New ${res.tokenDelivery.symbol} balance: ${res.tokenDelivery.balanceAfter}). Click "Add ${res.tokenDelivery.symbol} to ${activeWalletLabel}" below to display it in your wallet.`
            : `Transferred ${formatCoinAmount(res.order.toAmount, res.order.toCoin)} ${res.order.toCoin} to ${truncateHash(targetEvm, 10, 6)}.`
        );
      }

      if (res.tokenDelivery) {
        setClaimNotice(
          `Transferred ${formatCoinAmount(res.tokenDelivery.amount, res.tokenDelivery.symbol)} ${res.tokenDelivery.symbol} on-chain to ${truncateHash(targetEvm, 8, 6)} (Block #${res.tokenDelivery.blockHeight} · Balance: ${res.tokenDelivery.balanceAfter} ${res.tokenDelivery.symbol}).`
        );
      } else {
        setClaimNotice(
          `Transferred ${formatCoinAmount(res.order.toAmount, res.order.toCoin)} ${res.order.toCoin} on-chain to ${truncateHash(targetEvm, 8, 6)}.`
        );
      }

      onExchangeSettled(res.order);
      await loadMetaMaskTokens(targetEvm);
      await loadExchangeData();
    } catch (err) {
      const msg = formatWalletError(err);
      setClaimError(msg);
      if (payoutOrder && payoutOrder.id === order.id) {
        setPayoutError(msg);
      }
    } finally {
      setClaimingOrderId(null);
    }
  };

  useEffect(() => {
    if (wallets.length > 0 && !wallets.some((w) => w.address === buyLocalAddr)) {
      setBuyLocalAddr(wallets[0].address);
    }
    if (wallets.length > 0 && !wallets.some((w) => w.address === swapXyphLocalAddr)) {
      setSwapXyphLocalAddr(wallets[0].address);
    }
  }, [wallets, buyLocalAddr, swapXyphLocalAddr]);

  const effectiveAssets: CryptoExchangeAsset[] = useMemo(() => {
    if (assets.length > 0) return assets;
    const xyphPriceInr = marketTicker?.priceInr ?? 0.01;
    const xyphPriceUsd = Math.max(0.000001, xyphPriceInr / usdToInr);
    return SUPPORTED_EXCHANGE_COINS.map((c) => {
      const priceUsd = c.symbol === 'XYPH' ? xyphPriceUsd : c.fallbackUsdPrice;
      return {
        symbol: c.symbol,
        name: c.name,
        network: c.network,
        standard: c.standard,
        addressFormatLabel: c.addressFormatLabel,
        collectionAddress: c.collectionAddress,
        collectionXyphAddress: c.collectionXyphAddress,
        evmChainId: c.evmChainId,
        evmChainIdHex: c.evmChainIdHex,
        priceUsd,
        priceInr: Number((priceUsd * usdToInr).toFixed(6)),
        xyphPerCoin: c.symbol === 'XYPH' ? 1 : Number((priceUsd / xyphPriceUsd).toFixed(4)),
        decimals: c.decimals,
        minAmount: c.minAmount,
        accentColor: c.accentColor,
        addressPlaceholder: c.addressPlaceholder,
        txHashPlaceholder: c.txHashPlaceholder,
        explorerTxPrefix: c.explorerTxPrefix,
        paymentUriScheme: c.paymentUriScheme,
        totalCollectedAmount: 0,
        totalCollectedUsd: 0,
        collectedTxCount: 0,
        priceSource: 'reference' as const,
      };
    });
  }, [assets, marketTicker, usdToInr]);

  const assetMap = useMemo(() => {
    const m = {} as Record<SupportedCoinSymbol, CryptoExchangeAsset>;
    for (const a of effectiveAssets) m[a.symbol] = a;
    return m;
  }, [effectiveAssets]);

  const selectedBuyAsset = assetMap[buyCoin] || effectiveAssets[0];
  const selectedFromAsset = assetMap[fromCoin] || effectiveAssets[0];
  const selectedToAsset = assetMap[toCoin] || effectiveAssets[0];

  // Generate QR data URL for active collection address on demand
  const ensureQrForAddress = useCallback(async (key: string, value: string) => {
    if (!value) return;
    setQrDataUrls((prev) => {
      if (prev[key]) return prev;
      void QRCode.toDataURL(value, {
        width: 360,
        margin: 2,
        color: { dark: '#0B0E14', light: '#FFFFFF' },
      })
        .then((url) => {
          setQrDataUrls((cur) => ({ ...cur, [key]: url }));
        })
        .catch(() => {});
      return prev;
    });
  }, []);

  useEffect(() => {
    if (selectedBuyAsset) {
      void ensureQrForAddress(selectedBuyAsset.symbol, selectedBuyAsset.collectionAddress);
    }
  }, [selectedBuyAsset, ensureQrForAddress]);

  useEffect(() => {
    if (selectedFromAsset) {
      void ensureQrForAddress(selectedFromAsset.symbol, selectedFromAsset.collectionAddress);
    }
  }, [selectedFromAsset, ensureQrForAddress]);

  useEffect(() => {
    if (qrModalAsset) {
      void ensureQrForAddress(qrModalAsset.symbol, qrModalAsset.collectionAddress);
    }
  }, [qrModalAsset, ensureQrForAddress]);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1800);
  };

  // Buy XYPH with Crypto calculations
  const parsedBuyAmount = useMemo(() => {
    const n = Number(buyAmountInput);
    if (!Number.isFinite(n) || n <= 0 || !selectedBuyAsset) return null;
    const usdValue = n * selectedBuyAsset.priceUsd;
    const inrValue = usdValue * usdToInr;
    const xyphEstimate = n * selectedBuyAsset.xyphPerCoin;
    return { amount: n, usdValue, inrValue, xyphEstimate };
  }, [buyAmountInput, selectedBuyAsset, usdToInr]);

  const resolvedBuyRecipient = useMemo(() => {
    if (buyDestType === 'metamask') return mmAccount || buyCustomAddr.trim();
    if (buyDestType === 'local') return buyLocalAddr || wallets[0]?.address || '';
    return buyCustomAddr.trim();
  }, [buyDestType, mmAccount, buyLocalAddr, wallets, buyCustomAddr]);

  const buyRecipientValid = Boolean(normalizeToXypherAddress(resolvedBuyRecipient));

  // Real multi-chain wallet transfer helper:
  // - ETH / BNB / POL / MON: MetaMask or Phantom EVM (auto chain switch/add + eth_sendTransaction)
  // - SOL: Phantom / Wallet Standard Solana Mainnet transfer
  // - TRX: TronLink TRON Mainnet transfer
  const handleDirectWalletSend = async (
    symbol: SupportedCoinSymbol,
    toAddress: string,
    amount: number,
    onSuccess: (result: {
      txHash: string;
      senderAddress?: string;
      payoutMethod: NonNullable<CryptoExchangeOrder['payoutMethod']>;
    }) => void | Promise<void>,
    setErr: (msg: string | null) => void,
    setBusy: (val: boolean) => void
  ) => {
    setErr(null);
    setBusy(true);
    try {
      if (isDirectEvmCoin(symbol)) {
        let provider = getEthereumProvider(evmWalletName === 'Phantom' ? 'phantom' : undefined);
        let fromAddr = mmAccount;
        if (!provider || !fromAddr) {
          await onConnectMetaMask();
          provider = getEthereumProvider();
          if (provider) {
            const accs = (await provider.request({ method: 'eth_accounts' })) as string[];
            fromAddr = accs?.[0] || null;
          }
        }
        if (!provider || !fromAddr) {
          throw new Error('Connect MetaMask or Phantom Wallet first to send directly.');
        }
        const txHash = await sendRealEvmTransfer({
          symbol,
          toAddress,
          amount,
          fromEvm: fromAddr,
          provider,
        });
        await onSuccess({
          txHash,
          senderAddress: fromAddr,
          payoutMethod: 'metamask_evm',
        });
        return;
      }

      if (symbol === 'SOL') {
        if (!phantomSolAccount) {
          await onConnectPhantom();
        }
        const txHash = await sendRealSolanaTransfer({ toAddress, amount });
        await onSuccess({
          txHash,
          senderAddress: phantomSolAccount || undefined,
          payoutMethod: 'phantom_sol',
        });
        return;
      }

      if (symbol === 'TRX') {
        const { txid, senderAddress } = await sendRealTronTransfer({ toAddress, amount });
        await onSuccess({
          txHash: txid,
          senderAddress,
          payoutMethod: 'tronlink_trx',
        });
        return;
      }

      throw new Error(
        `Use the ${symbol} wallet app link or QR code to broadcast from your ${symbol} wallet, then confirm the transaction hash.`
      );
    } catch (err) {
      setErr(formatWalletError(err));
    } finally {
      setBusy(false);
    }
  };

  // Convenience wrapper for direct deposit payment into a coin's collection vault
  const handleDirectEvmPay = async (
    coin: CryptoExchangeAsset,
    amount: number,
    onHash: (hash: string) => void,
    setErr: (msg: string | null) => void
  ) => {
    await handleDirectWalletSend(
      coin.symbol,
      coin.collectionAddress,
      amount,
      ({ txHash }) => onHash(txHash),
      setErr,
      setBuyWalletPaying
    );
  };

  const handleSubmitBuyWithCrypto = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuyError(null);
    setBuyReceipt(null);

    if (!selectedBuyAsset || selectedBuyAsset.symbol === 'XYPH') {
      setBuyError('Select a supported cryptocurrency to pay with.');
      return;
    }
    if (!parsedBuyAmount || parsedBuyAmount.amount < selectedBuyAsset.minAmount) {
      setBuyError(`Minimum amount is ${selectedBuyAsset.minAmount} ${selectedBuyAsset.symbol}.`);
      return;
    }
    if (!buyRecipientValid) {
      setBuyError('Select or enter a valid MetaMask (0x...) or native Xypher wallet address.');
      return;
    }
    if (!validateCoinTxHash(selectedBuyAsset.symbol, buyTxHash)) {
      setBuyError(
        `Enter a valid ${selectedBuyAsset.name} transaction hash (${selectedBuyAsset.txHashPlaceholder}).`
      );
      return;
    }

    setBuySubmitting(true);
    try {
      const res = await xypherApi.buyXyphWithCrypto({
        payCoin: selectedBuyAsset.symbol,
        payAmount: parsedBuyAmount.amount,
        depositTxHash: buyTxHash.trim(),
        recipientAddress: resolvedBuyRecipient,
        payerLabel: `${selectedBuyAsset.name} Buyer`,
      });
      setBuyReceipt(res.order);
      setBuyTxHash('');
      setSummary(res.summary);
      if (res.market) onMarketUpdated(res.market);
      onExchangeSettled(res.order);
      await loadExchangeData();
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : 'Crypto purchase verification failed');
    } finally {
      setBuySubmitting(false);
    }
  };

  // Swap calculations
  const parsedSwap = useMemo(() => {
    const amount = Number(swapAmountInput);
    if (!Number.isFinite(amount) || amount <= 0 || !selectedFromAsset || !selectedToAsset) {
      return null;
    }
    const usdValue = amount * selectedFromAsset.priceUsd;
    const inrValue = usdValue * usdToInr;
    const toAmount = selectedToAsset.priceUsd > 0 ? usdValue / selectedToAsset.priceUsd : 0;
    const rate =
      selectedToAsset.priceUsd > 0 ? selectedFromAsset.priceUsd / selectedToAsset.priceUsd : 0;
    return { amount, usdValue, inrValue, toAmount, rate };
  }, [swapAmountInput, selectedFromAsset, selectedToAsset, usdToInr]);

  const effectiveSwapXyphMode: 'local' | 'metamask' =
    swapXyphSourceMode === 'metamask' && mmAccount ? 'metamask' : 'local';
  const activeSwapXyphWallet = wallets.find((w) => w.address === swapXyphLocalAddr) || wallets[0];
  const swapXyphSenderAddr =
    effectiveSwapXyphMode === 'metamask' ? mmXyphAddress : activeSwapXyphWallet?.address || null;

  // All available XYPH sender wallets ranked by live spendable balance
  const swapXyphWalletOptions = useMemo(() => {
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

  const highestBalanceSwapWallet = useMemo(() => {
    if (swapXyphWalletOptions.length === 0) return null;
    return [...swapXyphWalletOptions].sort((a, b) => b.spendable - a.spendable)[0];
  }, [swapXyphWalletOptions]);

  // Auto-select the wallet with the highest spendable XYPH balance (e.g., active mining wallet)
  // unless the user manually picked a different source wallet.
  useEffect(() => {
    if (userPickedSwapWalletRef.current || !highestBalanceSwapWallet) return;
    if (highestBalanceSwapWallet.spendable <= 0) return;
    const currentCachedBal = swapXyphSenderAddr ? balances[swapXyphSenderAddr]?.spendable ?? 0 : 0;
    if (currentCachedBal < highestBalanceSwapWallet.spendable) {
      setSwapXyphSourceMode(highestBalanceSwapWallet.mode);
      if (highestBalanceSwapWallet.mode === 'local') {
        setSwapXyphLocalAddr(highestBalanceSwapWallet.address);
      }
    }
  }, [highestBalanceSwapWallet, swapXyphSenderAddr, balances]);

  // Keep the active swap/transfer sender's live on-chain balance fresh (picks up freshly mined blocks immediately)
  useEffect(() => {
    const needsLiveXyph =
      fromCoin === 'XYPH' || transferCoin === 'XYPH' || payoutOrder?.toCoin === 'XYPH';
    if (!needsLiveXyph || !swapXyphSenderAddr) {
      setLiveSwapSenderInfo(null);
      return;
    }
    let cancelled = false;
    void xypherApi
      .getAddress(swapXyphSenderAddr)
      .then((info) => {
        if (!cancelled) setLiveSwapSenderInfo(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fromCoin, transferCoin, payoutOrder?.toCoin, swapXyphSenderAddr, balances]);

  const swapXyphBalance = useMemo(() => {
    if (!swapXyphSenderAddr) return 0;
    if (liveSwapSenderInfo && liveSwapSenderInfo.address === swapXyphSenderAddr) {
      return liveSwapSenderInfo.spendable;
    }
    return balances[swapXyphSenderAddr]?.spendable ?? 0;
  }, [swapXyphSenderAddr, balances, liveSwapSenderInfo]);

  const handleSetSwapMax = () => {
    const maxUnits = Math.max(0, swapXyphBalance - NETWORK_FEE_UNITS);
    if (maxUnits <= 0) {
      setSwapAmountInput('0');
      return;
    }
    setSwapAmountInput(Number((maxUnits / UNIT).toFixed(4)).toString());
    setSwapError(null);
  };

  const handleFlipSwap = () => {
    const prevFrom = fromCoin;
    const prevTo = toCoin;
    setFromCoin(prevTo);
    setToCoin(prevFrom);
    setSwapError(null);
    setSwapReceipt(null);
    setSwapTokenDelivery(null);
    setSwapDepositTxHash('');
  };

  const quickFillRecipientForCoin = (coin: SupportedCoinSymbol, preferMetaMask = false) => {
    if (preferMetaMask && mmAccount) {
      setSwapRecipientInput(mmAccount);
      return;
    }
    if (coin === 'SOL' && phantomSolAccount && !preferMetaMask) {
      setSwapRecipientInput(phantomSolAccount);
      return;
    }
    if (mmAccount) {
      setSwapRecipientInput(mmAccount);
      return;
    }
    if (coin === 'XYPH' && wallets[0]) {
      setSwapRecipientInput(wallets[0].address);
    }
  };

  const handleSubmitSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwapError(null);
    setSwapReceipt(null);
    setSwapTokenDelivery(null);

    if (fromCoin === toCoin) {
      setSwapError('Select two different coins to swap.');
      return;
    }
    if (!parsedSwap || parsedSwap.amount < selectedFromAsset.minAmount) {
      setSwapError(`Minimum ${fromCoin} swap amount is ${selectedFromAsset.minAmount} ${fromCoin}.`);
      return;
    }
    if (!validateCoinRecipientOrMetaMask(toCoin, swapRecipientInput)) {
      setSwapError(
        `Enter your MetaMask (0x...) address for instant on-chain delivery, or a valid ${selectedToAsset.name} (${toCoin}) address (${selectedToAsset.addressPlaceholder}).`
      );
      return;
    }

    setSwapSubmitting(true);
    try {
      let depositHash = swapDepositTxHash.trim();

      // If swapping FROM XYPH, execute a real signed on-chain XYPH transfer to the XYPH Collection Vault!
      if (fromCoin === 'XYPH') {
        const amountUnits = parseXYPHToUnits(parsedSwap.amount.toFixed(8));
        const feeUnits = NETWORK_FEE_UNITS;
        const need = amountUnits + feeUnits;

        if (!swapXyphSenderAddr) {
          throw new Error('Select a local or connected XYPH wallet to swap from.');
        }

        // Always verify against the live on-chain balance so newly mined rewards are immediately spendable
        const freshAddr = await xypherApi.getAddress(swapXyphSenderAddr);
        setLiveSwapSenderInfo(freshAddr);

        if (freshAddr.spendable < need) {
          throw new Error(
            `Insufficient spendable XYPH balance on ${truncateHash(swapXyphSenderAddr, 8, 6)}: need ${formatXYPH(need, 4)} XYPH (includes ${NETWORK_FEE_XYPH} XYPH fee), have ${formatXYPH(freshAddr.spendable, 4)} XYPH.`
          );
        }

        if (effectiveSwapXyphMode === 'metamask') {
          if (!mmAccount) throw new Error('Connect MetaMask or Phantom before swapping XYPH.');
          depositHash = await sendXyphViaMetaMask({
            fromEvm: mmAccount,
            toEvm: selectedFromAsset.collectionAddress,
            amountUnits,
            publicBaseUrl,
          });
        } else {
          if (!activeSwapXyphWallet) {
            throw new Error('Select a local Xypher wallet to swap from.');
          }
          const coins = freshAddr.utxos
            .filter((u) => u.spendable)
            .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));
          const utxoSum = coins.reduce((acc, c) => acc + c.value, 0);
          const priv = wifToKey(activeSwapXyphWallet.wif);

          if (utxoSum >= need && freshAddr.spendable >= need && utxoSum <= freshAddr.spendable) {
            const signedTx = buildSignedTx(
              priv,
              coins,
              XYPH_COLLECTION_NATIVE_ADDRESS,
              amountUnits,
              feeUnits
            );
            const sub = await xypherApi.submitTx(signedTx);
            depositHash = sub.txid;
          } else {
            const { nonce } = await xypherApi.getBridgeNonce(activeSwapXyphWallet.address);
            const timestamp = Math.floor(Date.now() / 1000);
            const payload = `xypher-bridge-v1|${activeSwapXyphWallet.address}|${XYPH_COLLECTION_NATIVE_ADDRESS}|${amountUnits}|${feeUnits}|${nonce}|${timestamp}`;
            const sigHex = bytesToHex(signDigest(priv, sha256(utf8ToBytes(payload))));
            const sub = await xypherApi.submitBridgeTransfer({
              fromXyph: activeSwapXyphWallet.address,
              toAddress: XYPH_COLLECTION_NATIVE_ADDRESS,
              amountUnits,
              feeUnits,
              timestamp,
              pubHex: activeSwapXyphWallet.pubHex,
              sigHex,
            });
            depositHash = sub.txid;
          }
        }
      } else {
        if (!validateCoinTxHash(fromCoin, depositHash)) {
          throw new Error(
            `Enter a valid ${selectedFromAsset.name} deposit transaction hash (${selectedFromAsset.txHashPlaceholder}).`
          );
        }
      }

      const res = await xypherApi.createCryptoSwap({
        fromCoin,
        toCoin,
        fromAmount: parsedSwap.amount,
        depositTxHash: depositHash,
        recipientAddress: swapRecipientInput.trim(),
      });
      setSwapReceipt(res.order);
      setSwapTokenDelivery(res.tokenDelivery || null);
      setSwapDepositTxHash('');
      setSummary(res.summary);
      if (res.market) onMarketUpdated(res.market);
      onExchangeSettled(res.order);
      await loadMetaMaskTokens();
      await loadExchangeData();
    } catch (err) {
      setSwapError(formatWalletError(err));
    } finally {
      setSwapSubmitting(false);
    }
  };

  const filteredOrders = useMemo(() => {
    if (orderCoinFilter === 'ALL') return orders;
    return orders.filter((o) => o.fromCoin === orderCoinFilter || o.toCoin === orderCoinFilter);
  }, [orders, orderCoinFilter]);

  const buyPresets = useMemo(() => {
    const base = selectedBuyAsset?.minAmount ?? 0.01;
    const multipliers = [1, 5, 25, 100];
    return multipliers.map((m) => {
      const val = Number((base * m).toFixed(selectedBuyAsset?.decimals ?? 4));
      return String(val);
    });
  }, [selectedBuyAsset]);

  // Direct Multi-Wallet Transfer derived state
  const selectedTransferAsset = assetMap[transferCoin] || effectiveAssets[0];
  const activeTransferMmToken = transferCoin !== 'XYPH' ? mmTokenMap[transferCoin] : undefined;
  const parsedTransfer = useMemo(() => {
    const amount = Number(transferAmountInput);
    if (!Number.isFinite(amount) || amount <= 0 || !selectedTransferAsset) return null;
    const usdValue = amount * selectedTransferAsset.priceUsd;
    const inrValue = usdValue * usdToInr;
    return { amount, usdValue, inrValue };
  }, [transferAmountInput, selectedTransferAsset, usdToInr]);

  const transferAddrValid = validateCoinRecipientOrMetaMask(transferCoin, transferToInput);
  const canUseXyphErc20Transfer = Boolean(
    transferCoin !== 'XYPH' &&
      mmAccount &&
      activeTransferMmToken &&
      activeTransferMmToken.balanceNumeric > 0 &&
      isValidEvmAddress(transferToInput.trim()) &&
      (!parsedTransfer || activeTransferMmToken.balanceNumeric >= parsedTransfer.amount)
  );
  const transferWalletUri = useMemo(() => {
    if (!validateCoinAddress(transferCoin, transferToInput)) return '';
    return buildWalletTransferUri(transferCoin, transferToInput, parsedTransfer?.amount ?? 0);
  }, [transferCoin, transferToInput, parsedTransfer]);

  useEffect(() => {
    if (!transferWalletUri) {
      setTransferQrDataUrl('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(transferWalletUri, {
      width: 300,
      margin: 2,
      color: { dark: '#0B0E14', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setTransferQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTransferQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [transferWalletUri]);

  // Real Exchange Payout Dispatch QR for active payoutOrder modal (tracks editable destination wallet)
  const activePayoutRecipient = (payoutRecipientInput || payoutOrder?.recipientAddress || '').trim();
  const payoutRecipientValid = payoutOrder
    ? validateCoinRecipientOrMetaMask(payoutOrder.toCoin, activePayoutRecipient)
    : false;
  const payoutWalletUri = useMemo(() => {
    if (!payoutOrder || !validateCoinAddress(payoutOrder.toCoin, activePayoutRecipient)) return '';
    return buildWalletTransferUri(payoutOrder.toCoin, activePayoutRecipient, payoutOrder.toAmount);
  }, [payoutOrder, activePayoutRecipient]);

  useEffect(() => {
    if (!payoutWalletUri) {
      setPayoutQrDataUrl('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(payoutWalletUri, {
      width: 300,
      margin: 2,
      color: { dark: '#0B0E14', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setPayoutQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPayoutQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [payoutWalletUri]);

  // Execute a REAL on-chain XYPH transfer to any destination wallet address (0x... or native Base58Check)
  const executeRealXyphTransfer = async (
    toAddress: string,
    amountXyph: number
  ): Promise<{ txid: string; senderAddress: string; payoutMethod: 'onchain_xyph' | 'metamask_evm' }> => {
    const normalizedTo = normalizeToXypherAddress(toAddress.trim());
    if (!normalizedTo) {
      throw new Error('Enter a valid MetaMask (0x...) or native Xypher wallet address.');
    }
    const amountUnits = parseXYPHToUnits(amountXyph.toFixed(8));
    const feeUnits = NETWORK_FEE_UNITS;
    const need = amountUnits + feeUnits;

    if (!swapXyphSenderAddr) {
      throw new Error('Select a local or connected XYPH wallet to send from.');
    }

    // Step 1: Verify live sender wallet balance FIRST before signing or broadcasting
    const verification = await xypherApi.verifyTransferBalance({
      fromAddress: swapXyphSenderAddr,
      toAddress: normalizedTo,
      amountUnits,
      feeUnits,
    });
    const freshAddr = await xypherApi.getAddress(swapXyphSenderAddr);
    setLiveSwapSenderInfo(freshAddr);
    if (!verification.sufficient) {
      throw new Error(verification.message);
    }

    if (effectiveSwapXyphMode === 'metamask') {
      if (!mmAccount) throw new Error('Connect MetaMask or Phantom before transferring XYPH.');
      const toEvm = toAddress.trim().startsWith('0x')
        ? toAddress.trim()
        : xypherToEvmAddress(normalizedTo);
      const txid = await sendXyphViaMetaMask({
        fromEvm: mmAccount,
        toEvm,
        amountUnits,
        publicBaseUrl,
      });
      const updatedSender = await xypherApi.getAddress(swapXyphSenderAddr);
      setLiveSwapSenderInfo(updatedSender);
      return { txid, senderAddress: mmAccount, payoutMethod: 'metamask_evm' };
    }

    if (!activeSwapXyphWallet) {
      throw new Error('Select a local Xypher wallet to transfer from.');
    }
    const coins = freshAddr.utxos
      .filter((u) => u.spendable)
      .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));
    const utxoSum = coins.reduce((acc, c) => acc + c.value, 0);
    const priv = wifToKey(activeSwapXyphWallet.wif);

    if (utxoSum >= need && freshAddr.spendable >= need && utxoSum <= freshAddr.spendable) {
      const signedTx = buildSignedTx(priv, coins, normalizedTo, amountUnits, feeUnits);
      const sub = await xypherApi.submitTx(signedTx);
      const updatedSender = await xypherApi.getAddress(activeSwapXyphWallet.address);
      setLiveSwapSenderInfo(updatedSender);
      return { txid: sub.txid, senderAddress: activeSwapXyphWallet.address, payoutMethod: 'onchain_xyph' };
    }

    const { nonce } = await xypherApi.getBridgeNonce(activeSwapXyphWallet.address);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = `xypher-bridge-v1|${activeSwapXyphWallet.address}|${normalizedTo}|${amountUnits}|${feeUnits}|${nonce}|${timestamp}`;
    const sigHex = bytesToHex(signDigest(priv, sha256(utf8ToBytes(payload))));
    const sub = await xypherApi.submitBridgeTransfer({
      fromXyph: activeSwapXyphWallet.address,
      toAddress: normalizedTo,
      amountUnits,
      feeUnits,
      timestamp,
      pubHex: activeSwapXyphWallet.pubHex,
      sigHex,
    });
    const updatedSender = await xypherApi.getAddress(activeSwapXyphWallet.address);
    setLiveSwapSenderInfo(updatedSender);
    return { txid: sub.txid, senderAddress: activeSwapXyphWallet.address, payoutMethod: 'onchain_xyph' };
  };

  // Submit Direct Real Transfer to Any Wallet (all 9 coins)
  const handleDirectAnyWalletTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);
    setTransferReceipt(null);

    if (!parsedTransfer || parsedTransfer.amount <= 0) {
      setTransferError(`Enter a positive ${transferCoin} amount to transfer.`);
      return;
    }
    if (!transferAddrValid) {
      setTransferError(
        `Enter a valid ${selectedTransferAsset.name} (${transferCoin}) wallet address (${selectedTransferAsset.addressPlaceholder}).`
      );
      return;
    }

    // 1. Native XYPH on-chain transfer
    if (transferCoin === 'XYPH') {
      setTransferSubmitting(true);
      try {
        const { txid, senderAddress, payoutMethod } = await executeRealXyphTransfer(
          transferToInput,
          parsedTransfer.amount
        );
        const rec = await xypherApi.recordCryptoTransfer({
          coin: 'XYPH',
          amount: parsedTransfer.amount,
          txHash: txid,
          recipientAddress: transferToInput.trim(),
          senderAddress,
          payoutMethod,
        });
        setTransferReceipt(rec.order);
        setSummary(rec.summary);
        onExchangeSettled(rec.order);
        await loadExchangeData();
      } catch (err) {
        setTransferError(formatWalletError(err));
      } finally {
        setTransferSubmitting(false);
      }
      return;
    }

    // 2. If user already pasted an external confirmed tx hash (e.g. BTC / XLM / Ledger / Trust Wallet), verify & log it
    const pastedHash = transferExternalTxHash.trim();
    if (pastedHash) {
      if (!validateCoinTxHash(transferCoin, pastedHash)) {
        setTransferError(
          `Enter a valid ${selectedTransferAsset.name} transaction hash (${selectedTransferAsset.txHashPlaceholder}).`
        );
        return;
      }
      setTransferSubmitting(true);
      try {
        const rec = await xypherApi.recordCryptoTransfer({
          coin: transferCoin,
          amount: parsedTransfer.amount,
          txHash: pastedHash,
          recipientAddress: transferToInput.trim(),
          payoutMethod: 'external_wallet',
        });
        setTransferReceipt(rec.order);
        setTransferExternalTxHash('');
        setSummary(rec.summary);
        onExchangeSettled(rec.order);
        await loadExchangeData();
      } catch (err) {
        setTransferError(formatWalletError(err));
      } finally {
        setTransferSubmitting(false);
      }
      return;
    }

    // 3. Direct zero-gas MetaMask ERC-20 transfer on XYPH Network when sending exchanged crypto balance to a 0x... wallet
    if (
      mmAccount &&
      activeTransferMmToken &&
      activeTransferMmToken.balanceNumeric >= parsedTransfer.amount &&
      isValidEvmAddress(transferToInput.trim())
    ) {
      setTransferSubmitting(true);
      try {
        const txHash = await sendXyphNetworkTokenViaMetaMask({
          symbol: transferCoin,
          contractAddress: activeTransferMmToken.contractAddress,
          decimals: activeTransferMmToken.decimals,
          fromEvm: mmAccount,
          toEvm: transferToInput.trim(),
          amount: parsedTransfer.amount,
          publicBaseUrl,
        });
        const rec = await xypherApi.recordCryptoTransfer({
          coin: transferCoin,
          amount: parsedTransfer.amount,
          txHash,
          recipientAddress: transferToInput.trim(),
          senderAddress: mmAccount,
          payoutMethod: 'metamask_evm',
        });
        setTransferReceipt(rec.order);
        setSummary(rec.summary);
        onExchangeSettled(rec.order);
        await loadMetaMaskTokens(mmAccount);
        await loadExchangeData();
      } catch (err) {
        setTransferError(formatWalletError(err));
      } finally {
        setTransferSubmitting(false);
      }
      return;
    }

    // 4. Direct real external browser-wallet execution for ETH / BNB / POL / MON (MetaMask/Phantom), SOL (Phantom), TRX (TronLink)
    if (isDirectEvmCoin(transferCoin) || transferCoin === 'SOL' || transferCoin === 'TRX') {
      await handleDirectWalletSend(
        transferCoin,
        transferToInput.trim(),
        parsedTransfer.amount,
        async ({ txHash, senderAddress, payoutMethod }) => {
          const rec = await xypherApi.recordCryptoTransfer({
            coin: transferCoin,
            amount: parsedTransfer.amount,
            txHash,
            recipientAddress: transferToInput.trim(),
            senderAddress,
            payoutMethod,
          });
          setTransferReceipt(rec.order);
          setSummary(rec.summary);
          onExchangeSettled(rec.order);
          await loadExchangeData();
        },
        setTransferError,
        setTransferSubmitting
      );
      return;
    }

    setTransferError(
      `Scan the ${selectedTransferAsset.name} QR code or click "Open ${selectedTransferAsset.name} Wallet App" to broadcast the real transfer, then paste the transaction hash above.`
    );
  };

  // Settle a pending exchange swap order with a REAL wallet payout transfer
  const openPayoutModal = (order: CryptoExchangeOrder) => {
    setPayoutOrder(order);
    const defaultAddr =
      order.toCoin !== 'XYPH' && !isValidEvmAddress(order.recipientAddress) && mmAccount
        ? mmAccount
        : order.recipientAddress;
    setPayoutRecipientInput(defaultAddr);
    setPayoutTxHashInput(defaultAddr);
    setPayoutError(null);
    setPayoutSuccessMsg(null);
    setPayoutTokenDelivery(null);
  };

  const finalizePayoutOrder = async (
    order: CryptoExchangeOrder,
    txHash: string | undefined,
    destinationAddress: string,
    senderAddress?: string,
    payoutMethod: CryptoExchangeOrder['payoutMethod'] = 'external_wallet'
  ) => {
    const cleanHash = (txHash || '').trim();
    const res = await xypherApi.settleExchangePayout(order.id, {
      ...(cleanHash ? { payoutTxHash: cleanHash } : {}),
      recipientAddress: destinationAddress,
      senderAddress,
      payoutMethod,
    });
    setSummary(res.summary);
    setOrders((prev) => prev.map((o) => (o.id === res.order.id ? res.order : o)));
    if (swapReceipt && swapReceipt.id === res.order.id) {
      setSwapReceipt(res.order);
      if (res.tokenDelivery) setSwapTokenDelivery(res.tokenDelivery);
    }
    setPayoutOrder(res.order);
    setPayoutRecipientInput(res.order.recipientAddress);
    setPayoutTxHashInput('');
    setPayoutTokenDelivery(res.tokenDelivery || null);
    setPayoutSuccessMsg(
      res.tokenDelivery
        ? `Delivered ${formatCoinAmount(res.tokenDelivery.amount, res.tokenDelivery.symbol)} ${res.tokenDelivery.symbol} on-chain to ${truncateHash(res.tokenDelivery.toEvm, 10, 6)} (Block #${res.tokenDelivery.blockHeight} · New ${res.tokenDelivery.symbol} balance: ${res.tokenDelivery.balanceAfter}). Click "Add ${res.tokenDelivery.symbol} to ${activeWalletLabel}" below to display it in your wallet.`
        : res.accounting
        ? `Balance updated on-chain: +${formatXYPH(res.accounting.amountUnits, 4)} ${SYMBOL} added to ${truncateHash(res.order.recipientAddress, 10, 6)} (New balance: ${formatXYPH(res.accounting.receiverAfter, 4)} ${SYMBOL}).`
        : cleanHash
        ? res.verifiedOnChain
          ? `Real transfer verified on-chain & completed to ${truncateHash(res.order.recipientAddress, 10, 6)} (${truncateHash(cleanHash, 10, 6)}).`
          : `Real transfer broadcast & settled to ${truncateHash(res.order.recipientAddress, 10, 6)} (${truncateHash(cleanHash, 10, 6)}).`
        : `Payout wallet address verified & completed to ${truncateHash(res.order.recipientAddress, 12, 8)}.`
    );
    onExchangeSettled(res.order);
    await loadMetaMaskTokens();
    await loadExchangeData();
  };

  const handleDirectPayoutBroadcast = async () => {
    if (!payoutOrder) return;
    setPayoutError(null);
    setPayoutSuccessMsg(null);
    setPayoutTokenDelivery(null);

    const targetAddr = activePayoutRecipient;
    const def = SUPPORTED_COIN_MAP[payoutOrder.toCoin];
    if (!validateCoinRecipientOrMetaMask(payoutOrder.toCoin, targetAddr)) {
      setPayoutError(
        `Enter your MetaMask (0x...) address or a valid ${def.name} (${payoutOrder.toCoin}) wallet address (${def.addressPlaceholder}).`
      );
      return;
    }

    if (payoutOrder.toCoin === 'XYPH') {
      setPayoutSubmitting(true);
      try {
        const { txid, senderAddress, payoutMethod } = await executeRealXyphTransfer(
          targetAddr,
          payoutOrder.toAmount
        );
        await finalizePayoutOrder(payoutOrder, txid, targetAddr, senderAddress, payoutMethod);
      } catch (err) {
        setPayoutError(formatWalletError(err));
      } finally {
        setPayoutSubmitting(false);
      }
      return;
    }

    // If destination is a MetaMask 0x... address, deliver the REAL exchanged ERC-20 token balance
    // directly on-chain on XYPH Network (0 gas, immediately visible in MetaMask!).
    if (isValidEvmAddress(targetAddr)) {
      setPayoutSubmitting(true);
      try {
        await handleClaimOrderToMetaMask(payoutOrder, targetAddr);
      } finally {
        setPayoutSubmitting(false);
      }
      return;
    }

    await handleDirectWalletSend(
      payoutOrder.toCoin,
      targetAddr,
      payoutOrder.toAmount,
      async ({ txHash, senderAddress, payoutMethod }) => {
        await finalizePayoutOrder(payoutOrder, txHash, targetAddr, senderAddress, payoutMethod);
      },
      setPayoutError,
      setPayoutSubmitting
    );
  };

  const handleManualPayoutConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutOrder) return;
    setPayoutError(null);
    setPayoutSuccessMsg(null);
    setPayoutTokenDelivery(null);

    const enteredWallet = payoutTxHashInput.trim();
    const def = SUPPORTED_COIN_MAP[payoutOrder.toCoin];
    if (!validateCoinRecipientOrMetaMask(payoutOrder.toCoin, enteredWallet)) {
      setPayoutError(
        `Enter a valid MetaMask (0x...) or ${def.name} (${payoutOrder.toCoin}) wallet address — do not enter a transaction hash.`
      );
      return;
    }
    setPayoutRecipientInput(enteredWallet);
    setPayoutSubmitting(true);
    try {
      await finalizePayoutOrder(
        payoutOrder,
        undefined,
        enteredWallet,
        undefined,
        isValidEvmAddress(enteredWallet) ? 'metamask_evm' : 'external_wallet'
      );
    } catch (err) {
      setPayoutError(formatWalletError(err));
    } finally {
      setPayoutSubmitting(false);
    }
  };

  const pendingPayoutList = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.status === 'pending_payout' ||
          (o.kind !== 'transfer' &&
            o.toCoin !== 'XYPH' &&
            !o.payoutVerifiedOnChain &&
            !o.metamaskDelivered)
      ),
    [orders]
  );

  return (
    <div className="space-y-6">
      {/* Top Exchange Header & KPI Strip */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#222A38] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center -space-x-1.5">
                {(['ETH', 'SOL', 'BTC', 'TRX', 'BNB', 'POL', 'MON', 'XLM', 'XYPH'] as SupportedCoinSymbol[]).map(
                  (sym) => (
                    <CoinLogo key={sym} symbol={sym} size={22} className="ring-2 ring-[#121721]" />
                  )
                )}
              </div>
              <h2 className="text-base font-semibold text-[#E6EDF3]">
                Multi-Crypto Exchange &amp; Buy {SYMBOL}
              </h2>
            </div>
            <p className="text-xs text-[#8B98A8]">
              Exchange across Ethereum, Solana, Bitcoin, Tron, BNB, POL, MON, XLM, and Xypher — every crypto buy &amp; swap is collected into its verified coin vault address.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#0B0E14] border border-[#1E2533] rounded-md">
              <button
                type="button"
                onClick={() => setSubTab('buy_crypto')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  subTab === 'buy_crypto'
                    ? 'bg-[#1D2534] text-emerald-400'
                    : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                }`}
              >
                Buy {SYMBOL} with Crypto
              </button>
              <button
                type="button"
                onClick={() => setSubTab('swap')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  subTab === 'swap'
                    ? 'bg-[#1D2534] text-amber-400'
                    : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                }`}
              >
                Swap Coins
              </button>
              <button
                type="button"
                onClick={() => setSubTab('transfer')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  subTab === 'transfer'
                    ? 'bg-[#1D2534] text-sky-400'
                    : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                }`}
              >
                Transfer to Any Wallet
              </button>
              <button
                type="button"
                onClick={() => setSubTab('vaults')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  subTab === 'vaults'
                    ? 'bg-[#1D2534] text-[#E6EDF3]'
                    : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                }`}
              >
                Collection Vaults (9)
              </button>
            </div>
            <button
              type="button"
              onClick={() => void loadExchangeData(true)}
              disabled={refreshing}
              title="Refresh live rates and vault totals"
              className="p-2 text-[#8B98A8] hover:text-[#E6EDF3] bg-[#0B0E14] border border-[#1E2533] rounded-md cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 4-Column KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#1D2432] text-xs">
          <div className="p-3.5 px-5">
            <div className="text-[#8B98A8]">Supported Exchange Coins</div>
            <div className="mt-1 font-mono text-base font-semibold text-[#E6EDF3] tabular-nums">
              9 Assets
            </div>
            <div className="text-[11px] text-[#6B7788]">
              ETH · SOL · BTC · TRX · BNB · POL · MON · XLM · XYPH
            </div>
          </div>
          <div className="p-3.5 px-5">
            <div className="text-[#8B98A8]">Total Collected in Vaults</div>
            <div className="mt-1 font-mono text-base font-semibold text-emerald-400 tabular-nums">
              ${(summary?.totalCollectedUsd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] font-mono text-[#6B7788] tabular-nums">
              ≈ ₹{((summary?.totalCollectedUsd ?? 0) * usdToInr).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="p-3.5 px-5">
            <div className="text-[#8B98A8]">{SYMBOL} Credited via Crypto</div>
            <div className="mt-1 font-mono text-base font-semibold text-amber-400 tabular-nums">
              {(summary?.totalXyphDisbursed ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} {SYMBOL}
            </div>
            <div className="text-[11px] text-[#6B7788]">Settled automatically on-chain</div>
          </div>
          <div className="p-3.5 px-5">
            <div className="text-[#8B98A8]">Exchange Transactions</div>
            <div className="mt-1 font-mono text-base font-semibold text-[#E6EDF3] tabular-nums">
              {(summary?.totalOrders ?? 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-[#6B7788]">
              {summary?.completedOrders ?? 0} completed · {summary?.pendingPayoutOrders ?? 0} pending payout
            </div>
          </div>
        </div>
      </div>

      {/* MetaMask Exchanged Crypto Portfolio (XYPH Network ERC-20 Live Balances) */}
      {mmAccount && (
        <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#222A38] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#E6EDF3]">
              <Wallet className="w-3.5 h-3.5 text-amber-400" />
              Your {activeWalletLabel} Exchanged Crypto Balances (XYPH Network)
              <span className="font-mono text-[11px] font-normal text-[#8B98A8]">
                · {truncateHash(mmAccount, 8, 6)}
              </span>
            </div>
            <div className="text-[11px] text-[#8B98A8]">
              Click &ldquo;Add to {activeWalletLabel}&rdquo; on any asset to display its real on-chain balance inside {activeWalletLabel}
            </div>
          </div>

          {heldMmTokens.length > 0 ? (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {heldMmTokens.map((tok) => (
                <div
                  key={tok.symbol}
                  className="p-3 rounded-md bg-[#0B0E14] border border-emerald-500/25 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CoinLogo symbol={tok.symbol} size={24} />
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-emerald-400 tabular-nums truncate">
                        {tok.balanceFormatted} {tok.symbol}
                      </div>
                      <div className="text-[10px] font-mono text-[#6B7788] truncate">
                        {truncateHash(tok.contractAddress, 6, 4)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={watchingSymbol === tok.symbol}
                    onClick={() =>
                      void handleWatchTokenInMetaMask(tok.symbol, tok.contractAddress, tok.decimals)
                    }
                    className="px-2 py-1 text-[11px] font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {watchingSymbol === tok.symbol ? 'Adding...' : `Add to ${activeWalletLabel}`}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-3 text-xs text-[#8B98A8]">
              No exchanged ERC-20 tokens credited to {truncateHash(mmAccount, 8, 6)} yet. Swap {SYMBOL} to any crypto using your {activeWalletLabel} (0x...) address — or click &ldquo;Transfer to {activeWalletLabel}&rdquo; on an order below.
            </div>
          )}

          {claimNotice && (
            <div className="mx-5 mb-3 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                {claimNotice}
              </span>
              <button
                type="button"
                onClick={() => setClaimNotice(null)}
                className="text-emerald-300/70 hover:text-emerald-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {claimError && (
            <div className="mx-5 mb-3 p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300 flex items-center justify-between gap-2">
              <span>{claimError}</span>
              <button
                type="button"
                onClick={() => setClaimError(null)}
                className="text-red-300/70 hover:text-red-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pending / Uncredited Exchange Transfers Quick-Dispatch Strip */}
      {pendingPayoutList.length > 0 && (
        <div className="border border-amber-500/35 rounded-lg bg-[#121721] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#222A38] flex flex-wrap items-center justify-between gap-2 bg-amber-500/5">
            <div className="text-xs font-semibold text-amber-300">
              Exchanged Crypto Ready to Deliver to {activeWalletLabel} ({pendingPayoutList.length})
            </div>
            <div className="text-[11px] text-[#8B98A8]">
              Transfer your swapped crypto on-chain straight into your {activeWalletLabel} wallet (0 gas on XYPH Network)
            </div>
          </div>
          <div className="divide-y divide-[#1D2432]">
            {pendingPayoutList.slice(0, 6).map((ord) => (
              <div
                key={ord.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CoinLogo symbol={ord.fromCoin} size={20} />
                  <span className="font-mono text-[#C9D3DF] tabular-nums">
                    {formatCoinAmount(ord.fromAmount, ord.fromCoin)} {ord.fromCoin}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <CoinLogo symbol={ord.toCoin} size={20} />
                  <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                    {formatCoinAmount(ord.toAmount, ord.toCoin)} {ord.toCoin}
                  </span>
                  <span className="text-[#6B7788] font-mono truncate hidden md:inline">
                    · {ord.id}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {ord.toCoin !== 'XYPH' && (
                    <button
                      type="button"
                      disabled={claimingOrderId === ord.id}
                      onClick={() => void handleClaimOrderToMetaMask(ord)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0B0E14] bg-emerald-400 rounded hover:bg-emerald-300 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      {claimingOrderId === ord.id
                        ? 'Transferring...'
                        : `Transfer ${ord.toCoin} to ${activeWalletLabel}`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openPayoutModal(ord)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1D2534] border border-[#2A3446] rounded hover:border-amber-500/50 whitespace-nowrap cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 text-amber-400" />
                    Other Wallet
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODE 1: BUY XYPH WITH ANY SUPPORTED CRYPTO */}
      {subTab === 'buy_crypto' && selectedBuyAsset && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Coin Selector + Purchase Form */}
          <form
            onSubmit={handleSubmitBuyWithCrypto}
            className="lg:col-span-7 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5"
          >
            <div>
              <h3 className="text-sm font-semibold text-[#E6EDF3]">
                1. Choose Coin to Buy {SYMBOL}
              </h3>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Select any of the 8 supported cryptocurrencies. Your payment is collected directly into its verified collection wallet address.
              </p>
            </div>

            {/* 8-Coin Selector Grid with Official Logos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {EXTERNAL_PAYMENT_COINS.map((coinDef) => {
                const live = assetMap[coinDef.symbol];
                const isSelected = buyCoin === coinDef.symbol;
                return (
                  <button
                    key={coinDef.symbol}
                    type="button"
                    onClick={() => {
                      setBuyCoin(coinDef.symbol);
                      setBuyAmountInput(String(coinDef.minAmount * 5));
                      setBuyError(null);
                      setBuyReceipt(null);
                    }}
                    className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#1A2232] border-amber-500/70'
                        : 'bg-[#0B0E14] border-[#1E2533] hover:border-[#2F3B52]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <CoinLogo symbol={coinDef.symbol} size={26} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#E6EDF3] truncate">
                          {coinDef.symbol}
                        </div>
                        <div className="text-[11px] text-[#8B98A8] truncate">{coinDef.name}</div>
                      </div>
                    </div>
                    <div className="mt-2 font-mono text-[11px] text-[#9AA6B6] tabular-nums">
                      ${live ? live.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 }) : coinDef.fallbackUsdPrice}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Amount & Live XYPH Quote */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[#9AA6B6]">
                    Pay Amount ({selectedBuyAsset.symbol})
                  </label>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8B98A8]">
                    {buyPresets.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setBuyAmountInput(p)}
                        className="hover:text-amber-400 cursor-pointer"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={buyAmountInput}
                  onChange={(e) => setBuyAmountInput(e.target.value)}
                  placeholder={String(selectedBuyAsset.minAmount)}
                  className="w-full px-3 py-2.5 text-sm font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
                />
                <p className="mt-1 text-[11px] text-[#6B7788] font-mono tabular-nums">
                  {parsedBuyAmount
                    ? `≈ $${parsedBuyAmount.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD · ₹${parsedBuyAmount.inrValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} INR`
                    : `Min: ${selectedBuyAsset.minAmount} ${selectedBuyAsset.symbol}`}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                  You Receive ({SYMBOL})
                </label>
                <div className="px-3 py-2.5 rounded-md bg-[#0B0E14] border border-emerald-500/30 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <CoinLogo symbol="XYPH" size={20} />
                    <span className="font-mono text-sm font-semibold text-emerald-400 tabular-nums truncate">
                      {parsedBuyAmount
                        ? parsedBuyAmount.xyphEstimate.toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })
                        : '0.0000'}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-[#8B98A8] shrink-0">{SYMBOL}</span>
                </div>
                <p className="mt-1 text-[11px] text-[#6B7788] font-mono tabular-nums">
                  1 {selectedBuyAsset.symbol} ≈{' '}
                  {selectedBuyAsset.xyphPerCoin.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                  {SYMBOL}
                </p>
              </div>
            </div>

            {/* Destination XYPH Wallet */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-[#9AA6B6]">
                  2. Receive {SYMBOL} Into Wallet
                </label>
                <div className="inline-flex items-center gap-1 p-0.5 bg-[#0B0E14] border border-[#1E2533] rounded text-[11px]">
                  <button
                    type="button"
                    onClick={() => setBuyDestType('metamask')}
                    className={`px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                      buyDestType === 'metamask'
                        ? 'bg-[#1D2534] text-amber-400 font-medium'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    {mmAccount ? `${activeWalletLabel} 0x` : 'MetaMask / Phantom'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuyDestType('local')}
                    className={`px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                      buyDestType === 'local'
                        ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    Local Wallet
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuyDestType('custom')}
                    className={`px-2 py-1 rounded cursor-pointer whitespace-nowrap ${
                      buyDestType === 'custom'
                        ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    Custom Address
                  </button>
                </div>
              </div>

              {buyDestType === 'metamask' ? (
                mmAccount ? (
                  <div className="px-3 py-2.5 rounded-md bg-[#0B0E14] border border-[#2A3446] font-mono text-xs text-[#E6EDF3] break-all">
                    {mmAccount}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onConnectMetaMask()}
                      disabled={mmBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 cursor-pointer disabled:opacity-50"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Connect MetaMask
                    </button>
                    <button
                      type="button"
                      onClick={() => void onConnectPhantom()}
                      disabled={mmBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-violet-600 rounded hover:bg-violet-500 cursor-pointer disabled:opacity-50"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      Connect Phantom
                    </button>
                  </div>
                )
              ) : buyDestType === 'local' ? (
                <select
                  value={buyLocalAddr}
                  onChange={(e) => setBuyLocalAddr(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.address}>
                      {w.label} · {truncateHash(w.address, 10, 6)} ({formatXYPH(balances[w.address]?.spendable ?? 0, 2)} {SYMBOL})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={buyCustomAddr}
                  onChange={(e) => setBuyCustomAddr(e.target.value)}
                  placeholder="Paste MetaMask 0x... or native Xypher Base58Check address"
                  spellCheck={false}
                  className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                />
              )}
            </div>

            {/* Transaction Hash Input + 1-Click Direct EVM Pay */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-[#9AA6B6]">
                  3. {selectedBuyAsset.name} Payment Transaction Hash
                </label>
                {parsedBuyAmount &&
                  (isDirectEvmCoin(selectedBuyAsset.symbol) ||
                    selectedBuyAsset.symbol === 'SOL' ||
                    (selectedBuyAsset.symbol === 'TRX' && isTronLinkAvailable())) && (
                    <button
                      type="button"
                      disabled={buyWalletPaying}
                      onClick={() =>
                        void handleDirectEvmPay(
                          selectedBuyAsset,
                          parsedBuyAmount.amount,
                          (h) => setBuyTxHash(h),
                          setBuyError
                        )
                      }
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 cursor-pointer disabled:opacity-50"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {buyWalletPaying
                        ? 'Confirm in Wallet...'
                        : selectedBuyAsset.symbol === 'SOL'
                        ? `Pay ${parsedBuyAmount.amount} SOL via Phantom`
                        : selectedBuyAsset.symbol === 'TRX'
                        ? `Pay ${parsedBuyAmount.amount} TRX via TronLink`
                        : `Pay ${parsedBuyAmount.amount} ${selectedBuyAsset.symbol} via ${activeWalletLabel}`}
                    </button>
                  )}
              </div>
              <input
                type="text"
                value={buyTxHash}
                onChange={(e) => setBuyTxHash(e.target.value)}
                placeholder={selectedBuyAsset.txHashPlaceholder}
                spellCheck={false}
                className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
              />
              <p className="text-[11px] text-[#6B7788]">
                Send {selectedBuyAsset.symbol} to the exact verified collection address shown on the right, then paste the confirmed transaction hash to credit {SYMBOL} automatically.
              </p>
            </div>

            {buyError && (
              <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
                {buyError}
              </div>
            )}

            {buyReceipt && (
              <div className="p-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Collected {buyReceipt.fromAmount} {buyReceipt.fromCoin} · Credited{' '}
                  {buyReceipt.toAmount.toLocaleString()} {SYMBOL} to your wallet
                </div>
                <div className="text-[#C9D3DF] font-mono break-all">
                  Vault Address: {buyReceipt.collectionAddress}
                </div>
                {buyReceipt.settlementTxid && (
                  <button
                    type="button"
                    onClick={() => onInspectTx(buyReceipt.settlementTxid!)}
                    className="text-amber-400 hover:underline font-medium cursor-pointer"
                  >
                    Inspect On-Chain {SYMBOL} Credit ({truncateHash(buyReceipt.settlementTxid, 10, 6)})
                  </button>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-[#1D2432] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-xs text-[#8B98A8]">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                Stored in verified {selectedBuyAsset.symbol} vault · Instant on-chain {SYMBOL} credit
              </div>
              <button
                type="submit"
                disabled={buySubmitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#0B0E14] bg-emerald-400 rounded-md hover:bg-emerald-300 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {buySubmitting ? 'Crediting XYPH...' : `Confirm ${selectedBuyAsset.symbol} & Credit ${SYMBOL}`}
              </button>
            </div>
          </form>

          {/* Right: Verified Collection Vault Card & QR for Selected Coin */}
          <div className="lg:col-span-5 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5">
            <div className="flex items-center justify-between gap-3 border-b border-[#1D2432] pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <CoinLogo symbol={selectedBuyAsset.symbol} size={36} />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#E6EDF3] truncate">
                    {selectedBuyAsset.name} ({selectedBuyAsset.symbol}) Collection Vault
                  </h3>
                  <p className="text-xs text-[#8B98A8] truncate">
                    {selectedBuyAsset.network} · {selectedBuyAsset.standard}
                  </p>
                </div>
              </div>
            </div>

            {/* QR Code Container */}
            <div className="flex flex-col items-center justify-center p-4 rounded-md bg-[#0B0E14] border border-[#1E2533] space-y-3">
              {qrDataUrls[selectedBuyAsset.symbol] ? (
                <button
                  type="button"
                  onClick={() => setQrModalAsset(selectedBuyAsset)}
                  className="group relative rounded-md bg-white p-2.5 cursor-pointer"
                  title="Click to zoom deposit QR code"
                >
                  <img
                    src={qrDataUrls[selectedBuyAsset.symbol]}
                    alt={`${selectedBuyAsset.name} deposit QR`}
                    className="w-44 h-44 object-contain"
                  />
                  <span className="mt-1.5 flex items-center justify-center gap-1 text-[11px] font-medium text-[#0B0E14]">
                    <ZoomIn className="w-3 h-3" />
                    Tap to zoom QR
                  </span>
                </button>
              ) : (
                <div className="w-44 h-44 flex items-center justify-center text-xs text-[#6B7788]">
                  Generating QR...
                </div>
              )}

              <div className="w-full space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-[#8B98A8]">
                  <span>Verified {selectedBuyAsset.addressFormatLabel}</span>
                  <button
                    type="button"
                    onClick={() => copyText(selectedBuyAsset.collectionAddress, `vault-${selectedBuyAsset.symbol}`)}
                    className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                  >
                    {copiedKey === `vault-${selectedBuyAsset.symbol}` ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy Address
                      </>
                    )}
                  </button>
                </div>
                <div className="p-2.5 rounded bg-[#121721] border border-[#222A38] font-mono text-xs text-[#E6EDF3] break-all select-all">
                  {selectedBuyAsset.collectionAddress}
                </div>
              </div>
            </div>

            {/* Vault Stats */}
            <div className="space-y-2.5 text-xs border-t border-[#1D2432] pt-4">
              <div className="flex justify-between">
                <span className="text-[#8B98A8]">Live {selectedBuyAsset.symbol} Price</span>
                <span className="font-mono text-[#E6EDF3] tabular-nums">
                  ${selectedBuyAsset.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })} (₹
                  {selectedBuyAsset.priceInr.toLocaleString(undefined, { maximumFractionDigits: 2 })})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B98A8]">Collected in Vault</span>
                <span className="font-mono text-emerald-400 tabular-nums">
                  {formatCoinAmount(selectedBuyAsset.totalCollectedAmount, selectedBuyAsset.symbol)}{' '}
                  {selectedBuyAsset.symbol} ({selectedBuyAsset.collectedTxCount} tx)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B98A8]">Minimum Deposit</span>
                <span className="font-mono text-[#C9D3DF] tabular-nums">
                  {selectedBuyAsset.minAmount} {selectedBuyAsset.symbol}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: SWAP / EXCHANGE ACROSS ALL 9 COINS */}
      {subTab === 'swap' && selectedFromAsset && selectedToAsset && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSubmitSwap}
            className="lg:col-span-7 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5"
          >
            <div>
              <h3 className="text-sm font-semibold text-[#E6EDF3]">
                Exchange Any Supported Coin
              </h3>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Swap {SYMBOL} into ETH, SOL, BTC, TRX, BNB, POL, MON, or XLM — or swap any external coin directly into {SYMBOL} or another coin.
              </p>
            </div>

            {/* From Coin / Flip / To Coin */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-5">
                  <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                    You Send (From Coin)
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#0B0E14] border border-[#2A3446]">
                    <CoinLogo symbol={fromCoin} size={22} />
                    <select
                      value={fromCoin}
                      onChange={(e) => {
                        const next = e.target.value as SupportedCoinSymbol;
                        if (next === toCoin) setToCoin(fromCoin);
                        setFromCoin(next);
                        setSwapError(null);
                      }}
                      className="w-full bg-transparent text-xs font-semibold text-[#E6EDF3] focus:outline-none cursor-pointer"
                    >
                      {SUPPORTED_EXCHANGE_COINS.map((c) => (
                        <option key={c.symbol} value={c.symbol} className="bg-[#0B0E14] text-[#E6EDF3]">
                          {c.symbol} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="sm:col-span-2 flex justify-center">
                  <button
                    type="button"
                    onClick={handleFlipSwap}
                    title="Reverse swap direction"
                    className="p-2.5 rounded-md bg-[#1B2230] border border-[#2A3446] text-amber-400 hover:bg-[#232C3D] cursor-pointer"
                  >
                    <ArrowDownUp className="w-4 h-4" />
                  </button>
                </div>

                <div className="sm:col-span-5">
                  <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                    You Receive (To Coin)
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#0B0E14] border border-[#2A3446]">
                    <CoinLogo symbol={toCoin} size={22} />
                    <select
                      value={toCoin}
                      onChange={(e) => {
                        const next = e.target.value as SupportedCoinSymbol;
                        if (next === fromCoin) setFromCoin(toCoin);
                        setToCoin(next);
                        setSwapError(null);
                      }}
                      className="w-full bg-transparent text-xs font-semibold text-[#E6EDF3] focus:outline-none cursor-pointer"
                    >
                      {SUPPORTED_EXCHANGE_COINS.map((c) => (
                        <option key={c.symbol} value={c.symbol} className="bg-[#0B0E14] text-[#E6EDF3]">
                          {c.symbol} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Swap Amounts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="block text-xs font-medium text-[#9AA6B6]">
                      Amount to Send ({fromCoin})
                    </label>
                    {fromCoin === 'XYPH' && (
                      <button
                        type="button"
                        onClick={handleSetSwapMax}
                        className="text-xs text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                      >
                        Swap Max
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={swapAmountInput}
                    onChange={(e) => {
                      setSwapAmountInput(e.target.value);
                      if (swapError) setSwapError(null);
                    }}
                    placeholder={String(selectedFromAsset.minAmount)}
                    className="w-full px-3 py-2.5 text-sm font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
                  />
                  {fromCoin === 'XYPH' && (
                    <p className="mt-1 text-[11px] font-mono text-[#8B98A8] tabular-nums">
                      Spendable: {formatXYPH(swapXyphBalance, 4)} {SYMBOL} · Max swap:{' '}
                      {formatXYPH(Math.max(0, swapXyphBalance - NETWORK_FEE_UNITS), 4)} {SYMBOL} ({NETWORK_FEE_XYPH}{' '}
                      {SYMBOL} fee)
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                    Estimated Output ({toCoin})
                  </label>
                  <div className="px-3 py-2.5 rounded-md bg-[#0B0E14] border border-emerald-500/30 flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-emerald-400 tabular-nums truncate">
                      {parsedSwap ? formatCoinAmount(parsedSwap.toAmount, toCoin) : '0'}
                    </span>
                    <span className="text-xs font-mono text-[#8B98A8] shrink-0">{toCoin}</span>
                  </div>
                </div>
              </div>

              {parsedSwap && (
                <div className="text-[11px] font-mono text-[#8B98A8] tabular-nums">
                  Rate: 1 {fromCoin} ≈ {formatCoinAmount(parsedSwap.rate, toCoin)} {toCoin} · Value ≈ $
                  {parsedSwap.usdValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} USD (₹
                  {parsedSwap.inrValue.toLocaleString(undefined, { maximumFractionDigits: 2 })})
                </div>
              )}
            </div>

            {/* Source Wallet when From Coin is XYPH */}
            {fromCoin === 'XYPH' ? (
              <div className="space-y-2.5 pt-2 border-t border-[#1D2432]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[#9AA6B6]">
                    Source {SYMBOL} Wallet (Signed On-Chain Transfer · {NETWORK_FEE_XYPH} {SYMBOL} Fee)
                  </label>
                  <div className="inline-flex items-center gap-1 p-0.5 bg-[#0B0E14] border border-[#1E2533] rounded text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        userPickedSwapWalletRef.current = true;
                        setSwapXyphSourceMode('local');
                        setSwapError(null);
                      }}
                      className={`px-2 py-1 rounded cursor-pointer ${
                        effectiveSwapXyphMode === 'local'
                          ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                          : 'text-[#8B98A8]'
                      }`}
                    >
                      Local Wallet
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        userPickedSwapWalletRef.current = true;
                        setSwapError(null);
                        if (mmAccount) setSwapXyphSourceMode('metamask');
                        else void onConnectMetaMask().then(() => setSwapXyphSourceMode('metamask'));
                      }}
                      className={`px-2 py-1 rounded cursor-pointer ${
                        effectiveSwapXyphMode === 'metamask'
                          ? 'bg-[#1D2534] text-amber-400 font-medium'
                          : 'text-[#8B98A8]'
                      }`}
                    >
                      {activeWalletLabel}
                    </button>
                  </div>
                </div>

                {effectiveSwapXyphMode === 'metamask' && mmAccount ? (
                  <div className="px-3 py-2.5 rounded-md bg-[#0B0E14] border border-amber-500/30 flex items-center justify-between gap-2 text-xs font-mono">
                    <span className="text-[#E6EDF3] truncate">{mmAccount}</span>
                    <span className="text-emerald-400 shrink-0 tabular-nums">
                      {formatXYPH(swapXyphBalance, 4)} {SYMBOL}
                    </span>
                  </div>
                ) : (
                  <select
                    value={swapXyphLocalAddr}
                    onChange={(e) => {
                      userPickedSwapWalletRef.current = true;
                      setSwapXyphLocalAddr(e.target.value);
                      setSwapError(null);
                    }}
                    className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  >
                    {wallets.map((w) => {
                      const bal =
                        liveSwapSenderInfo && liveSwapSenderInfo.address === w.address
                          ? liveSwapSenderInfo.spendable
                          : balances[w.address]?.spendable ?? 0;
                      return (
                        <option key={w.id} value={w.address}>
                          {w.label} · {truncateHash(w.address, 8, 6)} ({formatXYPH(bal, 4)} {SYMBOL})
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            ) : (
              <div className="space-y-2 pt-2 border-t border-[#1D2432]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[#9AA6B6]">
                    {selectedFromAsset.name} Deposit Transaction Hash
                  </label>
                  {parsedSwap &&
                    (isDirectEvmCoin(selectedFromAsset.symbol) ||
                      selectedFromAsset.symbol === 'SOL' ||
                      (selectedFromAsset.symbol === 'TRX' && isTronLinkAvailable())) && (
                      <button
                        type="button"
                        disabled={buyWalletPaying}
                        onClick={() =>
                          void handleDirectEvmPay(
                            selectedFromAsset,
                            parsedSwap.amount,
                            (h) => setSwapDepositTxHash(h),
                            setSwapError
                          )
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 cursor-pointer disabled:opacity-50"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        {buyWalletPaying
                          ? 'Confirm in Wallet...'
                          : fromCoin === 'SOL'
                          ? `Send ${parsedSwap.amount} SOL via Phantom`
                          : fromCoin === 'TRX'
                          ? `Send ${parsedSwap.amount} TRX via TronLink`
                          : `Send ${parsedSwap.amount} ${fromCoin} via ${activeWalletLabel}`}
                      </button>
                    )}
                </div>
                <input
                  type="text"
                  value={swapDepositTxHash}
                  onChange={(e) => setSwapDepositTxHash(e.target.value)}
                  placeholder={selectedFromAsset.txHashPlaceholder}
                  spellCheck={false}
                  className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {/* Receiving Destination Wallet for To Coin */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-[#9AA6B6]">
                  Your {selectedToAsset.name} ({toCoin}) or {activeWalletLabel} (0x...) Receiving Address
                </label>
                <div className="flex flex-wrap items-center gap-2.5">
                  {mmAccount ? (
                    <button
                      type="button"
                      onClick={() => quickFillRecipientForCoin(toCoin, true)}
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                    >
                      Use My {activeWalletLabel} (0x...)
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={mmBusy}
                      onClick={() => void onConnectMetaMask()}
                      className="text-xs text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                    >
                      Connect {activeWalletLabel}
                    </button>
                  )}
                  {toCoin === 'SOL' && phantomSolAccount && (
                    <button
                      type="button"
                      onClick={() => quickFillRecipientForCoin('SOL', false)}
                      className="text-xs text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                    >
                      Use Phantom SOL
                    </button>
                  )}
                </div>
              </div>
              <input
                type="text"
                value={swapRecipientInput}
                onChange={(e) => setSwapRecipientInput(e.target.value)}
                placeholder={
                  toCoin === 'XYPH'
                    ? selectedToAsset.addressPlaceholder
                    : `Paste your MetaMask (0x...) address for instant delivery, or ${selectedToAsset.addressPlaceholder}`
                }
                spellCheck={false}
                className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
              />
              {toCoin !== 'XYPH' && (
                <p className="text-[11px] text-[#8B98A8]">
                  {isValidEvmAddress(swapRecipientInput.trim())
                    ? `MetaMask (0x...) detected — ${toCoin} will be credited immediately on-chain to your ${activeWalletLabel} wallet on XYPH Network.`
                    : `Tip: Enter your ${activeWalletLabel} (0x...) address to receive ${toCoin} immediately on-chain inside ${activeWalletLabel}.`}
                </p>
              )}
            </div>

            {swapError && (
              <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300 space-y-2">
                <div>{swapError}</div>
                {fromCoin === 'XYPH' && /insufficient/i.test(swapError) && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {highestBalanceSwapWallet &&
                      highestBalanceSwapWallet.address !== swapXyphSenderAddr &&
                      highestBalanceSwapWallet.spendable > swapXyphBalance && (
                        <button
                          type="button"
                          onClick={() => {
                            userPickedSwapWalletRef.current = true;
                            setSwapXyphSourceMode(highestBalanceSwapWallet.mode);
                            if (highestBalanceSwapWallet.mode === 'local') {
                              setSwapXyphLocalAddr(highestBalanceSwapWallet.address);
                            }
                            setSwapError(null);
                          }}
                          className="px-2.5 py-1.5 rounded bg-amber-500 text-[#0B0E14] font-semibold hover:bg-amber-400 cursor-pointer"
                        >
                          Switch to {highestBalanceSwapWallet.label} (
                          {formatXYPH(highestBalanceSwapWallet.spendable, 4)} {SYMBOL})
                        </button>
                      )}
                    {swapXyphBalance > NETWORK_FEE_UNITS && (
                      <button
                        type="button"
                        onClick={handleSetSwapMax}
                        className="px-2.5 py-1.5 rounded border border-red-400/40 bg-red-500/15 text-red-100 font-medium hover:bg-red-500/25 cursor-pointer"
                      >
                        Use Max Sendable ({formatXYPH(swapXyphBalance - NETWORK_FEE_UNITS, 4)} {SYMBOL})
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {swapReceipt && (
              <div className="p-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 space-y-2.5 text-xs">
                <div className="flex items-center gap-2 font-semibold text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {swapReceipt.metamaskDelivered
                    ? `Delivered On-Chain to ${activeWalletLabel}`
                    : swapReceipt.status === 'completed'
                    ? 'Exchange Completed On-Chain'
                    : 'Exchange Collected · Ready to Transfer to Wallet'}{' '}
                  · {swapReceipt.fromAmount} {swapReceipt.fromCoin} →{' '}
                  {formatCoinAmount(swapReceipt.toAmount, swapReceipt.toCoin)} {swapReceipt.toCoin}
                </div>
                <div className="font-mono text-[#C9D3DF] break-all">
                  Order ID: {swapReceipt.id} · Destination: {swapReceipt.recipientAddress}
                </div>
                {swapTokenDelivery && (
                  <div className="p-2.5 rounded bg-[#0B0E14]/80 border border-emerald-500/25 font-mono text-[11px] space-y-1 text-[#C9D3DF]">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-[#8B98A8]">{swapTokenDelivery.symbol} Balance in {activeWalletLabel}:</span>
                      <span className="text-emerald-400 font-semibold">
                        {swapTokenDelivery.balanceBefore} → {swapTokenDelivery.balanceAfter}{' '}
                        {swapTokenDelivery.symbol}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-[#8B98A8]">Token Contract (XYPH Network):</span>
                      <span className="text-[#E6EDF3] break-all">{swapTokenDelivery.contractAddress}</span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-[#8B98A8]">Confirmed Block / Tx:</span>
                      <span className="text-amber-300">
                        Block #{swapTokenDelivery.blockHeight} · {truncateHash(swapTokenDelivery.txHash, 10, 6)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 pt-0.5">
                  {swapReceipt.metamaskDelivered && swapReceipt.tokenContractAddress && (
                    <button
                      type="button"
                      disabled={watchingSymbol === swapReceipt.toCoin}
                      onClick={() =>
                        void handleWatchTokenInMetaMask(
                          swapReceipt.toCoin,
                          swapReceipt.tokenContractAddress,
                          swapTokenDelivery?.decimals
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-[#0B0E14] font-semibold hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      {watchingSymbol === swapReceipt.toCoin
                        ? `Opening ${activeWalletLabel}...`
                        : `Add ${swapReceipt.toCoin} Token to ${activeWalletLabel}`}
                    </button>
                  )}
                  {swapReceipt.toCoin !== 'XYPH' &&
                    !swapReceipt.metamaskDelivered &&
                    !swapReceipt.payoutVerifiedOnChain && (
                      <button
                        type="button"
                        disabled={claimingOrderId === swapReceipt.id}
                        onClick={() => void handleClaimOrderToMetaMask(swapReceipt)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-400 text-[#0B0E14] font-semibold hover:bg-emerald-300 disabled:opacity-50 cursor-pointer"
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        {claimingOrderId === swapReceipt.id
                          ? 'Transferring...'
                          : `Transfer ${formatCoinAmount(swapReceipt.toAmount, swapReceipt.toCoin)} ${swapReceipt.toCoin} to ${activeWalletLabel}`}
                      </button>
                    )}
                  {swapReceipt.status === 'pending_payout' && (
                    <button
                      type="button"
                      onClick={() => openPayoutModal(swapReceipt)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1D2534] border border-[#2A3446] text-[#E6EDF3] font-medium hover:border-amber-500/50 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5 text-amber-400" />
                      Other Wallet
                    </button>
                  )}
                  {(swapReceipt.settlementTxid || swapReceipt.fromCoin === 'XYPH') && (
                    <button
                      type="button"
                      onClick={() =>
                        onInspectTx(swapReceipt.settlementTxid || swapReceipt.depositTxHash)
                      }
                      className="text-amber-400 hover:underline font-medium cursor-pointer"
                    >
                      View On-Chain Transaction in Explorer
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-[#1D2432] flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[#8B98A8]">
                {fromCoin === 'XYPH'
                  ? `Sends real ${SYMBOL} to ${truncateHash(selectedFromAsset.collectionAddress, 8, 6)}`
                  : `Collected in verified ${fromCoin} vault`}
              </div>
              <button
                type="submit"
                disabled={swapSubmitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {swapSubmitting
                  ? 'Processing Exchange...'
                  : `Swap ${fromCoin} → ${toCoin}`}
              </button>
            </div>
          </form>

          {/* Right: Swap Route & Deposit Vault Summary */}
          <div className="lg:col-span-5 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5">
            <div className="flex items-center justify-between gap-3 border-b border-[#1D2432] pb-4">
              <div className="flex items-center gap-2.5">
                <CoinLogo symbol={fromCoin} size={28} />
                <ArrowRight className="w-4 h-4 text-amber-400" />
                <CoinLogo symbol={toCoin} size={28} />
                <div>
                  <h3 className="text-sm font-semibold text-[#E6EDF3]">
                    {fromCoin} to {toCoin} Route
                  </h3>
                  <p className="text-xs text-[#8B98A8]">
                    {selectedFromAsset.network} → {selectedToAsset.network}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="text-[#9AA6B6] font-medium">
                {selectedFromAsset.name} ({fromCoin}) Deposit Collection Address
              </div>
              <div className="p-3 rounded-md bg-[#0B0E14] border border-[#1E2533] space-y-2.5">
                <div className="font-mono text-xs text-[#E6EDF3] break-all select-all">
                  {selectedFromAsset.collectionAddress}
                </div>
                {fromCoin === 'XYPH' && selectedFromAsset.collectionXyphAddress && (
                  <div className="text-[11px] font-mono text-[#8B98A8] break-all">
                    Native XYPH: {selectedFromAsset.collectionXyphAddress}
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(selectedFromAsset.collectionAddress, `swap-vault-${fromCoin}`)
                    }
                    className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                  >
                    {copiedKey === `swap-vault-${fromCoin}` ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Address
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrModalAsset(selectedFromAsset)}
                    className="inline-flex items-center gap-1 text-[#C9D3DF] hover:text-[#E6EDF3] font-medium cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5 text-amber-400" />
                    Show QR
                  </button>
                </div>
              </div>

              <div className="space-y-2 border-t border-[#1D2432] pt-3">
                <div className="flex justify-between">
                  <span className="text-[#8B98A8]">{fromCoin} Price</span>
                  <span className="font-mono text-[#E6EDF3] tabular-nums">
                    ${selectedFromAsset.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B98A8]">{toCoin} Price</span>
                  <span className="font-mono text-[#E6EDF3] tabular-nums">
                    ${selectedToAsset.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B98A8]">Settlement Mode</span>
                  <span className="text-emerald-400 font-medium">
                    {toCoin === 'XYPH'
                      ? 'Instant On-Chain XYPH'
                      : isValidEvmAddress(swapRecipientInput.trim())
                      ? `Instant On-Chain ${toCoin} in ${activeWalletLabel}`
                      : 'Verified Collection & Payout'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 3: TRANSFER ANY EXCHANGE COIN TO ANY WALLET IN REAL */}
      {subTab === 'transfer' && selectedTransferAsset && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleDirectAnyWalletTransfer}
            className="lg:col-span-7 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5"
          >
            <div>
              <h3 className="text-sm font-semibold text-[#E6EDF3]">
                Real Multi-Chain Transfer to Any Wallet
              </h3>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Transfer ETH, SOL, BTC, TRX, BNB, POL, MON, XLM, or {SYMBOL} directly on-chain to any MetaMask, Phantom, Trust Wallet, Coinbase, Binance, hardware, or native Xypher wallet.
              </p>
            </div>

            {/* 9-Coin Selector Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {SUPPORTED_EXCHANGE_COINS.map((coinDef) => {
                const isSelected = transferCoin === coinDef.symbol;
                return (
                  <button
                    key={coinDef.symbol}
                    type="button"
                    onClick={() => {
                      setTransferCoin(coinDef.symbol);
                      setTransferAmountInput(
                        coinDef.symbol === 'XYPH' ? '10' : String(coinDef.minAmount * 2)
                      );
                      setTransferError(null);
                      setTransferReceipt(null);
                      setTransferExternalTxHash('');
                    }}
                    className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#1A2232] border-sky-400/70'
                        : 'bg-[#0B0E14] border-[#1E2533] hover:border-[#2F3B52]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <CoinLogo symbol={coinDef.symbol} size={22} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#E6EDF3] truncate">
                          {coinDef.symbol}
                        </div>
                        <div className="text-[10px] text-[#8B98A8] truncate">{coinDef.name}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Source Wallet when transferring XYPH */}
            {transferCoin === 'XYPH' && (
              <div className="space-y-2 pt-1 border-t border-[#1D2432]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[#9AA6B6]">
                    From {SYMBOL} Wallet ({NETWORK_FEE_XYPH} {SYMBOL} Network Fee)
                  </label>
                  <div className="inline-flex items-center gap-1 p-0.5 bg-[#0B0E14] border border-[#1E2533] rounded text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        userPickedSwapWalletRef.current = true;
                        setSwapXyphSourceMode('local');
                        setTransferError(null);
                      }}
                      className={`px-2 py-1 rounded cursor-pointer ${
                        effectiveSwapXyphMode === 'local'
                          ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                          : 'text-[#8B98A8]'
                      }`}
                    >
                      Local Wallet
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        userPickedSwapWalletRef.current = true;
                        setTransferError(null);
                        if (mmAccount) setSwapXyphSourceMode('metamask');
                        else void onConnectMetaMask().then(() => setSwapXyphSourceMode('metamask'));
                      }}
                      className={`px-2 py-1 rounded cursor-pointer ${
                        effectiveSwapXyphMode === 'metamask'
                          ? 'bg-[#1D2534] text-amber-400 font-medium'
                          : 'text-[#8B98A8]'
                      }`}
                    >
                      {activeWalletLabel}
                    </button>
                  </div>
                </div>
                {effectiveSwapXyphMode === 'metamask' && mmAccount ? (
                  <div className="px-3 py-2.5 rounded-md bg-[#0B0E14] border border-amber-500/30 flex items-center justify-between gap-2 text-xs font-mono">
                    <span className="text-[#E6EDF3] truncate">{mmAccount}</span>
                    <span className="text-emerald-400 shrink-0 tabular-nums">
                      {formatXYPH(swapXyphBalance, 4)} {SYMBOL}
                    </span>
                  </div>
                ) : (
                  <select
                    value={swapXyphLocalAddr}
                    onChange={(e) => {
                      userPickedSwapWalletRef.current = true;
                      setSwapXyphLocalAddr(e.target.value);
                      setTransferError(null);
                    }}
                    className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  >
                    {wallets.map((w) => {
                      const bal =
                        liveSwapSenderInfo && liveSwapSenderInfo.address === w.address
                          ? liveSwapSenderInfo.spendable
                          : balances[w.address]?.spendable ?? 0;
                      return (
                        <option key={w.id} value={w.address}>
                          {w.label} · {truncateHash(w.address, 8, 6)} ({formatXYPH(bal, 4)} {SYMBOL})
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            )}

            {/* Any Destination Wallet Address */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-[#9AA6B6]">
                  Destination {selectedTransferAsset.name} ({transferCoin}) or {activeWalletLabel} (0x...) Wallet Address
                </label>
                <div className="flex flex-wrap items-center gap-2.5 text-xs">
                  {transferCoin === 'SOL' && phantomSolAccount && (
                    <button
                      type="button"
                      onClick={() => setTransferToInput(phantomSolAccount)}
                      className="text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                    >
                      My Phantom SOL
                    </button>
                  )}
                  {mmAccount && (
                    <button
                      type="button"
                      onClick={() => setTransferToInput(mmAccount)}
                      className="text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                    >
                      My {activeWalletLabel} (0x...)
                    </button>
                  )}
                  {transferCoin === 'XYPH' && wallets[0] && (
                    <button
                      type="button"
                      onClick={() => setTransferToInput(wallets[0].address)}
                      className="text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                    >
                      My Local Wallet
                    </button>
                  )}
                </div>
              </div>
              <input
                type="text"
                value={transferToInput}
                onChange={(e) => {
                  setTransferToInput(e.target.value);
                  if (transferError) setTransferError(null);
                }}
                placeholder={`Paste ANY MetaMask (0x...) or ${selectedTransferAsset.name} wallet (${selectedTransferAsset.addressPlaceholder})`}
                spellCheck={false}
                className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-sky-400"
              />
              {transferToInput.trim() && (
                <p className={`text-[11px] ${transferAddrValid ? 'text-emerald-400' : 'text-red-400'}`}>
                  {transferAddrValid
                    ? canUseXyphErc20Transfer
                      ? `Valid MetaMask (0x...) address — will transfer your exchanged ${transferCoin} directly on XYPH Network (0 gas)`
                      : `Valid ${selectedTransferAsset.addressFormatLabel} on ${selectedTransferAsset.network}`
                    : `Invalid address format for ${selectedTransferAsset.name} (${selectedTransferAsset.addressPlaceholder}) or MetaMask (0x...)`}
                </p>
              )}
            </div>

            {/* Transfer Amount */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-medium text-[#9AA6B6]">
                    Transfer Amount ({transferCoin})
                  </label>
                  {transferCoin === 'XYPH' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const maxUnits = Math.max(0, swapXyphBalance - NETWORK_FEE_UNITS);
                        setTransferAmountInput(
                          maxUnits > 0 ? Number((maxUnits / UNIT).toFixed(4)).toString() : '0'
                        );
                        setTransferError(null);
                      }}
                      className="text-xs text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                    >
                      Send Max
                    </button>
                  ) : (
                    activeTransferMmToken &&
                    activeTransferMmToken.balanceNumeric > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setTransferAmountInput(activeTransferMmToken.balanceFormatted);
                          setTransferError(null);
                        }}
                        className="text-xs text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                      >
                        Send Max ({activeTransferMmToken.balanceFormatted})
                      </button>
                    )
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={transferAmountInput}
                  onChange={(e) => {
                    setTransferAmountInput(e.target.value);
                    if (transferError) setTransferError(null);
                  }}
                  placeholder={String(selectedTransferAsset.minAmount)}
                  className="w-full px-3 py-2.5 text-sm font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-sky-400 tabular-nums"
                />
                {transferCoin === 'XYPH' ? (
                  <p className="mt-1 text-[11px] font-mono text-[#8B98A8] tabular-nums">
                    Spendable: {formatXYPH(swapXyphBalance, 4)} {SYMBOL} · Max:{' '}
                    {formatXYPH(Math.max(0, swapXyphBalance - NETWORK_FEE_UNITS), 4)} {SYMBOL}
                  </p>
                ) : (
                  activeTransferMmToken &&
                  activeTransferMmToken.balanceNumeric > 0 && (
                    <p className="mt-1 text-[11px] font-mono text-emerald-400 tabular-nums">
                      Exchanged {transferCoin} in {activeWalletLabel}: {activeTransferMmToken.balanceFormatted}{' '}
                      {transferCoin} (XYPH Network · 0 Gas)
                    </p>
                  )
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                  Live Market Value
                </label>
                <div className="px-3 py-2.5 rounded-md bg-[#0B0E14] border border-[#222A38] font-mono text-sm text-[#E6EDF3] tabular-nums">
                  {parsedTransfer
                    ? `$${parsedTransfer.usdValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} USD`
                    : '$0.00 USD'}
                </div>
                <p className="mt-1 text-[11px] font-mono text-[#6B7788] tabular-nums">
                  {parsedTransfer
                    ? `≈ ₹${parsedTransfer.inrValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} INR · ${selectedTransferAsset.network}`
                    : selectedTransferAsset.network}
                </p>
              </div>
            </div>

            {/* Optional External Wallet Broadcast Hash (for BTC / XLM / Hardware / Mobile Wallets) */}
            {transferCoin !== 'XYPH' && (
              <div className="space-y-1.5 pt-1 border-t border-[#1D2432]">
                <label className="block text-xs font-medium text-[#9AA6B6]">
                  External Wallet Tx Hash (Optional — auto-filled if you send directly via{' '}
                  {transferCoin === 'SOL'
                    ? 'Phantom'
                    : transferCoin === 'TRX'
                    ? 'TronLink'
                    : isDirectEvmCoin(transferCoin)
                    ? activeWalletLabel
                    : 'your wallet app'}
                  )
                </label>
                <input
                  type="text"
                  value={transferExternalTxHash}
                  onChange={(e) => setTransferExternalTxHash(e.target.value)}
                  placeholder={selectedTransferAsset.txHashPlaceholder}
                  spellCheck={false}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-sky-400"
                />
              </div>
            )}

            {transferError && (
              <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
                {transferError}
              </div>
            )}

            {transferReceipt && (
              <div className="p-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Real {transferReceipt.fromCoin} Transfer Broadcast ·{' '}
                  {formatCoinAmount(transferReceipt.fromAmount, transferReceipt.fromCoin)}{' '}
                  {transferReceipt.fromCoin} sent to {truncateHash(transferReceipt.recipientAddress, 10, 8)}
                </div>
                <div className="font-mono text-[#C9D3DF] break-all">
                  Tx Hash: {transferReceipt.settlementTxid || transferReceipt.depositTxHash}
                </div>
                {transferReceipt.fromCoin === 'XYPH' ? (
                  <button
                    type="button"
                    onClick={() =>
                      onInspectTx(transferReceipt.settlementTxid || transferReceipt.depositTxHash)
                    }
                    className="text-amber-400 hover:underline font-medium cursor-pointer"
                  >
                    Inspect On-Chain in XYPH Explorer
                  </button>
                ) : (
                  SUPPORTED_COIN_MAP[transferReceipt.fromCoin]?.explorerTxPrefix && (
                    <a
                      href={`${SUPPORTED_COIN_MAP[transferReceipt.fromCoin].explorerTxPrefix}${transferReceipt.settlementTxid || transferReceipt.depositTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-amber-400 hover:underline font-medium"
                    >
                      Verify on {SUPPORTED_COIN_MAP[transferReceipt.fromCoin].network} Explorer
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )
                )}
              </div>
            )}

            <div className="pt-2 border-t border-[#1D2432] flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[#8B98A8]">
                {transferCoin === 'XYPH'
                  ? 'Signed & confirmed directly on XYPH Network'
                  : canUseXyphErc20Transfer
                  ? `Zero-gas ERC-20 ${transferCoin} transfer via ${activeWalletLabel} on XYPH Network`
                  : isDirectEvmCoin(transferCoin)
                  ? `Real on-chain tx signed in ${activeWalletLabel} (${selectedTransferAsset.network})`
                  : transferCoin === 'SOL'
                  ? 'Real Solana Mainnet transfer signed in Phantom'
                  : transferCoin === 'TRX'
                  ? 'Real TRON Mainnet transfer via TronLink or Mobile QR'
                  : `Real ${selectedTransferAsset.network} transfer via Wallet App / QR`}
              </div>
              <button
                type="submit"
                disabled={transferSubmitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#0B0E14] bg-sky-400 rounded-md hover:bg-sky-300 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                {transferSubmitting
                  ? 'Broadcasting Real Transfer...'
                  : transferExternalTxHash.trim()
                  ? `Verify & Log ${transferCoin} Transfer`
                  : transferCoin === 'XYPH'
                  ? `Transfer Real ${SYMBOL}`
                  : canUseXyphErc20Transfer
                  ? `Transfer ${transferCoin} via ${activeWalletLabel} (0 Gas)`
                  : transferCoin === 'SOL'
                  ? 'Transfer Real SOL via Phantom'
                  : transferCoin === 'TRX'
                  ? 'Transfer Real TRX via TronLink'
                  : isDirectEvmCoin(transferCoin)
                  ? `Transfer Real ${transferCoin} via ${activeWalletLabel}`
                  : `Verify ${transferCoin} Transfer Hash`}
              </button>
            </div>
          </form>

          {/* Right: Live Mobile / Hardware Wallet Transfer QR & Deep-Link */}
          <div className="lg:col-span-5 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5">
            <div className="flex items-center gap-3 border-b border-[#1D2432] pb-4">
              <CoinLogo symbol={selectedTransferAsset.symbol} size={34} />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#E6EDF3] truncate">
                  {selectedTransferAsset.name} ({selectedTransferAsset.symbol}) Real Wallet Bridge
                </h3>
                <p className="text-xs text-[#8B98A8] truncate">
                  {selectedTransferAsset.network} · {selectedTransferAsset.standard}
                </p>
              </div>
            </div>

            {transferAddrValid && transferQrDataUrl ? (
              <div className="flex flex-col items-center p-4 rounded-md bg-[#0B0E14] border border-[#1E2533] space-y-3">
                <div className="p-2.5 bg-white rounded-md">
                  <img
                    src={transferQrDataUrl}
                    alt={`${selectedTransferAsset.name} real transfer QR`}
                    className="w-44 h-44 object-contain"
                  />
                </div>
                <p className="text-[11px] text-center text-[#8B98A8]">
                  Scan with Trust Wallet, MetaMask Mobile, Phantom, Electrum, Lobstr, or any {selectedTransferAsset.name} wallet to send{' '}
                  <span className="font-mono text-[#E6EDF3]">
                    {parsedTransfer ? parsedTransfer.amount : '0'} {transferCoin}
                  </span>{' '}
                  directly to this destination.
                </p>
                {transferWalletUri &&
                  (transferWalletUri.startsWith('bitcoin:') ||
                    transferWalletUri.startsWith('web+stellar:') ||
                    transferWalletUri.startsWith('solana:') ||
                    transferWalletUri.startsWith('ethereum:')) && (
                    <a
                      href={transferWalletUri}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open {selectedTransferAsset.name} Wallet App
                    </a>
                  )}
              </div>
            ) : (
              <div className="p-5 rounded-md bg-[#0B0E14] border border-[#1E2533] text-xs text-[#8B98A8] space-y-2">
                <p className="text-[#E6EDF3] font-medium">How real multi-wallet transfer works:</p>
                <ul className="space-y-1.5 list-disc pl-4">
                  <li>
                    <strong className="text-[#E6EDF3]">XYPH:</strong> Signs &amp; confirms directly on XYPH Network from your local/mining wallet or MetaMask.
                  </li>
                  <li>
                    <strong className="text-[#E6EDF3]">ETH, BNB, POL, MON:</strong> Switches to the real mainnet in MetaMask / Phantom and executes <span className="font-mono">eth_sendTransaction</span>.
                  </li>
                  <li>
                    <strong className="text-[#E6EDF3]">SOL &amp; TRX:</strong> Executes real native transfers through Phantom Solana or TronLink.
                  </li>
                  <li>
                    <strong className="text-[#E6EDF3]">BTC &amp; XLM:</strong> Enter the destination address &amp; amount on the left to generate a live BIP-21 / SEP-0007 wallet app QR &amp; deep-link.
                  </li>
                </ul>
              </div>
            )}

            <div className="space-y-2 text-xs border-t border-[#1D2432] pt-4">
              <div className="flex justify-between">
                <span className="text-[#8B98A8]">Supported Wallets</span>
                <span className="text-[#E6EDF3]">MetaMask · Phantom · Trust · Hardware</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B98A8]">Address Validation</span>
                <span className="font-mono text-emerald-400">{selectedTransferAsset.addressFormatLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B98A8]">On-Chain Verification</span>
                <span className="text-emerald-400">Live Explorer &amp; RPC Check</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 4: ALL 9 VERIFIED COLLECTION VAULT ADDRESSES */}
      {subTab === 'vaults' && (
        <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#E6EDF3]">
                Verified Multi-Crypto Collection Addresses (All 9 Supported Coins)
              </h3>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Every coin is matched strictly to its valid blockchain address format. All crypto purchases &amp; swaps are collected and stored in these addresses.
              </p>
            </div>
            <span className="text-xs font-mono text-[#8B98A8]">
              {loadingAssets ? 'Syncing rates...' : `${effectiveAssets.length} verified vaults`}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#222A38] text-[#8B98A8]">
                  <th className="py-3 px-5 font-medium">Coin &amp; Network</th>
                  <th className="py-3 px-4 font-medium">Verified Collection Wallet Address</th>
                  <th className="py-3 px-4 text-right font-medium">Live Price</th>
                  <th className="py-3 px-4 text-right font-medium">Total Collected</th>
                  <th className="py-3 px-5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D2432]">
                {effectiveAssets.map((asset) => (
                  <tr key={asset.symbol} className="hover:bg-[#161C27]">
                    <td className="py-3.5 px-5 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <CoinLogo symbol={asset.symbol} size={28} />
                        <div>
                          <div className="font-semibold text-[#E6EDF3]">
                            {asset.name}{' '}
                            <span className="font-mono text-[#8B98A8]">({asset.symbol})</span>
                          </div>
                          <div className="text-[11px] text-[#6B7788]">
                            {asset.network} · {asset.addressFormatLabel}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono text-[#E6EDF3] break-all max-w-md">
                        {asset.collectionAddress}
                      </div>
                      {asset.collectionXyphAddress && (
                        <div className="text-[11px] font-mono text-[#6B7788] mt-0.5">
                          Native: {asset.collectionXyphAddress}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-[#E6EDF3]">
                        ${asset.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </div>
                      <div className="text-[11px] text-[#6B7788]">
                        ₹{asset.priceInr.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="font-semibold text-emerald-400">
                        {formatCoinAmount(asset.totalCollectedAmount, asset.symbol)} {asset.symbol}
                      </div>
                      <div className="text-[11px] text-[#6B7788]">
                        ${asset.totalCollectedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} ·{' '}
                        {asset.collectedTxCount} tx
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => copyText(asset.collectionAddress, `dir-${asset.symbol}`)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1D2534] border border-[#2A3446] rounded hover:border-amber-500/50 cursor-pointer"
                        >
                          {copiedKey === `dir-${asset.symbol}` ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => setQrModalAsset(asset)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1D2534] border border-[#2A3446] rounded hover:border-amber-500/50 cursor-pointer"
                        >
                          <QrCode className="w-3 h-3 text-amber-400" />
                          QR
                        </button>
                        {asset.symbol !== 'XYPH' && (
                          <button
                            type="button"
                            onClick={() => {
                              setBuyCoin(asset.symbol);
                              setBuyAmountInput(String(asset.minAmount * 5));
                              setSubTab('buy_crypto');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 cursor-pointer"
                          >
                            Buy {SYMBOL}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Collected Crypto Buy & Exchange Ledger */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#E6EDF3]">
              Collected Crypto Buy &amp; Exchange Transactions
            </h3>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Every crypto buy and swap stored on the server with its collection vault address and settlement hash.
            </p>
          </div>
          <select
            aria-label="Filter transactions by coin"
            value={orderCoinFilter}
            onChange={(e) => setOrderCoinFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
          >
            <option value="ALL">All 9 Coins ({orders.length})</option>
            {SUPPORTED_EXCHANGE_COINS.map((c) => (
              <option key={c.symbol} value={c.symbol}>
                {c.symbol} — {c.name}
              </option>
            ))}
          </select>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#8B98A8]">
            No crypto exchange transactions recorded yet. Buy {SYMBOL} with ETH, SOL, BTC, TRX, BNB, POL, MON, or XLM above to see collected vault records here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#222A38] text-[#8B98A8]">
                  <th className="py-2.5 px-5 font-medium">Exchange Pair</th>
                  <th className="py-2.5 px-4 font-medium">Collection Vault Address</th>
                  <th className="py-2.5 px-4 font-medium">Deposit Tx Hash</th>
                  <th className="py-2.5 px-4 text-right font-medium">Value</th>
                  <th className="py-2.5 px-5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D2432] font-mono tabular-nums">
                {filteredOrders.map((ord) => {
                  const fromDef = SUPPORTED_COIN_MAP[ord.fromCoin];
                  const toDef = SUPPORTED_COIN_MAP[ord.toCoin];
                  return (
                    <tr key={ord.id} className="hover:bg-[#161C27]">
                      <td className="py-3 px-5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <CoinLogo symbol={ord.fromCoin} size={20} />
                          {ord.kind === 'transfer' ? (
                            <span className="text-sky-300 font-semibold">
                              Transfer {formatCoinAmount(ord.fromAmount, ord.fromCoin)} {ord.fromCoin}
                            </span>
                          ) : (
                            <>
                              <span className="text-[#E6EDF3]">
                                {formatCoinAmount(ord.fromAmount, ord.fromCoin)} {ord.fromCoin}
                              </span>
                              <ArrowRight className="w-3 h-3 text-amber-400 shrink-0" />
                              <CoinLogo symbol={ord.toCoin} size={20} />
                              <span className="text-emerald-400 font-semibold">
                                {formatCoinAmount(ord.toAmount, ord.toCoin)} {ord.toCoin}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="text-[11px] text-[#6B7788] font-sans mt-0.5">
                          {ord.id} · {new Date(ord.createdAt * 1000).toLocaleString()}
                          {ord.recipientAddress && (
                            <span className="font-mono text-[#8B98A8]">
                              {' '}
                              · To {truncateHash(ord.recipientAddress, 6, 4)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#C9D3DF]">
                        {ord.kind === 'transfer'
                          ? truncateHash(ord.recipientAddress, 10, 8)
                          : truncateHash(ord.collectionAddress, 10, 8)}
                      </td>
                      <td className="py-3 px-4">
                        {ord.fromCoin === 'XYPH' ? (
                          <button
                            type="button"
                            onClick={() => onInspectTx(ord.depositTxHash)}
                            className="text-amber-400 hover:underline cursor-pointer"
                          >
                            {truncateHash(ord.depositTxHash, 10, 6)}
                          </button>
                        ) : fromDef?.explorerTxPrefix ? (
                          <a
                            href={`${fromDef.explorerTxPrefix}${ord.depositTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-amber-400 hover:underline"
                          >
                            {truncateHash(ord.depositTxHash, 10, 6)}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-[#C9D3DF]">
                            {truncateHash(ord.depositTxHash, 10, 6)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap text-[#E6EDF3]">
                        ${ord.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        <div className="text-[11px] text-[#6B7788]">
                          ₹{ord.inrValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </div>
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap font-sans">
                        {ord.kind !== 'transfer' &&
                        ord.toCoin !== 'XYPH' &&
                        !ord.payoutVerifiedOnChain &&
                        !ord.metamaskDelivered ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-amber-400 font-medium text-[11px]">
                              Not Yet in {activeWalletLabel}
                            </span>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={claimingOrderId === ord.id}
                                onClick={() => void handleClaimOrderToMetaMask(ord)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#0B0E14] bg-emerald-400 rounded hover:bg-emerald-300 disabled:opacity-50 cursor-pointer"
                              >
                                <Wallet className="w-3 h-3" />
                                {claimingOrderId === ord.id
                                  ? 'Transferring...'
                                  : `Transfer ${ord.toCoin} to ${activeWalletLabel}`}
                              </button>
                              <button
                                type="button"
                                onClick={() => openPayoutModal(ord)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#E6EDF3] bg-[#1D2534] border border-[#2A3446] rounded hover:border-amber-500/50 cursor-pointer"
                              >
                                <Send className="w-3 h-3 text-amber-400" />
                                Other
                              </button>
                            </div>
                          </div>
                        ) : ord.status === 'completed' ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-emerald-400 font-medium">
                              {ord.kind === 'transfer'
                                ? 'Transferred'
                                : ord.metamaskDelivered
                                ? `Delivered in ${activeWalletLabel}`
                                : ord.payoutVerifiedOnChain
                                ? 'Completed · On-Chain'
                                : 'Completed'}
                            </span>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {ord.settlementTxid && (
                                <>
                                  {ord.toCoin === 'XYPH' || ord.metamaskDelivered ? (
                                    <button
                                      type="button"
                                      onClick={() => onInspectTx(ord.settlementTxid!)}
                                      className="text-[11px] font-mono text-amber-400 hover:underline cursor-pointer"
                                    >
                                      On-Chain Tx
                                    </button>
                                  ) : toDef?.explorerTxPrefix ? (
                                    <a
                                      href={`${toDef.explorerTxPrefix}${ord.settlementTxid}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-400 hover:underline"
                                    >
                                      {ord.toCoin} Payout Tx
                                      <ExternalLink className="w-2.5 h-2.5" />
                                    </a>
                                  ) : (
                                    <span className="text-[11px] font-mono text-[#8B98A8]">
                                      {truncateHash(ord.settlementTxid, 8, 6)}
                                    </span>
                                  )}
                                </>
                              )}
                              {ord.metamaskDelivered && ord.tokenContractAddress && (
                                <button
                                  type="button"
                                  disabled={watchingSymbol === ord.toCoin}
                                  onClick={() =>
                                    void handleWatchTokenInMetaMask(
                                      ord.toCoin,
                                      ord.tokenContractAddress
                                    )
                                  }
                                  className="px-2 py-0.5 text-[10px] font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
                                >
                                  {watchingSymbol === ord.toCoin
                                    ? 'Adding...'
                                    : `Add ${ord.toCoin} to ${activeWalletLabel}`}
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-amber-400 font-medium text-[11px]">
                              Collected · Ready to Transfer
                            </span>
                            <button
                              type="button"
                              onClick={() => openPayoutModal(ord)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 cursor-pointer"
                            >
                              <Send className="w-3 h-3" />
                              Transfer {ord.toCoin} to Wallet
                            </button>
                          </div>
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

      {/* Zoomable Deposit QR Code Modal */}
      {qrModalAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setQrModalAsset(null)}
        >
          <div
            className="w-full max-w-md border border-[#2A3446] rounded-lg bg-[#121721] p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <CoinLogo symbol={qrModalAsset.symbol} size={28} />
                <div>
                  <h3 className="text-sm font-semibold text-[#E6EDF3]">
                    {qrModalAsset.name} ({qrModalAsset.symbol}) Deposit QR
                  </h3>
                  <p className="text-xs text-[#8B98A8]">{qrModalAsset.network}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQrModalAsset(null)}
                className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex justify-center p-4 bg-white rounded-md">
              {qrDataUrls[qrModalAsset.symbol] ? (
                <img
                  src={qrDataUrls[qrModalAsset.symbol]}
                  alt={`${qrModalAsset.name} collection QR`}
                  className="w-72 h-72 object-contain"
                />
              ) : (
                <div className="w-72 h-72 flex items-center justify-center text-xs text-slate-600">
                  Generating QR...
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs text-[#8B98A8]">
                Verified {qrModalAsset.addressFormatLabel}
              </div>
              <div className="p-3 rounded bg-[#0B0E14] border border-[#222A38] font-mono text-xs text-[#E6EDF3] break-all select-all">
                {qrModalAsset.collectionAddress}
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() =>
                    copyText(qrModalAsset.collectionAddress, `modal-${qrModalAsset.symbol}`)
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer"
                >
                  {copiedKey === `modal-${qrModalAsset.symbol}` ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied Address
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Address
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setQrModalAsset(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Real Exchange Payout Transfer Modal */}
      {payoutOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPayoutOrder(null)}
        >
          <div
            className="w-full max-w-lg border border-[#2A3446] rounded-lg bg-[#121721] p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#1D2432] pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <CoinLogo symbol={payoutOrder.toCoin} size={30} />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#E6EDF3] truncate">
                    Transfer {formatCoinAmount(payoutOrder.toAmount, payoutOrder.toCoin)}{' '}
                    {payoutOrder.toCoin} to Recipient Wallet
                  </h3>
                  <p className="text-xs text-[#8B98A8] truncate">
                    Order {payoutOrder.id} · {SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.network}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPayoutOrder(null)}
                className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-md bg-[#0B0E14] border border-[#1E2533] space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#8B98A8]">Exact Payout Amount</span>
                <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                  {formatCoinAmount(payoutOrder.toAmount, payoutOrder.toCoin)} {payoutOrder.toCoin}
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[#8B98A8]">
                  <span>Destination {activeWalletLabel} (0x...) or {payoutOrder.toCoin} Wallet Address</span>
                  <div className="flex items-center gap-2.5">
                    {mmAccount &&
                      (payoutOrder.status === 'pending_payout' ||
                        (!payoutOrder.metamaskDelivered && !payoutOrder.payoutVerifiedOnChain)) && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayoutRecipientInput(mmAccount);
                            setPayoutTxHashInput(mmAccount);
                            if (payoutError) setPayoutError(null);
                          }}
                          className="text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                        >
                          Use My {activeWalletLabel}
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => copyText(activePayoutRecipient, `payout-addr-${payoutOrder.id}`)}
                      className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 cursor-pointer"
                    >
                      {copiedKey === `payout-addr-${payoutOrder.id}` ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {payoutOrder.status === 'pending_payout' ||
                (payoutOrder.toCoin !== 'XYPH' &&
                  !payoutOrder.metamaskDelivered &&
                  !payoutOrder.payoutVerifiedOnChain) ? (
                  <>
                    <input
                      type="text"
                      value={payoutRecipientInput}
                      onChange={(e) => {
                        setPayoutRecipientInput(e.target.value);
                        setPayoutTxHashInput(e.target.value);
                        if (payoutError) setPayoutError(null);
                      }}
                      placeholder={`MetaMask 0x... or ${SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.addressPlaceholder}`}
                      spellCheck={false}
                      className="w-full px-2.5 py-2 font-mono text-xs bg-[#121721] border border-[#2A3446] rounded text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                    />
                    <p
                      className={`text-[11px] ${
                        payoutRecipientValid ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {payoutRecipientValid
                        ? isValidEvmAddress(activePayoutRecipient) && payoutOrder.toCoin !== 'XYPH'
                          ? `Valid MetaMask (0x...) address — credits real ${payoutOrder.toCoin} on-chain on XYPH Network (0 gas)`
                          : `Valid ${SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.addressFormatLabel} — you can change this to any wallet before sending`
                        : `Enter a valid MetaMask (0x...) or ${SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.name} wallet address`}
                    </p>
                  </>
                ) : (
                  <div className="font-mono text-[#E6EDF3] break-all select-all p-2 rounded bg-[#121721] border border-[#222A38]">
                    {payoutOrder.recipientAddress}
                  </div>
                )}
              </div>
            </div>

            {(payoutOrder.status === 'pending_payout' ||
              (payoutOrder.toCoin !== 'XYPH' &&
                !payoutOrder.metamaskDelivered &&
                !payoutOrder.payoutVerifiedOnChain)) && (
              <>
                {/* 1-Click Real On-Chain MetaMask / Wallet Transfer Button */}
                {(payoutOrder.toCoin === 'XYPH' ||
                  isValidEvmAddress(activePayoutRecipient) ||
                  isDirectEvmCoin(payoutOrder.toCoin) ||
                  payoutOrder.toCoin === 'SOL' ||
                  payoutOrder.toCoin === 'TRX') && (
                  <button
                    type="button"
                    disabled={payoutSubmitting}
                    onClick={() => void handleDirectPayoutBroadcast()}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#0B0E14] bg-emerald-400 rounded-md hover:bg-emerald-300 disabled:opacity-50 cursor-pointer"
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    {payoutSubmitting
                      ? 'Transferring On-Chain...'
                      : payoutOrder.toCoin !== 'XYPH' && isValidEvmAddress(activePayoutRecipient)
                      ? `Transfer Real ${formatCoinAmount(payoutOrder.toAmount, payoutOrder.toCoin)} ${payoutOrder.toCoin} to ${activeWalletLabel} (XYPH Network)`
                      : payoutOrder.toCoin === 'SOL'
                      ? `Send Real ${formatCoinAmount(payoutOrder.toAmount, 'SOL')} SOL via Phantom`
                      : payoutOrder.toCoin === 'TRX'
                      ? `Send Real ${formatCoinAmount(payoutOrder.toAmount, 'TRX')} TRX via TronLink`
                      : payoutOrder.toCoin === 'XYPH'
                      ? `Send Real ${formatCoinAmount(payoutOrder.toAmount, 'XYPH')} XYPH On-Chain`
                      : `Transfer Real ${formatCoinAmount(payoutOrder.toAmount, payoutOrder.toCoin)} ${payoutOrder.toCoin} via ${activeWalletLabel}`}
                  </button>
                )}

                {/* Scannable QR & Wallet App Deep Link for Mobile / Hardware / BTC / XLM */}
                {payoutQrDataUrl && (
                  <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-md bg-[#0B0E14] border border-[#1E2533]">
                    <div className="p-2 bg-white rounded shrink-0">
                      <img
                        src={payoutQrDataUrl}
                        alt="Payout transfer QR"
                        className="w-32 h-32 object-contain"
                      />
                    </div>
                    <div className="space-y-2 text-xs">
                      <p className="text-[#C9D3DF]">
                        Or scan this QR from Trust Wallet, Ledger Live, Electrum, Lobstr, or any{' '}
                        {SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.name} wallet to send the real payout.
                      </p>
                      {payoutWalletUri &&
                        (payoutWalletUri.startsWith('bitcoin:') ||
                          payoutWalletUri.startsWith('web+stellar:') ||
                          payoutWalletUri.startsWith('solana:') ||
                          payoutWalletUri.startsWith('ethereum:')) && (
                          <a
                            href={payoutWalletUri}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded hover:bg-amber-500/20"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open {SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.name} Wallet App
                          </a>
                        )}
                    </div>
                  </div>
                )}

                {/* Confirm Valid Destination Wallet Address (No Tx Hash Required) */}
                {payoutOrder.status === 'pending_payout' && (
                  <form onSubmit={handleManualPayoutConfirm} className="space-y-2 pt-2 border-t border-[#1D2432]">
                    <label className="block text-xs font-medium text-[#9AA6B6]">
                      Confirm destination MetaMask (0x...) or {SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.name} wallet address:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={payoutTxHashInput}
                        onChange={(e) => {
                          setPayoutTxHashInput(e.target.value);
                          if (payoutError) setPayoutError(null);
                        }}
                        placeholder={`0x... or ${SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.addressPlaceholder}`}
                        spellCheck={false}
                        className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="submit"
                        disabled={payoutSubmitting || !payoutTxHashInput.trim()}
                        className="px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                      >
                        Deliver &amp; Complete
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}

            {payoutError && (
              <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
                {payoutError}
              </div>
            )}

            {payoutSuccessMsg && (
              <div className="p-3.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300 space-y-2">
                <div className="flex items-start gap-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{payoutSuccessMsg}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                  {(payoutTokenDelivery || (payoutOrder.metamaskDelivered && payoutOrder.tokenContractAddress)) && (
                    <button
                      type="button"
                      disabled={watchingSymbol === payoutOrder.toCoin}
                      onClick={() =>
                        void handleWatchTokenInMetaMask(
                          payoutOrder.toCoin,
                          payoutTokenDelivery?.contractAddress || payoutOrder.tokenContractAddress,
                          payoutTokenDelivery?.decimals
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-[#0B0E14] font-semibold hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      {watchingSymbol === payoutOrder.toCoin
                        ? `Opening ${activeWalletLabel}...`
                        : `Add ${payoutOrder.toCoin} to ${activeWalletLabel}`}
                    </button>
                  )}
                  {payoutOrder.settlementTxid &&
                    (payoutOrder.metamaskDelivered || payoutOrder.toCoin === 'XYPH' ? (
                      <button
                        type="button"
                        onClick={() => {
                          onInspectTx(payoutOrder.settlementTxid!);
                          setPayoutOrder(null);
                        }}
                        className="text-amber-400 hover:underline font-mono cursor-pointer"
                      >
                        Inspect On-Chain Tx
                      </button>
                    ) : (
                      validateCoinTxHash(payoutOrder.toCoin, payoutOrder.settlementTxid) &&
                      SUPPORTED_COIN_MAP[payoutOrder.toCoin]?.explorerTxPrefix && (
                        <a
                          href={`${SUPPORTED_COIN_MAP[payoutOrder.toCoin].explorerTxPrefix}${payoutOrder.settlementTxid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-amber-400 hover:underline font-mono"
                        >
                          View on {SUPPORTED_COIN_MAP[payoutOrder.toCoin].network} Explorer
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
