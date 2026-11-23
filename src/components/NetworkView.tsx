import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  FlaskConical,
  Globe,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { type NetworkGatewayStatus, xypherApi } from '../lib/api.ts';
import {
  type EvmWalletName,
  XYPHER_COIN_ICON_PATH,
  getXypherCoinIconUrl,
  getXypherEvmRpcUrl,
} from '../lib/metamask.ts';
import { SmartContractDeployer } from './SmartContractDeployer.tsx';
import { SolanaWalletCard } from './SolanaWalletCard.tsx';
import type { ChainInfo, NetworkProfile, SelfTestResultItem } from '../lib/types.ts';
import {
  MAX_BLOCKS,
  NETWORK_FEE_XYPH,
  NETWORK_NAME,
  PROFILE_CONFIGS,
  SYMBOL,
  XYPH_TOKEN_CONTRACT_EVM,
  XYPH_TOKEN_DECIMALS,
  XYPH_TOKEN_NATIVE_ADDRESS,
  XYPHER_CHAIN_ID,
  XYPHER_CHAIN_ID_HEX,
  formatXYPH,
} from '../lib/xypherCrypto.ts';

interface NetworkViewProps {
  chainInfo: ChainInfo | null;
  mmAccount: string | null;
  mmChainId: string | null;
  evmWalletName: EvmWalletName | null;
  mmBusy: boolean;
  mmError: string | null;
  mmNotice: string | null;
  defaultLinkAddress?: string;
  onConnectMetaMask: () => Promise<void>;
  onConnectPhantom: () => Promise<void>;
  onAddXypherToMetaMask: () => Promise<void>;
  onWatchXyphToken: () => Promise<void>;
  onResetComplete: (profile: NetworkProfile) => void;
  onLog: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void;
}

export const NetworkView: React.FC<NetworkViewProps> = ({
  chainInfo,
  mmAccount,
  mmChainId,
  evmWalletName,
  mmBusy,
  mmError,
  mmNotice,
  defaultLinkAddress,
  onConnectMetaMask,
  onConnectPhantom,
  onAddXypherToMetaMask,
  onWatchXyphToken,
  onResetComplete,
  onLog,
}) => {
  const [gateway, setGateway] = useState<NetworkGatewayStatus | null>(null);
  const [activateKeyInput, setActivateKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const [evmVerifyBusy, setEvmVerifyBusy] = useState(false);
  const [evmVerifyOutput, setEvmVerifyOutput] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const [publicTestKey, setPublicTestKey] = useState('');
  const [publicTestBusy, setPublicTestBusy] = useState(false);
  const [publicTestResult, setPublicTestResult] = useState<{ ok: boolean; output: string } | null>(
    null
  );

  const [peerUrl, setPeerUrl] = useState('');
  const [peerLabel, setPeerLabel] = useState('');
  const [peerError, setPeerError] = useState<string | null>(null);
  const [addingPeer, setAddingPeer] = useState(false);
  const [syncingPeerId, setSyncingPeerId] = useState<string | null>(null);

  const [rpcMethod, setRpcMethod] = useState('getinfo');
  const [rpcAddrParam, setRpcAddrParam] = useState('');
  const [rpcOutput, setRpcOutput] = useState<string | null>(null);
  const [rpcBusy, setRpcBusy] = useState(false);

  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    height: number;
    utxoCount: number;
    blocksChecked: number;
    error?: string;
  } | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<{
    allPassed: boolean;
    results: SelfTestResultItem[];
  } | null>(null);

  const [selectedProfile, setSelectedProfile] = useState<NetworkProfile>(
    chainInfo?.profile || 'private-fast'
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadGateway = async () => {
    try {
      const data = await xypherApi.getGatewayStatus();
      setGateway(data);
    } catch {
      // Ignore transient errors
    }
  };

  useEffect(() => {
    void loadGateway();
  }, []);

  useEffect(() => {
    if (chainInfo?.profile) setSelectedProfile(chainInfo.profile);
  }, [chainInfo?.profile]);

  const publicOrigin =
    gateway?.publicBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const evmRpcUrl = getXypherEvmRpcUrl(gateway?.publicBaseUrl);
  const coinIconUrl = getXypherCoinIconUrl(gateway?.publicBaseUrl);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
  };

  const handleVerifyEvmRpc = async () => {
    setEvmVerifyBusy(true);
    setEvmVerifyOutput(null);
    try {
      const [chainRes, blockRes, gasRes] = await Promise.all([
        xypherApi.callEvmRpc('eth_chainId'),
        xypherApi.callEvmRpc('eth_blockNumber'),
        xypherApi.callEvmRpc('eth_gasPrice'),
      ]);
      const height = parseInt(String(blockRes.result || '0x0'), 16);
      const gasPriceWei = BigInt(String(gasRes.result || '0x0'));
      const txFeeXyph = Number(gasPriceWei * 21_000n) / 1e18;
      setEvmVerifyOutput({
        ok: true,
        text: `${NETWORK_NAME} Public EVM RPC verified · eth_chainId=${String(
          chainRes.result
        )} (${XYPHER_CHAIN_ID}), eth_blockNumber=${String(
          blockRes.result
        )} (Block #${height}), eth_gasPrice=${String(gasRes.result)} (~${txFeeXyph.toFixed(
          2
        )} ${SYMBOL} / 21k gas)`,
      });
      onLog('success', `Verified public ${NETWORK_NAME} EVM RPC at Block #${height} (${NETWORK_FEE_XYPH} ${SYMBOL} fee)`);
    } catch (err) {
      setEvmVerifyOutput({
        ok: false,
        text: err instanceof Error ? err.message : 'EVM RPC verification failed',
      });
    } finally {
      setEvmVerifyBusy(false);
    }
  };

  const handleActivateGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    setActivateError(null);
    if (activateKeyInput.trim().length < 16) {
      setActivateError('Enter an API key of at least 16 characters.');
      return;
    }
    setActivating(true);
    try {
      await xypherApi.activateGatewayKey(activateKeyInput.trim());
      setPublicTestKey(activateKeyInput.trim());
      setActivateKeyInput('');
      onLog('success', 'Public blockchain network API gateway activated (key hashed server-side)');
      await loadGateway();
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setActivating(false);
    }
  };

  const handleTestPublicGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicTestKey.trim()) return;
    setPublicTestBusy(true);
    setPublicTestResult(null);
    try {
      const res = await xypherApi.testPublicRpc(publicTestKey.trim(), 'getinfo', {});
      setPublicTestResult({ ok: true, output: JSON.stringify(res, null, 2) });
      onLog('success', 'Authenticated public network RPC test succeeded');
    } catch (err) {
      setPublicTestResult({
        ok: false,
        output: err instanceof Error ? err.message : 'Request rejected',
      });
    } finally {
      setPublicTestBusy(false);
    }
  };

  const handleAddPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    setPeerError(null);
    if (!peerUrl.trim()) return;
    setAddingPeer(true);
    try {
      const res = await xypherApi.addPeer(peerUrl.trim(), peerLabel.trim() || 'Public Peer');
      setPeerUrl('');
      setPeerLabel('');
      onLog('success', `Registered public peer ${res.peer.url}`);
      await loadGateway();
    } catch (err) {
      setPeerError(err instanceof Error ? err.message : 'Unable to register peer');
    } finally {
      setAddingPeer(false);
    }
  };

  const handleSyncPeer = async (id: string) => {
    setSyncingPeerId(id);
    try {
      const res = await xypherApi.syncPeer(id);
      onLog(
        res.ok ? 'success' : 'warn',
        res.ok
          ? `Peer ${res.peer.label} reachable at height #${res.peer.lastSeenHeight ?? '?'}`
          : `Peer ${res.peer.label} unreachable`
      );
      await loadGateway();
    } finally {
      setSyncingPeerId(null);
    }
  };

  const handleRemovePeer = async (id: string) => {
    await xypherApi.removePeer(id);
    await loadGateway();
  };

  const handleRunRpc = async () => {
    setRpcBusy(true);
    try {
      const params: Record<string, unknown> = {};
      if ((rpcMethod === 'balance' || rpcMethod === 'coins') && rpcAddrParam.trim()) {
        params.address = rpcAddrParam.trim();
      }
      const res = await xypherApi.callRpc(rpcMethod, params);
      setRpcOutput(JSON.stringify(res, null, 2));
    } catch (err) {
      setRpcOutput(
        JSON.stringify({ error: err instanceof Error ? err.message : 'RPC call failed' }, null, 2)
      );
    } finally {
      setRpcBusy(false);
    }
  };

  const handleValidateChain = async () => {
    setValidating(true);
    try {
      const res = await xypherApi.validateChain();
      setValidationResult(res);
      onLog(
        res.valid ? 'success' : 'error',
        res.valid
          ? `Full chain verified: ${res.blocksChecked} blocks, ${res.utxoCount} UTXOs`
          : `Chain validation failed: ${res.error}`
      );
    } finally {
      setValidating(false);
    }
  };

  const handleRunSelfTest = async () => {
    setTesting(true);
    try {
      const res = await xypherApi.runSelfTest();
      setTestResults(res);
      onLog(
        res.allPassed ? 'success' : 'error',
        res.allPassed
          ? `Consensus self-test passed (${res.results.length}/${res.results.length} checks)`
          : 'Consensus self-test reported failures'
      );
    } finally {
      setTesting(false);
    }
  };

  const handleResetNetwork = async () => {
    setResetting(true);
    try {
      const res = await xypherApi.resetNetwork(selectedProfile);
      setConfirmReset(false);
      onResetComplete(res.profile);
    } finally {
      setResetting(false);
    }
  };

  const curlSnippet = `curl -X POST "${publicOrigin}/api/public/rpc" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <YOUR_NETWORK_API_KEY>" \\
  -d '{"id":1,"method":"getinfo","params":{}}'`;

  const eip3085ConfigJson = JSON.stringify(
    {
      chainId: XYPHER_CHAIN_ID_HEX,
      chainName: NETWORK_NAME,
      nativeCurrency: {
        name: SYMBOL,
        symbol: SYMBOL,
        decimals: 18,
      },
      rpcUrls: [evmRpcUrl],
      blockExplorerUrls: publicOrigin ? [publicOrigin] : [],
      networkFee: `${NETWORK_FEE_XYPH} ${SYMBOL}`,
      maxBlocks: MAX_BLOCKS,
    },
    null,
    2
  );

  const watchAssetSnippet = `await window.ethereum.request({
  method: 'wallet_watchAsset',
  params: {
    type: 'ERC20',
    options: {
      address: '${XYPH_TOKEN_CONTRACT_EVM}',
      symbol: '${SYMBOL}',
      decimals: ${XYPH_TOKEN_DECIMALS},
      image: '${coinIconUrl}',
    },
  },
});`;

  const supplyPercent = chainInfo
    ? Math.min(100, (chainInfo.supply / chainInfo.maxSupply) * 100)
    : 0;

  const isOnXypherChain = mmChainId?.toLowerCase() === XYPHER_CHAIN_ID_HEX.toLowerCase();

  return (
    <div className="space-y-8">
      {/* Real Multi-Chain Solidity ERC-20 Smart Contract Deployer (Public Worldwide) */}
      <SmartContractDeployer
        mmAccount={mmAccount}
        mmChainId={mmChainId}
        publicBaseUrl={gateway?.publicBaseUrl || null}
        onLog={onLog}
      />

      {/* Wallet Standard & Phantom Solana Connection & SignAndSendTransaction */}
      <SolanaWalletCard
        defaultLinkAddress={defaultLinkAddress || mmAccount || ''}
        publicBaseUrl={gateway?.publicBaseUrl || null}
        onLog={onLog}
      />

      {/* Public Polygon-Style Custom EVM Network: XYPH Network */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-amber-400" />
              <h2 className="text-base font-semibold text-[#E6EDF3]">
                {NETWORK_NAME} — Public EVM Blockchain (Polygon-Compatible · {NETWORK_FEE_XYPH} {SYMBOL} Network Fee)
              </h2>
            </div>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Publicly accessible EVM JSON-RPC 2.0 network at{' '}
              <span className="font-mono text-[#E6EDF3]">/evm-rpc</span> with{' '}
              <span className="font-mono text-emerald-400">{NETWORK_FEE_XYPH} {SYMBOL}</span> zero network fee and{' '}
              <span className="font-mono text-[#E6EDF3]">{MAX_BLOCKS.toLocaleString()}</span> max blocks. Works globally in MetaMask, Phantom, Hardhat, and Web3 apps.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleVerifyEvmRpc()}
              disabled={evmVerifyBusy}
              className="px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {evmVerifyBusy ? 'Checking RPC...' : 'Verify Live RPC'}
            </button>
            <button
              type="button"
              onClick={() => void onWatchXyphToken()}
              disabled={mmBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:border-amber-500/50 hover:bg-[#232C3D] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
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
              className="px-3.5 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              Add {NETWORK_NAME}
            </button>
            <button
              type="button"
              onClick={() => void onConnectPhantom()}
              disabled={mmBusy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-violet-600 rounded-md hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Wallet className="w-3.5 h-3.5" />
              {evmWalletName === 'Phantom' ? 'Phantom Connected' : 'Connect Phantom'}
            </button>
            <button
              type="button"
              onClick={() => void onConnectMetaMask()}
              disabled={mmBusy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Wallet className="w-3.5 h-3.5" />
              {mmAccount && evmWalletName !== 'Phantom'
                ? isOnXypherChain
                  ? 'MetaMask Connected'
                  : `Switch to ${NETWORK_NAME}`
                : 'Connect MetaMask'}
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {mmNotice && (
            <div className="p-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300">
              {mmNotice}
            </div>
          )}

          {mmError && (
            <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
              {mmError}
            </div>
          )}

          {evmVerifyOutput && (
            <div
              className={`p-3 rounded-md border text-xs font-mono ${
                evmVerifyOutput.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
            >
              {evmVerifyOutput.text}
            </div>
          )}

          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-[#C9D3DF]">
                Public {NETWORK_NAME} Parameters (Add to MetaMask / Phantom / Hardhat / ChainList)
              </p>
              <button
                type="button"
                onClick={() => copyText(eip3085ConfigJson, 'eip3085-json')}
                className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                {copiedId === 'eip3085-json' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied EIP-3085 JSON
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy EIP-3085 Network JSON
                  </>
                )}
              </button>
            </div>
            <div className="divide-y divide-[#1D2432] border border-[#1E2533] rounded-md bg-[#0B0E14]">
              {[
                { id: 'mm-name', label: 'Network Name', value: NETWORK_NAME },
                { id: 'mm-rpc', label: 'Public RPC URL (CORS Open)', value: evmRpcUrl },
                { id: 'mm-chain', label: 'Chain ID', value: `${chainInfo?.chainId ?? XYPHER_CHAIN_ID} (${chainInfo?.chainIdHex ?? XYPHER_CHAIN_ID_HEX})` },
                { id: 'mm-sym', label: 'Currency Symbol', value: SYMBOL },
                { id: 'mm-fee', label: 'Network Fee', value: `${chainInfo?.networkFeeXyph ?? NETWORK_FEE_XYPH} ${SYMBOL} (Zero Gas)` },
                { id: 'mm-blocks', label: 'Max Real Block Capacity', value: `${(chainInfo?.maxBlocks ?? MAX_BLOCKS).toLocaleString()} blocks` },
                { id: 'mm-manifest', label: 'Public Network Manifest', value: `${publicOrigin}/api/public/network` },
                { id: 'mm-exp', label: 'Block Explorer URL', value: publicOrigin },
              ].map((row) => (
                <div
                  key={row.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-4"
                >
                  <span className="text-[#8B98A8] whitespace-nowrap">{row.label}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[#E6EDF3] truncate">{row.value}</span>
                    <button
                      type="button"
                      onClick={() => copyText(row.value, row.id)}
                      className="p-1 text-[#8B98A8] hover:text-amber-400 shrink-0 cursor-pointer"
                      title={`Copy ${row.label}`}
                    >
                      {copiedId === row.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Official XYPH Coin Profile Picture & ERC-20 Token Import (wallet_watchAsset) */}
          <div className="pt-5 border-t border-[#1D2432] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <img
                  src={XYPHER_COIN_ICON_PATH}
                  alt="Xypher (XYPH) Coin Profile Picture"
                  className="w-12 h-12 rounded-full object-cover ring-1 ring-white/20 shrink-0"
                />
                <div>
                  <h3 className="text-sm font-semibold text-[#E6EDF3]">
                    {SYMBOL} Coin Profile Picture in MetaMask (ERC-20 / <span className="font-mono">wallet_watchAsset</span>)
                  </h3>
                  <p className="text-xs text-[#8B98A8] mt-0.5">
                    MetaMask displays a custom coin&apos;s profile picture inside your Tokens tab when imported via <span className="font-mono text-[#C9D3DF]">wallet_watchAsset</span> using the 20-byte EVM contract address mapped 1-to-1 from <span className="font-mono text-[#C9D3DF]">{XYPH_TOKEN_NATIVE_ADDRESS}</span>.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onWatchXyphToken()}
                disabled={mmBusy}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <img
                  src={XYPHER_COIN_ICON_PATH}
                  alt="XYPH"
                  className="w-4 h-4 rounded-full object-cover shrink-0"
                />
                Import {SYMBOL} Picture in MetaMask
              </button>
            </div>

            <div className="divide-y divide-[#1D2432] border border-[#1E2533] rounded-md bg-[#0B0E14] text-xs">
              {[
                {
                  id: 'tok-evm',
                  label: 'Token Contract Address (MetaMask 0x)',
                  value: XYPH_TOKEN_CONTRACT_EVM,
                },
                {
                  id: 'tok-native',
                  label: 'Mapped Native Xypher Address',
                  value: XYPH_TOKEN_NATIVE_ADDRESS,
                },
                {
                  id: 'tok-meta',
                  label: 'Token Symbol & Decimals',
                  value: `${SYMBOL} · ${XYPH_TOKEN_DECIMALS} decimals`,
                },
                {
                  id: 'tok-img',
                  label: 'Coin Profile Picture URL',
                  value: coinIconUrl,
                },
              ].map((row) => (
                <div
                  key={row.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-4"
                >
                  <span className="text-[#8B98A8] whitespace-nowrap">{row.label}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[#E6EDF3] truncate">{row.value}</span>
                    <button
                      type="button"
                      onClick={() => copyText(row.value, row.id)}
                      className="p-1 text-[#8B98A8] hover:text-amber-400 shrink-0 cursor-pointer"
                      title={`Copy ${row.label}`}
                    >
                      {copiedId === row.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#C9D3DF]">
                  Public <span className="font-mono">wallet_watchAsset</span> Snippet (MetaMask Console / dApp)
                </span>
                <button
                  type="button"
                  onClick={() => copyText(watchAssetSnippet, 'watch-snippet')}
                  className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 cursor-pointer"
                >
                  {copiedId === 'watch-snippet' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Snippet
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3.5 rounded-md bg-[#0B0E14] border border-[#1E2533] text-[11px] font-mono text-[#C9D3DF] overflow-x-auto leading-relaxed">
                {watchAssetSnippet}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Public Blockchain Network Gateway */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-amber-400" />
              <h2 className="text-base font-semibold text-[#E6EDF3]">
                Public Blockchain Network Gateway
              </h2>
            </div>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Connect external wallets, Python CLI nodes (<span className="font-mono">Xypher__XYPH0</span>), and public peers over HTTPS.
            </p>
          </div>
          <span
            className={`text-xs font-medium whitespace-nowrap ${
              gateway?.apiKeyConfigured ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {gateway?.authMode === 'env'
              ? 'Active · Server Secret (XYPHER_NETWORK_API_KEY)'
              : gateway?.authMode === 'claimed'
              ? 'Active · Server Key Hash Verified'
              : 'Activation Required'}
          </span>
        </div>

        {/* One-time Gateway Key Activation Banner */}
        {gateway && !gateway.apiKeyConfigured && (
          <form
            onSubmit={handleActivateGateway}
            className="px-6 py-4 border-b border-[#222A38] bg-amber-500/5 space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <KeyRound className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-[#E6EDF3]">
                  Activate Public Network API Key
                </p>
                <p className="text-xs text-[#9AA6B6]">
                  Paste your public network API key below to authorize external{' '}
                  <span className="font-mono text-[#E6EDF3]">/api/public/*</span> writes and RPC
                  requests. Only a salted scrypt hash is stored on the server; you can also set{' '}
                  <span className="font-mono text-[#E6EDF3]">XYPHER_NETWORK_API_KEY</span> in
                  Settings &rarr; Secrets to override it at any time.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="password"
                value={activateKeyInput}
                onChange={(e) => setActivateKeyInput(e.target.value)}
                placeholder="Paste your network API key (min 16 characters)"
                autoComplete="off"
                className="flex-1 px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                required
              />
              <button
                type="submit"
                disabled={activating}
                className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                {activating ? 'Activating...' : 'Activate Public API'}
              </button>
            </div>
            {activateError && <p className="text-xs text-red-400">{activateError}</p>}
          </form>
        )}

        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Endpoints + Live Auth Test + Curl */}
          <div className="lg:col-span-7 space-y-5">
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-medium text-[#C9D3DF]">Published Network Endpoints</p>
                {publicOrigin && (
                  <button
                    type="button"
                    onClick={() => copyText(publicOrigin, 'origin')}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-[#8B98A8] hover:text-amber-400 cursor-pointer"
                  >
                    {copiedId === 'origin' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        Copied Base URL
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        {publicOrigin}
                      </>
                    )}
                  </button>
                )}
              </div>
              <div className="divide-y divide-[#1D2432] border border-[#1E2533] rounded-md bg-[#0B0E14] font-mono">
                {[
                  { method: 'POST', path: '/evm-rpc', auth: 'Public EVM JSON-RPC 2.0' },
                  { method: 'GET', path: '/api/public/network', auth: 'Public Network Manifest' },
                  { method: 'GET', path: '/api/public/info', auth: 'Public Read' },
                  { method: 'GET', path: '/api/public/blocks', auth: 'Public Read' },
                  { method: 'GET', path: '/api/public/blocks/:id', auth: 'Public Read' },
                  { method: 'GET', path: '/api/public/tx/:txid', auth: 'Public Read' },
                  { method: 'GET', path: '/api/public/address/:addr', auth: 'Public Read' },
                  { method: 'GET', path: '/api/public/mempool', auth: 'Public Read' },
                  { method: 'POST', path: '/api/public/tx/broadcast', auth: 'Bearer API Key' },
                  { method: 'POST', path: '/api/public/blocks/submit', auth: 'Bearer API Key' },
                  { method: 'POST', path: '/api/public/rpc', auth: 'Bearer API Key' },
                  { method: 'GET', path: '/api/public/peers', auth: 'Bearer API Key' },
                ].map((ep) => (
                  <div
                    key={ep.path}
                    className="px-3.5 py-2 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={
                          ep.method === 'GET'
                            ? 'text-emerald-400 font-semibold'
                            : 'text-amber-400 font-semibold'
                        }
                      >
                        {ep.method}
                      </span>
                      <span className="text-[#E6EDF3] truncate">{ep.path}</span>
                    </div>
                    <span className="text-[11px] text-[#8B98A8] font-sans whitespace-nowrap shrink-0">
                      {ep.auth}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {gateway?.apiKeyConfigured && (
              <form onSubmit={handleTestPublicGateway} className="space-y-2.5">
                <p className="text-xs font-medium text-[#C9D3DF]">
                  Verify Authenticated Public RPC (<span className="font-mono">/api/public/rpc</span>)
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="password"
                    value={publicTestKey}
                    onChange={(e) => setPublicTestKey(e.target.value)}
                    placeholder="Enter API key to test Bearer auth (held in memory only)"
                    autoComplete="off"
                    className="flex-1 px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={publicTestBusy || !publicTestKey.trim()}
                    className="px-4 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {publicTestBusy ? 'Testing...' : 'Test Public RPC'}
                  </button>
                </div>
                {publicTestResult && (
                  <pre
                    className={`p-3 rounded-md bg-[#0B0E14] border text-[11px] font-mono max-h-40 overflow-auto ${
                      publicTestResult.ok
                        ? 'border-emerald-500/30 text-emerald-300'
                        : 'border-red-500/30 text-red-300'
                    }`}
                  >
                    {publicTestResult.output}
                  </pre>
                )}
              </form>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#C9D3DF]">External Client cURL Example</span>
                <button
                  type="button"
                  onClick={() => copyText(curlSnippet, 'curl')}
                  className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 cursor-pointer"
                >
                  {copiedId === 'curl' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy curl
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3.5 rounded-md bg-[#0B0E14] border border-[#1E2533] text-[11px] font-mono text-[#C9D3DF] overflow-x-auto leading-relaxed">
                {curlSnippet}
              </pre>
            </div>
          </div>

          {/* Peer Registry */}
          <div className="lg:col-span-5 space-y-4">
            <p className="text-xs font-medium text-[#C9D3DF]">Public Peer Registry</p>
            <form onSubmit={handleAddPeer} className="space-y-2.5">
              <input
                type="url"
                value={peerUrl}
                onChange={(e) => setPeerUrl(e.target.value)}
                placeholder="https://peer-node.example.com"
                className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                required
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={peerLabel}
                  onChange={(e) => setPeerLabel(e.target.value)}
                  placeholder="Peer label (optional)"
                  className="flex-1 px-3 py-2 text-xs bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={addingPeer}
                  className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Peer
                </button>
              </div>
              {peerError && <p className="text-xs text-red-400">{peerError}</p>}
            </form>

            <div className="border border-[#1E2533] rounded-md bg-[#0B0E14] divide-y divide-[#1D2432] max-h-56 overflow-y-auto">
              {!gateway || gateway.peers.length === 0 ? (
                <div className="p-4 text-xs text-[#6B7788] text-center">
                  No external peers registered yet. Add another public Xypher node URL above.
                </div>
              ) : (
                gateway.peers.map((p) => (
                  <div
                    key={p.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="text-[#E6EDF3] font-medium truncate">
                        {p.label}{' '}
                        <span
                          className={`text-[11px] font-normal ml-1 ${
                            p.status === 'reachable'
                              ? 'text-emerald-400'
                              : p.status === 'unreachable'
                              ? 'text-red-400'
                              : 'text-[#8B98A8]'
                          }`}
                        >
                          · {p.status}
                          {p.lastSeenHeight !== null ? ` (#${p.lastSeenHeight})` : ''}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-[#8B98A8] truncate">{p.url}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSyncPeer(p.id)}
                        disabled={syncingPeerId === p.id}
                        title="Check peer chain height"
                        className="p-1 text-[#8B98A8] hover:text-amber-400 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${syncingPeerId === p.id ? 'animate-spin' : ''}`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemovePeer(p.id)}
                        title="Remove peer"
                        className="p-1 text-[#6B7788] hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Consensus Verification & Protocol Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[#E6EDF3]">
                Consensus Integrity &amp; Protocol Self-Test
              </h3>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Verify every block from Genesis or run the Xypher + MetaMask cryptographic verification suite.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleValidateChain}
                disabled={validating}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                {validating ? 'Validating...' : 'Validate Chain'}
              </button>
              <button
                type="button"
                onClick={handleRunSelfTest}
                disabled={testing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                {testing ? 'Running Suite...' : 'Run Self-Test'}
              </button>
            </div>
          </div>

          {validationResult && (
            <div
              className={`p-3.5 rounded-md border text-xs flex items-center justify-between gap-4 ${
                validationResult.valid
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
            >
              <span>
                {validationResult.valid
                  ? `Chain replay passed: ${validationResult.blocksChecked} blocks verified from Genesis to height #${validationResult.height}.`
                  : `Validation failed: ${validationResult.error}`}
              </span>
              <span className="font-mono tabular-nums shrink-0">
                {validationResult.utxoCount} UTXOs
              </span>
            </div>
          )}

          {testResults && (
            <div className="border border-[#1E2533] rounded-md bg-[#0B0E14] divide-y divide-[#1D2432]">
              {testResults.results.map((item) => (
                <div
                  key={item.name}
                  className="px-4 py-3 flex items-start justify-between gap-4 text-xs"
                >
                  <div className="flex items-start gap-2.5">
                    {item.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-medium text-[#E6EDF3]">{item.name}</div>
                      <div className="text-[#8B98A8] mt-0.5">{item.detail}</div>
                    </div>
                  </div>
                  <span className="font-mono text-[#6B7788] tabular-nums shrink-0">
                    {item.durationMs}ms
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Live JSON-RPC Tester */}
          <div className="pt-4 border-t border-[#1D2432] space-y-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#8B98A8]" />
              <h4 className="text-sm font-semibold text-[#E6EDF3]">Local JSON-RPC Console</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={rpcMethod}
                onChange={(e) => setRpcMethod(e.target.value)}
                className="px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
              >
                <option value="getinfo">getinfo</option>
                <option value="getblocks">getblocks</option>
                <option value="balance">balance</option>
                <option value="coins">coins</option>
              </select>
              {(rpcMethod === 'balance' || rpcMethod === 'coins') && (
                <input
                  type="text"
                  value={rpcAddrParam}
                  onChange={(e) => setRpcAddrParam(e.target.value)}
                  placeholder="Xypher Base58Check or MetaMask 0x address"
                  className="flex-1 min-w-[200px] px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                />
              )}
              <button
                type="button"
                onClick={handleRunRpc}
                disabled={rpcBusy}
                className="px-4 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer disabled:opacity-50"
              >
                {rpcBusy ? 'Calling...' : 'Execute RPC'}
              </button>
            </div>
            {rpcOutput && (
              <pre className="p-3.5 rounded-md bg-[#0B0E14] border border-[#1E2533] text-[11px] font-mono text-emerald-300 max-h-56 overflow-auto">
                {rpcOutput}
              </pre>
            )}
          </div>
        </div>

        {/* Protocol Parameters & Profile Switcher */}
        <div className="lg:col-span-5 space-y-6">
          <div className="border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#E6EDF3]">{NETWORK_NAME} Protocol Specification</h3>
            <dl className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">Public Network</dt>
                <dd className="font-mono text-[#E6EDF3]">{chainInfo?.networkName ?? NETWORK_NAME}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">Currency</dt>
                <dd className="font-mono text-[#E6EDF3]">
                  {chainInfo?.name ?? 'Xypher'} ({SYMBOL}) · 8 decimals
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">EVM Chain ID</dt>
                <dd className="font-mono text-[#E6EDF3] tabular-nums">
                  {chainInfo?.chainId ?? XYPHER_CHAIN_ID} ({chainInfo?.chainIdHex ?? XYPHER_CHAIN_ID_HEX})
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">Network Fee</dt>
                <dd className="font-mono text-emerald-400 tabular-nums">
                  {chainInfo?.networkFeeXyph ?? NETWORK_FEE_XYPH} {SYMBOL} (zero fee)
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">Max Block Capacity</dt>
                <dd className="font-mono text-emerald-400 tabular-nums">
                  {(chainInfo?.maxBlocks ?? MAX_BLOCKS).toLocaleString()} blocks
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">Circulating / Cap</dt>
                <dd className="font-mono text-[#E6EDF3] tabular-nums">
                  {chainInfo ? formatXYPH(chainInfo.supply, 2) : '—'} / 60,000,000 {SYMBOL}
                </dd>
              </div>
              <div className="w-full h-1.5 bg-[#0B0E14] rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${Math.max(supplyPercent, 0.5)}%` }}
                />
              </div>
              <div className="flex justify-between pt-1">
                <dt className="text-[#8B98A8]">Halving Interval</dt>
                <dd className="font-mono text-[#E6EDF3] tabular-nums">
                  Every {chainInfo?.halvingInterval.toLocaleString() ?? '—'} blocks
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">Difficulty Retarget</dt>
                <dd className="font-mono text-[#E6EDF3] tabular-nums">
                  Every {chainInfo?.retargetInterval.toLocaleString() ?? '—'} blocks
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">Target Block Spacing</dt>
                <dd className="font-mono text-[#E6EDF3] tabular-nums">
                  {chainInfo?.targetBlockTime ?? '—'} seconds
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#8B98A8]">Address / WIF Version</dt>
                <dd className="font-mono text-[#E6EDF3]">0x58 / 0xA8 (Base58Check)</dd>
              </div>
            </dl>
          </div>

          <div className="border border-[#222A38] rounded-lg bg-[#121721] p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[#E6EDF3]">Chain Profile Reset</h3>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Re-initialize a clean Genesis chain under a different consensus profile.
              </p>
            </div>
            <div className="space-y-2">
              {Object.values(PROFILE_CONFIGS).map((cfg) => (
                <label
                  key={cfg.id}
                  className={`block p-3 rounded-md border cursor-pointer transition-colors ${
                    selectedProfile === cfg.id
                      ? 'border-amber-500/60 bg-amber-500/5'
                      : 'border-[#1E2533] bg-[#0B0E14] hover:border-[#2E394D]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#E6EDF3]">{cfg.label}</span>
                    <input
                      type="radio"
                      name="profile"
                      checked={selectedProfile === cfg.id}
                      onChange={() => {
                        setSelectedProfile(cfg.id);
                        setConfirmReset(false);
                      }}
                      className="accent-amber-500"
                    />
                  </div>
                  <p className="text-[11px] text-[#8B98A8] mt-1">{cfg.description}</p>
                </label>
              ))}
            </div>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:border-red-500/50 hover:text-red-300 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset &amp; Initialize Selected Profile
              </button>
            ) : (
              <div className="p-3 rounded-md border border-red-500/40 bg-red-500/10 space-y-2.5">
                <p className="text-xs text-red-200">
                  This replaces the current chain.jsonl with a fresh Genesis block under{' '}
                  <strong>{PROFILE_CONFIGS[selectedProfile].label}</strong>.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="flex-1 px-3 py-1.5 text-xs text-[#C9D3DF] bg-[#1B2230] rounded cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleResetNetwork}
                    disabled={resetting}
                    className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded cursor-pointer disabled:opacity-50"
                  >
                    {resetting ? 'Resetting...' : 'Confirm Reset'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
