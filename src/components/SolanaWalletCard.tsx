import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LogOut,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  type ConnectedSolanaSession,
  type DetectedSolanaWallet,
  SOLANA_CLUSTERS,
  connectPhantomSolanaWallet,
  connectSolanaWallet,
  disconnectSolanaWallet,
  fetchSolanaBalance,
  getConnectedSolanaSession,
  getSolanaCluster,
  sendSolTransfer,
  sendXypherSolanaLinkTx,
  setSolanaCluster,
  subscribeSolanaWallets,
} from '../lib/solanaWallet.ts';
import { getPhantomMobileDeepLink } from '../lib/metamask.ts';
import { SYMBOL } from '../lib/xypherCrypto.ts';

interface SolanaWalletCardProps {
  defaultLinkAddress?: string;
  publicBaseUrl?: string | null;
  onLog: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void;
}

export const SolanaWalletCard: React.FC<SolanaWalletCardProps> = ({
  defaultLinkAddress = '',
  publicBaseUrl = null,
  onLog,
}) => {
  const [detectedWallets, setDetectedWallets] = useState<DetectedSolanaWallet[]>([]);
  const [clusterId, setClusterId] = useState<'mainnet' | 'devnet'>(() => getSolanaCluster().id);
  const [session, setSession] = useState<ConnectedSolanaSession | null>(() =>
    getConnectedSolanaSession()
  );
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const [connectingName, setConnectingName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  const [recipientAddress, setRecipientAddress] = useState('');
  const [amountSol, setAmountSol] = useState('0.001');
  const [sendingTx, setSendingTx] = useState(false);
  const [linkingTx, setLinkingTx] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribeSolanaWallets((list) => {
      setDetectedWallets(list);
    });
  }, []);

  const refreshBalance = async (addr: string) => {
    setLoadingBalance(true);
    try {
      const bal = await fetchSolanaBalance(addr);
      setSolBalance(bal.sol);
    } catch {
      setSolBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  };

  useEffect(() => {
    if (session?.address) {
      void refreshBalance(session.address);
    } else {
      setSolBalance(null);
    }
  }, [session?.address, clusterId]);

  const handleClusterSwitch = (next: 'mainnet' | 'devnet') => {
    const cfg = setSolanaCluster(next);
    setClusterId(cfg.id);
    if (session) {
      setSession({ ...session, cluster: cfg });
    }
    setStatusMsg(`Switched Solana RPC cluster to ${cfg.name} (${cfg.chain}).`);
  };

  const handleConnect = async (item: DetectedSolanaWallet) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setConnectingName(item.name);
    try {
      const nextSession = item.wallet
        ? await connectSolanaWallet(item.wallet)
        : await connectPhantomSolanaWallet();
      setSession(nextSession);
      setStatusMsg(
        `Connected ${nextSession.walletName} (${nextSession.cluster.chain}).`
      );
      onLog(
        'success',
        `Connected Solana wallet ${nextSession.walletName}: ${nextSession.address.slice(0, 8)}...`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect Solana wallet';
      setErrorMsg(msg);
      onLog('error', `Solana wallet connect failed: ${msg}`);
    } finally {
      setConnectingName(null);
    }
  };

  const handleDirectPhantomConnect = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setConnectingName('Phantom');
    try {
      const nextSession = await connectPhantomSolanaWallet();
      setSession(nextSession);
      setStatusMsg(`Connected Phantom Wallet (${nextSession.cluster.chain}).`);
      onLog('success', `Connected Phantom Solana wallet: ${nextSession.address.slice(0, 8)}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect Phantom Wallet';
      setErrorMsg(msg);
      onLog('error', `Phantom connect failed: ${msg}`);
    } finally {
      setConnectingName(null);
    }
  };

  const handleDisconnect = async () => {
    await disconnectSolanaWallet();
    setSession(null);
    setSolBalance(null);
    setLastSignature(null);
    setStatusMsg('Disconnected Solana wallet.');
  };

  const handleSendSol = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setLastSignature(null);

    const parsedAmt = Number(amountSol);
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      setErrorMsg('Enter a valid SOL amount greater than 0.');
      return;
    }

    setSendingTx(true);
    try {
      setStatusMsg('Confirm Solana transaction in your connected wallet...');
      const signature = await sendSolTransfer({
        recipientAddress,
        amountSol: parsedAmt,
      });
      setLastSignature(signature);
      setStatusMsg(`Transaction confirmed on ${SOLANA_CLUSTERS[clusterId].name}.`);
      setRecipientAddress('');
      onLog('success', `Solana tx confirmed via solana:signAndSendTransaction: ${signature.slice(0, 14)}...`);
      if (session?.address) {
        void refreshBalance(session.address);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Solana transaction failed';
      setErrorMsg(msg);
      onLog('error', `Solana tx error: ${msg}`);
    } finally {
      setSendingTx(false);
    }
  };

  const handleLinkOnChain = async () => {
    if (!defaultLinkAddress) {
      setErrorMsg('Create a Xypher wallet or connect MetaMask / Phantom first to anchor a link.');
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    setLastSignature(null);
    setLinkingTx(true);
    try {
      setStatusMsg('Approve Solana Memo attestation in your connected wallet...');
      const signature = await sendXypherSolanaLinkTx(defaultLinkAddress);
      setLastSignature(signature);
      setStatusMsg(
        `Anchored Xypher wallet link on ${SOLANA_CLUSTERS[clusterId].name} via solana:signAndSendTransaction.`
      );
      onLog('success', `Linked Solana wallet to ${SYMBOL} on-chain: ${signature.slice(0, 14)}...`);
      if (session?.address) {
        void refreshBalance(session.address);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Solana link transaction failed';
      setErrorMsg(msg);
      onLog('error', `Solana link error: ${msg}`);
    } finally {
      setLinkingTx(false);
    }
  };

  const activeCluster = SOLANA_CLUSTERS[clusterId];
  const phantomMobileUrl = getPhantomMobileDeepLink(publicBaseUrl);

  const copyAddress = () => {
    if (!session?.address) return;
    navigator.clipboard.writeText(session.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-violet-400" />
            <h2 className="text-base font-semibold text-[#E6EDF3]">
              Phantom &amp; Solana Wallet Standard (<span className="font-mono">solana:signAndSendTransaction</span>)
            </h2>
          </div>
          <p className="text-xs text-[#8B98A8] mt-0.5">
            Connect Phantom Wallet (Solana &amp; Wallet Standard), MetaMask Solana, Solflare, or Backpack to sign, broadcast, and confirm real Solana transactions with <span className="font-mono text-[#E6EDF3]">bs58</span> signatures.
          </p>
        </div>

        {/* Cluster Switcher */}
        <div className="inline-flex rounded-md border border-[#2A3446] bg-[#0B0E14] p-0.5 shrink-0">
          {(['mainnet', 'devnet'] as const).map((cid) => (
            <button
              key={cid}
              type="button"
              onClick={() => handleClusterSwitch(cid)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                clusterId === cid
                  ? 'bg-amber-500 text-[#0B0E14] font-semibold'
                  : 'text-[#8B98A8] hover:text-[#E6EDF3]'
              }`}
            >
              {cid === 'mainnet' ? 'Mainnet' : 'Devnet'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-5">
        {statusMsg && (
          <div className="p-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
            {errorMsg}
          </div>
        )}

        {lastSignature && (
          <div className="p-3.5 rounded-md border border-emerald-500/30 bg-[#0B0E14] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <div className="text-emerald-400 font-medium">Confirmed Solana Signature (bs58)</div>
              <div className="font-mono text-[#E6EDF3] truncate mt-0.5">{lastSignature}</div>
            </div>
            <a
              href={`${activeCluster.explorerUrl}/tx/${lastSignature}${activeCluster.explorerQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View on Solscan
            </a>
          </div>
        )}

        {!session ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-medium text-[#C9D3DF]">
                Detected Solana Providers ({detectedWallets.length})
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDirectPhantomConnect()}
                  disabled={connectingName !== null}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-violet-600 rounded-md hover:bg-violet-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  {connectingName === 'Phantom' ? 'Connecting Phantom...' : 'Connect Phantom Wallet'}
                </button>
                {phantomMobileUrl && (
                  <a
                    href={phantomMobileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:border-violet-400/50 hover:bg-[#232C3D] transition-colors whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-violet-400" />
                    Open in Phantom Mobile
                  </a>
                )}
              </div>
            </div>

            {detectedWallets.length === 0 ? (
              <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] text-xs text-[#8B98A8] space-y-1">
                <div className="text-[#E6EDF3] font-medium">
                  No Solana browser extension detected in this tab yet.
                </div>
                <p>
                  Install{' '}
                  <a
                    href="https://phantom.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:underline"
                  >
                    Phantom Wallet
                  </a>
                  , Solflare, or Backpack and open this app in a full browser tab (or Phantom Mobile) to connect via{' '}
                  <span className="font-mono text-[#C9D3DF]">solana:signAndSendTransaction</span>.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {detectedWallets.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void handleConnect(item)}
                    disabled={connectingName !== null}
                    className="p-3.5 rounded-md border border-[#2A3446] bg-[#0B0E14] hover:border-violet-400/60 flex items-center justify-between gap-3 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {item.icon ? (
                        <img
                          src={item.icon}
                          alt={item.name}
                          className="w-6 h-6 rounded object-contain shrink-0"
                        />
                      ) : (
                        <Wallet className="w-5 h-5 text-violet-400 shrink-0" />
                      )}
                      <div className="text-left min-w-0">
                        <div className="text-xs font-semibold text-[#E6EDF3] truncate">
                          {item.name}
                        </div>
                        <div className="text-[11px] font-mono text-[#8B98A8] truncate">
                          {activeCluster.chain}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-amber-400 whitespace-nowrap shrink-0">
                      {connectingName === item.name ? 'Connecting...' : 'Connect'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Connected Account Bar */}
            <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {session.walletIcon ? (
                  <img
                    src={session.walletIcon}
                    alt={session.walletName}
                    className="w-8 h-8 rounded object-contain shrink-0"
                  />
                ) : (
                  <Wallet className="w-6 h-6 text-amber-400 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-[#E6EDF3]">{session.walletName}</span>
                    <span className="font-mono text-emerald-400">{activeCluster.chain}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-xs text-[#C9D3DF] truncate">
                      {session.address}
                    </span>
                    <button
                      type="button"
                      onClick={copyAddress}
                      className="p-1 text-[#8B98A8] hover:text-amber-400 shrink-0 cursor-pointer"
                      title="Copy Solana address"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-[11px] text-[#8B98A8]">Live Balance</div>
                  <div className="font-mono text-sm font-semibold text-[#E6EDF3] tabular-nums">
                    {solBalance !== null ? `${solBalance.toFixed(6)} SOL` : '— SOL'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshBalance(session.address)}
                  disabled={loadingBalance}
                  title="Refresh SOL balance"
                  className="p-2 text-[#8B98A8] hover:text-amber-400 bg-[#1B2230] border border-[#2A3446] rounded-md cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingBalance ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </div>
            </div>

            {/* Real Sign & Send Transaction Form */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <form
                onSubmit={handleSendSol}
                className="lg:col-span-8 p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] space-y-3"
              >
                <div className="text-xs font-semibold text-[#E6EDF3]">
                  Send Real SOL via <span className="font-mono text-amber-400">signAndSendTransaction</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <input
                    type="text"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder="Recipient Solana address (Base58)"
                    className="sm:col-span-7 px-3 py-2 text-xs font-mono bg-[#121721] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                    required
                  />
                  <input
                    type="number"
                    step="0.000001"
                    min="0.000001"
                    value={amountSol}
                    onChange={(e) => setAmountSol(e.target.value)}
                    placeholder="Amount SOL"
                    className="sm:col-span-2 px-3 py-2 text-xs font-mono tabular-nums bg-[#121721] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={sendingTx}
                    className="sm:col-span-3 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sendingTx ? 'Signing...' : 'Sign & Send'}
                  </button>
                </div>
              </form>

              <div className="lg:col-span-4 p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] flex flex-col justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[#E6EDF3]">
                    Verify Link to {SYMBOL} On-Chain
                  </div>
                  <p className="text-[11px] text-[#8B98A8] mt-1">
                    Signs a Solana Memo transaction anchoring your active {SYMBOL} / MetaMask wallet address.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleLinkOnChain()}
                  disabled={linkingTx || !defaultLinkAddress}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:border-amber-500/60 hover:bg-[#232C3D] whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <Link2 className="w-3.5 h-3.5 text-amber-400" />
                  {linkingTx ? 'Confirming...' : `Anchor ${SYMBOL} Link`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
