import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  ArrowLeftRight,
  Blocks,
  Cpu,
  Globe,
  IndianRupee,
  Link2,
  LogIn,
  Menu,
  Send,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { BuyView } from './components/BuyView.tsx';
import { CoreCppView } from './components/CoreCppView.tsx';
import { CryptoExchangeView } from './components/CryptoExchangeView.tsx';
import { ExplorerView } from './components/ExplorerView.tsx';
import { GoogleAuthModal } from './components/GoogleAuthModal.tsx';
import { NetworkView } from './components/NetworkView.tsx';
import { SendView } from './components/SendView.tsx';
import { WalletsView } from './components/WalletsView.tsx';
import { xypherApi } from './lib/api.ts';
import {
  type LinkedWalletDoc,
  auth,
  saveLinkedWalletBookmark,
  signInWithGoogleAccount,
  signOutGoogleAccount,
  subscribeLinkedWallets,
  syncUserProfileOnAuth,
} from './lib/firebase.ts';
import {
  type EthereumProvider,
  type EvmWalletName,
  XYPHER_COIN_ICON_PATH,
  addOrSwitchXypherNetwork,
  connectMetaMaskWallet,
  connectPhantomEvmWallet,
  formatWalletError,
  getEthereumProvider,
  getPhantomEvmProvider,
  initWalletDiscovery,
  setActiveEvmProvider,
  watchXyphTokenInMetaMask,
} from './lib/metamask.ts';
import {
  connectPhantomSolanaWallet,
  disconnectSolanaWallet,
  fetchSolanaBalance,
  getConnectedSolanaSession,
  isPhantomSolanaAvailable,
} from './lib/solanaWallet.ts';
import type {
  ActivityEvent,
  AddressInfo,
  BlockSummary,
  ChainInfo,
  LocalWalletAccount,
  MarketTicker,
  MempoolTxItem,
  NetworkProfile,
} from './lib/types.ts';
import {
  createWalletAccount,
  importWalletFromWif,
  loadLocalWallets,
  saveLocalWallets,
} from './lib/walletStore.ts';
import {
  NETWORK_NAME,
  SYMBOL,
  XYPHER_CHAIN_ID_HEX,
  evmToXypherAddress,
  formatXYPH,
  truncateHash,
} from './lib/xypherCrypto.ts';

type NavTab = 'wallets' | 'buy' | 'exchange' | 'send' | 'explorer' | 'corecpp' | 'network';

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'wallets', label: 'Wallet', icon: Wallet },
  { id: 'buy', label: 'Buy & Sell', icon: IndianRupee },
  { id: 'exchange', label: 'Crypto Exchange', icon: ArrowLeftRight },
  { id: 'send', label: 'Send & Receive', icon: Send },
  { id: 'explorer', label: 'Explorer', icon: Blocks },
  { id: 'corecpp', label: 'C++ Core', icon: Cpu },
  { id: 'network', label: 'Smart Contract & RPC', icon: Globe },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    if (typeof window === 'undefined') return 'wallets';
    const param = new URLSearchParams(window.location.search).get('tab');
    if (
      param === 'wallets' ||
      param === 'buy' ||
      param === 'exchange' ||
      param === 'send' ||
      param === 'explorer' ||
      param === 'corecpp' ||
      param === 'network'
    ) {
      return param;
    }
    return 'wallets';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [wallets, setWallets] = useState<LocalWalletAccount[]>(() => {
    const existing = loadLocalWallets();
    if (existing.length > 0) return existing;
    const initial = createWalletAccount('My Xypher Wallet');
    saveLocalWallets([initial]);
    return [initial];
  });

  const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null);
  const [marketTicker, setMarketTicker] = useState<MarketTicker | null>(null);
  const [marketStreamConnected, setMarketStreamConnected] = useState(false);
  const [blocks, setBlocks] = useState<BlockSummary[]>([]);
  const [totalBlocks, setTotalBlocks] = useState<number>(0);
  const [mempool, setMempool] = useState<MempoolTxItem[]>([]);
  const [balances, setBalances] = useState<Record<string, AddressInfo>>({});
  const [loading, setLoading] = useState(true);
  const [nodeError, setNodeError] = useState<string | null>(null);

  const [publicBaseUrl, setPublicBaseUrl] = useState<string | null>(null);
  const [mmProvider, setMmProvider] = useState<EthereumProvider | null>(null);
  const [mmAccount, setMmAccount] = useState<string | null>(null);
  const [mmChainId, setMmChainId] = useState<string | null>(null);
  const [evmWalletName, setEvmWalletName] = useState<EvmWalletName | null>(null);
  const [phantomSolAccount, setPhantomSolAccount] = useState<string | null>(
    () => getConnectedSolanaSession()?.address ?? null
  );
  const [phantomSolBalance, setPhantomSolBalance] = useState<number | null>(null);
  const [mmBusy, setMmBusy] = useState(false);
  const [mmError, setMmError] = useState<string | null>(null);
  const [mmNotice, setMmNotice] = useState<string | null>(null);

  const [sendTarget, setSendTarget] = useState<{
    address: string | null;
    useMetaMask: boolean;
  }>({ address: null, useMetaMask: false });

  const [inspectRequest, setInspectRequest] = useState<{
    type: 'tx' | 'block' | 'address';
    value: string;
    seq: number;
  } | null>(null);

  // Google Sign-Up & Sign-In (Firebase Auth + Firestore)
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup' | null>(null);
  const [linkedWallets, setLinkedWallets] = useState<LinkedWalletDoc[]>([]);

  const [, setActivityLog] = useState<ActivityEvent[]>([]);
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const mmAccountRef = useRef(mmAccount);
  mmAccountRef.current = mmAccount;
  const linkedWalletsRef = useRef(linkedWallets);
  linkedWalletsRef.current = linkedWallets;

  const pushLog = useCallback((level: ActivityEvent['level'], message: string) => {
    setActivityLog((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: Date.now(),
        level,
        message,
      },
      ...prev.slice(0, 149),
    ]);
  }, []);

  const refreshNodeState = useCallback(async () => {
    try {
      const [info, blkRes, mpRes, mktRes] = await Promise.all([
        xypherApi.getInfo(),
        xypherApi.getBlocks(25, 0),
        xypherApi.getMempool(),
        xypherApi.getMarketPrice().catch(() => null),
      ]);
      if (info && typeof info.height === 'number' && typeof info.tip === 'string') {
        setChainInfo(info);
      } else {
        throw new Error('Unexpected chain status payload from node');
      }
      if (mktRes && typeof mktRes.priceInr === 'number') {
        setMarketTicker(mktRes);
      }
      setBlocks(Array.isArray(blkRes?.blocks) ? blkRes.blocks : []);
      setTotalBlocks(typeof blkRes?.total === 'number' ? blkRes.total : info.height + 1);
      setMempool(Array.isArray(mpRes?.txs) ? mpRes.txs : []);
      setNodeError(null);

      const addressSet = new Set<string>();
      for (const w of walletsRef.current) addressSet.add(w.address);
      if (mmAccountRef.current) {
        try {
          addressSet.add(evmToXypherAddress(mmAccountRef.current));
        } catch {
          // Ignore malformed EVM address
        }
      }
      for (const lw of linkedWalletsRef.current) {
        if (lw.walletType !== 'solana' && lw.xyphAddress) {
          addressSet.add(lw.xyphAddress);
        }
      }

      const balEntries = await Promise.all(
        Array.from(addressSet).map(async (addr) => {
          try {
            const addrInfo = await xypherApi.getAddress(addr);
            return [addr, addrInfo] as const;
          } catch {
            return null;
          }
        })
      );
      const nextBalances: Record<string, AddressInfo> = {};
      for (const entry of balEntries) {
        if (entry) nextBalances[entry[0]] = entry[1];
      }
      setBalances(nextBalances);
    } catch (err) {
      setNodeError(err instanceof Error ? err.message : 'Node unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialize EIP-6963 wallet discovery passively (without calling window.ethereum.request on load)
  useEffect(() => {
    initWalletDiscovery();
    void xypherApi
      .getGatewayStatus()
      .then((g) => {
        if (g.publicBaseUrl) setPublicBaseUrl(g.publicBaseUrl);
      })
      .catch(() => {});
  }, []);

  // Subscribe to account/chain changes only on the actively connected EVM provider (MetaMask or Phantom)
  useEffect(() => {
    if (!mmProvider) return;

    const handleAccountsChanged = (accs: unknown) => {
      const list = Array.isArray(accs) ? (accs as string[]) : [];
      const next = list[0] ?? null;
      setMmAccount(next);
      if (!next) {
        setEvmWalletName(null);
        setActiveEvmProvider(null, null);
      }
    };
    const handleChainChanged = (cid: unknown) => {
      setMmChainId(typeof cid === 'string' ? cid : null);
    };

    mmProvider.on?.('accountsChanged', handleAccountsChanged);
    mmProvider.on?.('chainChanged', handleChainChanged);
    return () => {
      mmProvider.removeListener?.('accountsChanged', handleAccountsChanged);
      mmProvider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [mmProvider]);

  useEffect(() => {
    void refreshNodeState();
  }, [refreshNodeState, wallets.length, mmAccount, linkedWallets.length]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshNodeState();
    }, 3500);
    return () => clearInterval(timer);
  }, [refreshNodeState]);

  // Real-Time Server-Sent Events subscription for instant buy/sell price updates
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let closed = false;
    const es = new EventSource('/api/market/stream');

    const handleMarketEvent = (ev: MessageEvent) => {
      if (closed) return;
      try {
        const parsed = JSON.parse(ev.data) as MarketTicker;
        if (parsed && typeof parsed.priceInr === 'number') {
          setMarketTicker(parsed);
          setMarketStreamConnected(true);
        }
      } catch {
        // Ignore malformed SSE frames
      }
    };

    es.addEventListener('market', handleMarketEvent);
    es.onopen = () => {
      if (!closed) setMarketStreamConnected(true);
    };
    es.onerror = () => {
      if (!closed) setMarketStreamConnected(false);
    };

    return () => {
      closed = true;
      es.removeEventListener('market', handleMarketEvent);
      es.close();
    };
  }, []);

  // Subscribe to Firebase Google Auth state & sync owner-only profile/wallets
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authReady || !authUser) {
      setLinkedWallets([]);
      return;
    }

    let cancelled = false;
    const primaryLocal = walletsRef.current[0];
    const activeEvm = mmAccountRef.current || primaryLocal?.evmAddress || '';
    const activeXyph = mmAccountRef.current
      ? evmToXypherAddress(mmAccountRef.current)
      : primaryLocal?.address || '';

    void syncUserProfileOnAuth(authUser, activeXyph, activeEvm)
      .then(async (res) => {
        if (cancelled) return;
        if (primaryLocal) {
          await saveLinkedWalletBookmark(authUser, {
            walletId: primaryLocal.id,
            label: primaryLocal.label,
            xyphAddress: primaryLocal.address,
            evmAddress: primaryLocal.evmAddress,
            walletType: 'local',
          });
        }
        if (mmAccountRef.current) {
          const isPhantom = evmWalletName === 'Phantom';
          await saveLinkedWalletBookmark(authUser, {
            walletId: `${isPhantom ? 'ph' : 'mm'}_${mmAccountRef.current.slice(2, 14).toLowerCase()}`,
            label: isPhantom ? 'Phantom EVM Account' : 'MetaMask Account',
            xyphAddress: evmToXypherAddress(mmAccountRef.current),
            evmAddress: mmAccountRef.current,
            walletType: 'metamask',
          });
        }
        if (phantomSolAccount) {
          await saveLinkedWalletBookmark(authUser, {
            walletId: `phsol_${phantomSolAccount.slice(0, 12)}`,
            label: 'Phantom Solana Account',
            xyphAddress: phantomSolAccount,
            evmAddress: '',
            walletType: 'solana',
          });
        }
        if (res.isNewUser) {
          pushLog('success', `Welcome to Xypher! Signed up with Google (${authUser.email || authUser.displayName})`);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Profile sync failed:', err);
        }
      });

    const unsubWallets = subscribeLinkedWallets(
      authUser.uid,
      (docs) => {
        if (!cancelled) setLinkedWallets(docs);
      },
      (err) => {
        console.error('Linked wallets listener error:', err.message);
      }
    );

    return () => {
      cancelled = true;
      unsubWallets();
    };
  }, [authReady, authUser, mmAccount, evmWalletName, phantomSolAccount, pushLog]);

  const handleGoogleAuth = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const signedInUser = await signInWithGoogleAccount();
      pushLog('success', `Signed in with Google as ${signedInUser.email || signedInUser.displayName}`);
      setAuthModalMode(null);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.replace(/^Firebase:\s*/i, '')
          : 'Google sign-in failed. Please try again.';
      setAuthError(msg);
      pushLog('error', msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignOut = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOutGoogleAccount();
      setLinkedWallets([]);
      pushLog('info', 'Signed out of Google account');
      setAuthModalMode(null);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to sign out');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleConnectMetaMask = async () => {
    setMmBusy(true);
    setMmError(null);
    setMmNotice(null);
    try {
      const res = await connectMetaMaskWallet(publicBaseUrl);
      setMmProvider(res.provider);
      setMmAccount(res.account);
      setMmChainId(res.chainId);
      setEvmWalletName(res.walletName);
      setMmNotice(`Connected MetaMask account ${truncateHash(res.account, 8, 6)}.`);
      pushLog('success', `Connected MetaMask account ${truncateHash(res.account, 8, 6)}`);
      await refreshNodeState();
    } catch (err) {
      const msg = formatWalletError(err);
      setMmError(msg);
      pushLog('error', msg);
    } finally {
      setMmBusy(false);
    }
  };

  const handleConnectPhantom = async () => {
    setMmBusy(true);
    setMmError(null);
    setMmNotice(null);

    let connectedEvm: { account: string; chainId: string; provider: EthereumProvider } | null = null;
    let connectedSol: string | null = null;
    let lastErr: unknown = null;

    const hasPhantomEvm = Boolean(getPhantomEvmProvider());
    const hasPhantomSol = isPhantomSolanaAvailable();

    if (!hasPhantomEvm && !hasPhantomSol) {
      setMmError(
        'Phantom Wallet extension was not detected in this browser. Install Phantom from phantom.app or use "Open in Phantom Mobile" below.'
      );
      setMmBusy(false);
      return;
    }

    try {
      if (hasPhantomEvm) {
        try {
          const evmRes = await connectPhantomEvmWallet(publicBaseUrl);
          connectedEvm = evmRes;
          setMmProvider(evmRes.provider);
          setMmAccount(evmRes.account);
          setMmChainId(evmRes.chainId);
          setEvmWalletName('Phantom');
        } catch (err) {
          lastErr = err;
        }
      }

      if (hasPhantomSol) {
        try {
          const solRes = await connectPhantomSolanaWallet();
          connectedSol = solRes.address;
          setPhantomSolAccount(solRes.address);
          void fetchSolanaBalance(solRes.address)
            .then((bal) => setPhantomSolBalance(bal.sol))
            .catch(() => setPhantomSolBalance(null));
        } catch (err) {
          if (!connectedEvm) lastErr = err;
        }
      }

      if (connectedEvm && connectedSol) {
        setMmNotice(
          `Connected Phantom Wallet · EVM ${truncateHash(connectedEvm.account, 8, 6)} & Solana ${truncateHash(connectedSol, 6, 6)}.`
        );
        pushLog(
          'success',
          `Connected Phantom (EVM ${truncateHash(connectedEvm.account, 6, 4)} + Solana ${truncateHash(connectedSol, 6, 4)})`
        );
        await refreshNodeState();
      } else if (connectedEvm) {
        setMmNotice(`Connected Phantom EVM account ${truncateHash(connectedEvm.account, 8, 6)}.`);
        pushLog('success', `Connected Phantom EVM ${truncateHash(connectedEvm.account, 8, 6)}`);
        await refreshNodeState();
      } else if (connectedSol) {
        setMmNotice(`Connected Phantom Solana account ${truncateHash(connectedSol, 8, 6)}.`);
        pushLog('success', `Connected Phantom Solana ${truncateHash(connectedSol, 8, 6)}`);
      } else {
        throw lastErr || new Error('Phantom connection was cancelled.');
      }
    } catch (err) {
      const msg = formatWalletError(err);
      setMmError(msg);
      pushLog('error', msg);
    } finally {
      setMmBusy(false);
    }
  };

  const handleDisconnectPhantomSolana = async () => {
    await disconnectSolanaWallet();
    setPhantomSolAccount(null);
    setPhantomSolBalance(null);
    setMmNotice('Disconnected Phantom Solana session.');
  };

  const handleAddXypherToMetaMask = async () => {
    setMmBusy(true);
    setMmError(null);
    setMmNotice(null);
    const activeLabel = evmWalletName || 'MetaMask';
    try {
      await addOrSwitchXypherNetwork(publicBaseUrl);
      const eth = mmProvider || getEthereumProvider();
      if (eth) {
        setMmProvider(eth);
        try {
          const cid = String(await eth.request({ method: 'eth_chainId' }));
          setMmChainId(cid);
        } catch {
          // Ignore chain read failure after add
        }
      }
      setMmNotice(`${NETWORK_NAME} (${SYMBOL}) is now active in ${activeLabel}.`);
      pushLog('success', `Added ${NETWORK_NAME} (${SYMBOL}) to ${activeLabel}`);
    } catch (err) {
      const msg = formatWalletError(err);
      setMmError(msg);
      pushLog('error', msg);
    } finally {
      setMmBusy(false);
    }
  };

  const handleWatchXyphToken = async () => {
    setMmBusy(true);
    setMmError(null);
    setMmNotice(null);
    const activeLabel = evmWalletName || 'MetaMask';
    try {
      const added = await watchXyphTokenInMetaMask(publicBaseUrl);
      const eth = mmProvider || getEthereumProvider();
      if (eth) {
        setMmProvider(eth);
        try {
          const cid = String(await eth.request({ method: 'eth_chainId' }));
          setMmChainId(cid);
        } catch {
          // Ignore
        }
      }
      if (added) {
        setMmNotice(
          `Added ${SYMBOL} token with its official coin profile picture to your ${activeLabel} Tokens list.`
        );
        pushLog('success', `Published ${SYMBOL} coin logo & token in ${activeLabel} via wallet_watchAsset`);
      } else {
        setMmNotice(`${activeLabel} dismissed the ${SYMBOL} token import prompt.`);
      }
    } catch (err) {
      const msg = formatWalletError(err);
      setMmError(msg);
      pushLog('error', msg);
    } finally {
      setMmBusy(false);
    }
  };

  const handleCreateWallet = (label: string) => {
    const created = createWalletAccount(label);
    const next = [...wallets, created];
    setWallets(next);
    saveLocalWallets(next);
    pushLog('success', `Created unique wallet "${created.label}" (${created.address})`);
  };

  const handleImportWif = (wif: string, label: string): string | null => {
    try {
      const imported = importWalletFromWif(wif, label);
      if (wallets.some((w) => w.address === imported.address)) {
        return 'This address is already in your browser wallet.';
      }
      const next = [...wallets, imported];
      setWallets(next);
      saveLocalWallets(next);
      pushLog('success', `Imported WIF wallet "${imported.label}" (${imported.address})`);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid WIF key';
    }
  };

  const handleDeleteWallet = (id: string) => {
    const target = wallets.find((w) => w.id === id);
    const next = wallets.filter((w) => w.id !== id);
    setWallets(next);
    saveLocalWallets(next);
    if (target) {
      pushLog(
        'warn',
        `Removed "${target.label}" (${truncateHash(target.address, 8, 6)}) from browser vault`
      );
    }
  };

  const handleInspectTx = (txid: string) => {
    setInspectRequest({ type: 'tx', value: txid, seq: Date.now() });
    setActiveTab('explorer');
  };

  const handleQuickSend = (address: string, useMetaMask = false) => {
    setSendTarget({ address, useMetaMask });
    setActiveTab('send');
  };

  const handleResetComplete = (profile: NetworkProfile) => {
    pushLog('warn', `Network re-initialized under profile "${profile}"`);
    void refreshNodeState();
  };

  const activeNavTitle = NAV_ITEMS.find((item) => item.id === activeTab)?.label || 'Wallet';
  const isOnXypherChain = mmChainId?.toLowerCase() === XYPHER_CHAIN_ID_HEX.toLowerCase();

  return (
    <div className="min-h-screen bg-[#0B0E14] text-[#E6EDF3] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 border-r border-[#1E2533] bg-[#0E121A]">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-[#1E2533]">
          <img
            src={XYPHER_COIN_ICON_PATH}
            alt="Xypher (XYPH)"
            className="w-8 h-8 rounded-full object-cover ring-1 ring-white/15 shrink-0"
          />
          <div className="leading-tight">
            <div className="font-display text-base font-bold tracking-tight text-[#E6EDF3] whitespace-nowrap">
              Xypher
            </div>
            <div className="text-[11px] font-mono text-[#8B98A8]">{SYMBOL}</div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#18202E] text-[#E6EDF3]'
                    : 'text-[#8B98A8] hover:text-[#E6EDF3] hover:bg-[#141A25]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-[#6B7788]'}`} />
                  {item.label}
                </span>
                {item.id === 'explorer' && (chainInfo?.mempoolCount ?? 0) > 0 && (
                  <span className="font-mono text-xs text-amber-400 tabular-nums">
                    {chainInfo?.mempoolCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Google Account Card + Quiet Chain Summary Footer in Sidebar */}
        <div className="p-3 border-t border-[#1E2533]">
          {authUser ? (
            <button
              type="button"
              onClick={() => {
                setAuthError(null);
                setAuthModalMode('signin');
              }}
              className="w-full p-2 rounded-md border border-[#1E2533] bg-[#121721] hover:border-amber-500/40 flex items-center gap-2.5 text-left transition-colors cursor-pointer"
            >
              {authUser.photoURL ? (
                <img
                  src={authUser.photoURL}
                  alt={authUser.displayName || 'Google User'}
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                  <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[#E6EDF3] truncate">
                  {authUser.displayName || 'Google Account'}
                </div>
                <div className="text-[10px] text-[#8B98A8] truncate">{authUser.email}</div>
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAuthError(null);
                setAuthModalMode('signup');
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-[#0B0E14] bg-white rounded-md hover:bg-neutral-100 transition-colors cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              Google Sign In / Up
            </button>
          )}
        </div>

        <div className="p-4 border-t border-[#1E2533] text-xs space-y-1.5 text-[#8B98A8]">
          {(() => {
            const counted = new Set<string>();
            let totalUnits = 0;
            if (mmAccount) {
              try {
                const mmAddr = evmToXypherAddress(mmAccount);
                counted.add(mmAddr);
                totalUnits += balances[mmAddr]?.spendable ?? 0;
              } catch {
                // Ignore malformed EVM address
              }
            }
            for (const w of wallets) {
              if (!counted.has(w.address)) {
                counted.add(w.address);
                totalUnits += balances[w.address]?.spendable ?? 0;
              }
            }
            return (
              <div className="flex justify-between pb-1.5 mb-1 border-b border-[#1E2533]">
                <span className="text-[#C9D3DF] font-medium">Wallet Balance</span>
                <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                  {formatXYPH(totalUnits, 4)} {SYMBOL}
                </span>
              </div>
            );
          })()}
          {marketTicker && (
            <div className="flex justify-between">
              <span>Live Price</span>
              <span
                className={`font-mono tabular-nums ${
                  marketTicker.change24hPercent >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                ₹{marketTicker.priceInr.toFixed(5)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Chain ID</span>
            <span className="font-mono text-[#C9D3DF] tabular-nums">
              {chainInfo?.chainId ?? 5790032}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Block Height</span>
            <span className="font-mono text-[#E6EDF3] tabular-nums">
              #{chainInfo?.height.toLocaleString() ?? '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Supply</span>
            <span className="font-mono text-[#C9D3DF] tabular-nums">
              {chainInfo ? formatXYPH(chainInfo.supply, 2) : '—'} {SYMBOL}
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-[#0E121A] border-r border-[#1E2533] flex flex-col">
            <div className="h-16 px-5 flex items-center justify-between border-b border-[#1E2533]">
              <div className="flex items-center gap-2.5">
                <img
                  src={XYPHER_COIN_ICON_PATH}
                  alt="Xypher (XYPH)"
                  className="w-7 h-7 rounded-full object-cover ring-1 ring-white/15 shrink-0"
                />
                <span className="font-display text-lg font-bold text-[#E6EDF3]">Xypher</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-[#8B98A8] hover:text-[#E6EDF3]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium ${
                      isActive ? 'bg-[#18202E] text-[#E6EDF3]' : 'text-[#8B98A8]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-[#6B7788]'}`} />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Single-Row Top Header */}
        <header className="h-16 px-5 lg:px-8 border-b border-[#1E2533] bg-[#0E121A] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-[#8B98A8] hover:text-[#E6EDF3]"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-[#8B98A8] hidden sm:inline">{NETWORK_NAME}</span>
              <span className="text-[#364154] hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-[#E6EDF3] truncate">
                {activeNavTitle}
              </h1>
              {chainInfo && (
                <span className="hidden md:inline text-xs text-[#6B7788] font-mono ml-3 tabular-nums">
                  Block #{chainInfo.height.toLocaleString()} / {chainInfo.maxBlocks.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {authUser ? (
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setAuthModalMode('signin');
                }}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:border-amber-500/50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {authUser.photoURL ? (
                  <img
                    src={authUser.photoURL}
                    alt={authUser.displayName || 'User'}
                    referrerPolicy="no-referrer"
                    className="w-4 h-4 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="hidden sm:inline max-w-[120px] truncate">
                  {authUser.displayName || authUser.email?.split('@')[0] || 'Account'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setAuthModalMode('signin');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B0E14] bg-white rounded-md hover:bg-neutral-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 shrink-0" />
                <span>Sign In</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (mmAccount && !isOnXypherChain && evmWalletName !== 'Phantom') {
                  void handleAddXypherToMetaMask();
                } else if (mmAccount || phantomSolAccount) {
                  setActiveTab('wallets');
                } else if (!getEthereumProvider('metamask') && (getPhantomEvmProvider() || isPhantomSolanaAvailable())) {
                  void handleConnectPhantom();
                } else {
                  void handleConnectMetaMask();
                }
              }}
              disabled={mmBusy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
            >
              <Link2
                className={`w-3.5 h-3.5 ${
                  mmAccount && isOnXypherChain
                    ? 'text-emerald-400'
                    : evmWalletName === 'Phantom' || phantomSolAccount
                    ? 'text-violet-400'
                    : 'text-amber-400'
                }`}
              />
              {mmBusy
                ? 'Connecting...'
                : mmAccount
                ? isOnXypherChain || evmWalletName === 'Phantom'
                  ? `${evmWalletName || 'Wallet'} · ${truncateHash(mmAccount, 5, 4)}`
                  : `Switch to ${NETWORK_NAME}`
                : phantomSolAccount
                ? `Phantom · ${truncateHash(phantomSolAccount, 5, 4)}`
                : 'Connect Wallet'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('send')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Send {SYMBOL}
            </button>
          </div>
        </header>

        {/* Main Scroll Viewport */}
        <main className="flex-1 overflow-y-auto px-5 py-6 lg:px-8 lg:py-8">
          <div className="max-w-6xl mx-auto">
            {nodeError && (
              <div className="mb-6 p-3.5 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300 flex flex-wrap items-center justify-between gap-3">
                <span>Node connection error: {nodeError}</span>
                <button
                  type="button"
                  onClick={() => void refreshNodeState()}
                  className="px-3 py-1.5 rounded border border-red-400/40 bg-red-500/15 hover:bg-red-500/25 text-red-100 font-medium transition-colors cursor-pointer whitespace-nowrap"
                >
                  Reconnect
                </button>
              </div>
            )}

            {activeTab === 'wallets' && (
              <WalletsView
                chainInfo={chainInfo}
                marketTicker={marketTicker}
                wallets={wallets}
                balances={balances}
                loading={loading}
                mmAccount={mmAccount}
                mmChainId={mmChainId}
                evmWalletName={evmWalletName}
                phantomSolAccount={phantomSolAccount}
                phantomSolBalance={phantomSolBalance}
                publicBaseUrl={publicBaseUrl}
                mmBusy={mmBusy}
                mmError={mmError}
                mmNotice={mmNotice}
                onConnectMetaMask={handleConnectMetaMask}
                onConnectPhantom={handleConnectPhantom}
                onDisconnectPhantomSolana={handleDisconnectPhantomSolana}
                onAddXypherToMetaMask={handleAddXypherToMetaMask}
                onWatchXyphToken={handleWatchXyphToken}
                onCreateWallet={handleCreateWallet}
                onImportWif={handleImportWif}
                onDeleteWallet={handleDeleteWallet}
                onQuickSend={handleQuickSend}
                onGoToBuy={() => setActiveTab('buy')}
                onInspectTx={handleInspectTx}
                onRefreshBalances={refreshNodeState}
              />
            )}

            {activeTab === 'buy' && (
              <BuyView
                wallets={wallets}
                balances={balances}
                marketTicker={marketTicker}
                streamConnected={marketStreamConnected}
                mmAccount={mmAccount}
                mmChainId={mmChainId}
                evmWalletName={evmWalletName}
                mmBusy={mmBusy}
                mmError={mmError}
                mmNotice={mmNotice}
                publicBaseUrl={publicBaseUrl}
                onConnectMetaMask={handleConnectMetaMask}
                onConnectPhantom={handleConnectPhantom}
                onAddXypherToMetaMask={handleAddXypherToMetaMask}
                onWatchXyphToken={handleWatchXyphToken}
                onMarketUpdated={(ticker) => setMarketTicker(ticker)}
                onOrderSettled={(order) => {
                  pushLog(
                    'success',
                    `Credited ${order.xyphAmount.toLocaleString()} ${SYMBOL} for ₹${order.inrAmount} (UTR ${order.utr})`
                  );
                  void refreshNodeState();
                }}
                onSellSubmitted={(sellOrder) => {
                  const destLabel =
                    sellOrder.payoutMethod === 'bank'
                      ? `${sellOrder.bankName || 'Bank'} ${sellOrder.bankAccountMasked || ''}`.trim()
                      : sellOrder.upiId;
                  pushLog(
                    'success',
                    `Sold ${sellOrder.xyphAmount.toLocaleString()} ${SYMBOL} at live ₹${sellOrder.executionPriceInr.toFixed(5)}/XYPH (₹${sellOrder.inrPayout.toFixed(2)} to ${destLabel})`
                  );
                  void refreshNodeState();
                }}
                onInspectTx={handleInspectTx}
                onOpenCryptoExchange={() => setActiveTab('exchange')}
              />
            )}

            {activeTab === 'exchange' && (
              <CryptoExchangeView
                wallets={wallets}
                balances={balances}
                marketTicker={marketTicker}
                mmAccount={mmAccount}
                evmWalletName={evmWalletName}
                phantomSolAccount={phantomSolAccount}
                publicBaseUrl={publicBaseUrl}
                mmBusy={mmBusy}
                onConnectMetaMask={handleConnectMetaMask}
                onConnectPhantom={handleConnectPhantom}
                onMarketUpdated={(ticker) => setMarketTicker(ticker)}
                onExchangeSettled={(order) => {
                  pushLog(
                    'success',
                    `${order.kind === 'buy_xyph' ? 'Bought' : 'Exchanged'} ${order.fromAmount} ${order.fromCoin} → ${order.toAmount.toLocaleString()} ${order.toCoin}`
                  );
                  void refreshNodeState();
                }}
                onInspectTx={handleInspectTx}
              />
            )}

            {activeTab === 'send' && (
              <SendView
                chainInfo={chainInfo}
                wallets={wallets}
                balances={balances}
                mmAccount={mmAccount}
                evmWalletName={evmWalletName}
                publicBaseUrl={publicBaseUrl}
                initialFromAddress={sendTarget.address}
                initialUseMetaMask={sendTarget.useMetaMask}
                onConnectMetaMask={handleConnectMetaMask}
                onConnectPhantom={handleConnectPhantom}
                onBroadcastSuccess={(txid, amount, to) => {
                  pushLog(
                    'success',
                    `Sent ${formatXYPH(amount)} ${SYMBOL} to ${truncateHash(to, 8, 6)} (${truncateHash(
                      txid,
                      10,
                      6
                    )})`
                  );
                  void refreshNodeState();
                }}
                onInspectTx={handleInspectTx}
              />
            )}

            {activeTab === 'explorer' && (
              <ExplorerView
                chainInfo={chainInfo}
                blocks={blocks}
                totalBlocks={totalBlocks}
                mempool={mempool}
                inspectRequest={inspectRequest}
              />
            )}

            {activeTab === 'corecpp' && (
              <CoreCppView marketTicker={marketTicker} onLog={pushLog} />
            )}

            {activeTab === 'network' && (
              <NetworkView
                chainInfo={chainInfo}
                mmAccount={mmAccount}
                mmChainId={mmChainId}
                evmWalletName={evmWalletName}
                mmBusy={mmBusy}
                mmError={mmError}
                mmNotice={mmNotice}
                defaultLinkAddress={mmAccount || wallets[0]?.address || ''}
                onConnectMetaMask={handleConnectMetaMask}
                onConnectPhantom={handleConnectPhantom}
                onAddXypherToMetaMask={handleAddXypherToMetaMask}
                onWatchXyphToken={handleWatchXyphToken}
                onResetComplete={handleResetComplete}
                onLog={pushLog}
              />
            )}
          </div>
        </main>
      </div>

      {authModalMode && (
        <GoogleAuthModal
          user={authUser}
          linkedWallets={linkedWallets}
          balances={balances}
          authBusy={authBusy}
          authError={authError}
          initialMode={authModalMode}
          onGoogleAuth={handleGoogleAuth}
          onSignOut={handleGoogleSignOut}
          onClose={() => setAuthModalMode(null)}
        />
      )}
    </div>
  );
}
