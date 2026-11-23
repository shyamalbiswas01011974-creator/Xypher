import React, { useEffect, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  Globe2,
  Rocket,
  ShieldCheck,
} from 'lucide-react';
import { xypherApi } from '../lib/api.ts';
import {
  XYPHER_COIN_ICON_PATH,
  deployXypherSmartContract,
  formatWalletError,
  switchOrAddPublicNetwork,
  watchCustomContractInMetaMask,
} from '../lib/metamask.ts';
import type { DeployedContractRecord } from '../lib/types.ts';
import { NAME, SYMBOL, XYPH_TOKEN_DECIMALS } from '../lib/xypherCrypto.ts';
import {
  EXTERNAL_PAID_DEPLOY_NETWORKS,
  FREE_REAL_PUBLIC_NETWORKS,
  PUBLIC_DEPLOY_NETWORKS,
  type PublicEvmDeployNetwork,
  XYPHER_DEFAULT_SUPPLY_WHOLE,
  XYPHER_SOLC_VERSION,
  XYPHER_TOKEN_ABI,
  XYPHER_TOKEN_SOURCE,
  findDeployNetworkByChainId,
} from '../lib/xypherTokenContract.ts';

interface SmartContractDeployerProps {
  mmAccount: string | null;
  mmChainId: string | null;
  publicBaseUrl: string | null;
  onLog: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void;
}

export const SmartContractDeployer: React.FC<SmartContractDeployerProps> = ({
  mmAccount,
  mmChainId,
  publicBaseUrl,
  onLog,
}) => {
  const [networkMode, setNetworkMode] = useState<'free_real' | 'zero_fee' | 'external'>('free_real');
  const [selectedNetId, setSelectedNetId] = useState<string>('real-xypher');
  const [initialSupplyInput, setInitialSupplyInput] = useState<string>(
    String(XYPHER_DEFAULT_SUPPLY_WHOLE)
  );
  const [switchingNet, setSwitchingNet] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [lastDeployed, setLastDeployed] = useState<DeployedContractRecord | null>(null);

  const [deployments, setDeployments] = useState<DeployedContractRecord[]>([]);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visibleNetworks = (
    networkMode === 'free_real'
      ? FREE_REAL_PUBLIC_NETWORKS
      : networkMode === 'zero_fee'
      ? PUBLIC_DEPLOY_NETWORKS
      : EXTERNAL_PAID_DEPLOY_NETWORKS
  ).filter((n) => n.category !== 'testnet');

  const selectedNetwork: PublicEvmDeployNetwork =
    visibleNetworks.find((n) => n.id === selectedNetId) || visibleNetworks[0];

  const loadDeployments = async () => {
    try {
      const res = await xypherApi.getDeployments();
      setDeployments(res.deployments);
    } catch {
      // Ignore transient load error
    }
  };

  useEffect(() => {
    void loadDeployments();
  }, []);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
  };

  const handleSwitchNetwork = async (net: PublicEvmDeployNetwork) => {
    setSelectedNetId(net.id);
    setDeployError(null);
    setSwitchingNet(true);
    try {
      await switchOrAddPublicNetwork(net, publicBaseUrl);
      setDeployStatus(`MetaMask switched to ${net.name} (Chain ID ${net.chainId}).`);
      onLog('info', `Switched MetaMask to ${net.name} (Chain ID ${net.chainId})`);
    } catch (err) {
      setDeployError(formatWalletError(err));
    } finally {
      setSwitchingNet(false);
    }
  };

  const handleDeployContract = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeployError(null);
    setDeployStatus(null);
    const parsedSupply = Number(initialSupplyInput.replace(/,/g, '').trim());
    if (!Number.isFinite(parsedSupply) || parsedSupply <= 0 || parsedSupply > 100_000_000_000) {
      setDeployError('Enter a valid whole-token initial supply (1 to 100,000,000,000 XYPH).');
      return;
    }

    setDeploying(true);
    try {
      const deployed = await deployXypherSmartContract({
        network: selectedNetwork,
        initialSupplyWholeTokens: parsedSupply,
        publicBaseUrl,
        onStatus: (msg) => setDeployStatus(msg),
      });

      const explorerUrl =
        selectedNetwork.explorerUrl ||
        (publicBaseUrl ? publicBaseUrl.replace(/\/$/, '') : '');

      const saved = await xypherApi.saveDeployment({
        contractAddress: deployed.contractAddress,
        txHash: deployed.txHash,
        deployerAddress: deployed.deployerAddress,
        chainId: deployed.chainId,
        chainIdHex: deployed.chainIdHex,
        networkName: selectedNetwork.name,
        explorerUrl,
        symbol: SYMBOL,
        decimals: XYPH_TOKEN_DECIMALS,
        initialSupply: deployed.initialSupply,
        solcVersion: XYPHER_SOLC_VERSION,
      });

      setLastDeployed(saved.deployment);
      setDeployStatus(
        `Smart contract deployed live on ${selectedNetwork.name} at ${deployed.contractAddress}.`
      );
      onLog(
        'success',
        `Deployed ${SYMBOL} ERC-20 smart contract on ${selectedNetwork.name}: ${deployed.contractAddress}`
      );
      await loadDeployments();
    } catch (err) {
      const msg = formatWalletError(err);
      setDeployError(msg);
      onLog('error', `Smart contract deployment failed: ${msg}`);
    } finally {
      setDeploying(false);
    }
  };

  const handleImportContractToMetaMask = async (rec: DeployedContractRecord) => {
    setDeployError(null);
    setWatchingId(rec.id);
    try {
      const net = findDeployNetworkByChainId(rec.chainId);
      const added = await watchCustomContractInMetaMask({
        contractAddress: rec.contractAddress,
        network: net,
        symbol: rec.symbol,
        decimals: rec.decimals,
        publicBaseUrl,
      });
      if (added) {
        setDeployStatus(
          `${rec.symbol} (${rec.contractAddress.slice(0, 10)}...) + coin picture added to MetaMask on ${rec.networkName}.`
        );
        onLog('success', `Imported deployed ${rec.symbol} contract to MetaMask (${rec.networkName})`);
      } else {
        setDeployStatus('Token import prompt dismissed in MetaMask.');
      }
    } catch (err) {
      setDeployError(formatWalletError(err));
    } finally {
      setWatchingId(null);
    }
  };

  const activeChainNumber = mmChainId ? parseInt(mmChainId, 16) : null;

  return (
    <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-semibold text-[#E6EDF3]">
              Deploy Real {SYMBOL} ERC-20 Smart Contract (Public Worldwide in MetaMask)
            </h2>
          </div>
          <p className="text-xs text-[#8B98A8] mt-0.5">
            Deploy the compiled Solidity <span className="font-mono text-[#E6EDF3]">XypherToken.sol</span>{' '}
            contract directly via MetaMask onto any public global EVM network so anyone in any region can hold, transfer, and view{' '}
            {SYMBOL} with its coin profile picture.
          </p>
        </div>
        <div className="text-xs font-mono text-[#8B98A8] whitespace-nowrap shrink-0">
          solc {XYPHER_SOLC_VERSION.split('+')[0]} · EIP-20
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Step 1: Select Target Network */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[#C9D3DF]">
                1. Choose Blockchain Network
              </span>
              <div className="inline-flex flex-wrap items-center gap-1 p-0.5 bg-[#0B0E14] border border-[#1E2533] rounded text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setNetworkMode('free_real');
                    setSelectedNetId('real-xypher');
                  }}
                  className={`px-2.5 py-1 rounded cursor-pointer whitespace-nowrap ${
                    networkMode === 'free_real'
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                      : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                  }`}
                >
                  Free Real Mainnets ($0)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNetworkMode('zero_fee');
                    setSelectedNetId('xypher');
                  }}
                  className={`px-2.5 py-1 rounded cursor-pointer whitespace-nowrap ${
                    networkMode === 'zero_fee'
                      ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                      : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                  }`}
                >
                  XYPH Zero-Fee Mainnets
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNetworkMode('external');
                    setSelectedNetId('ext-polygon');
                  }}
                  className={`px-2.5 py-1 rounded cursor-pointer whitespace-nowrap ${
                    networkMode === 'external'
                      ? 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                      : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                  }`}
                >
                  Paid Mainnets
                </button>
              </div>
            </div>
            <span className="font-mono text-[#8B98A8]">
              {mmAccount
                ? `MetaMask: ${mmAccount.slice(0, 8)}...${mmAccount.slice(-4)} · Chain ${
                    activeChainNumber ?? '—'
                  }`
                : 'MetaMask will connect automatically on deploy'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {visibleNetworks.map((net) => {
              const isSelected = net.id === selectedNetwork.id;
              const isMetaMaskActive = activeChainNumber === net.chainId;
              return (
                <button
                  key={net.id}
                  type="button"
                  onClick={() => setSelectedNetId(net.id)}
                  className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-[#1E2533] bg-[#0B0E14] hover:border-[#2E3A4F]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#E6EDF3] truncate">
                      {net.shortName}
                    </span>
                    <span className="text-[10px] font-mono text-[#8B98A8] tabular-nums shrink-0">
                      ID {net.chainId}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#8B98A8] mt-1 leading-snug">
                    {net.gasNote}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] font-mono">
                    <span
                      className={
                        net.isZeroFeeHosted || (net.isFreeRealPublic && net.category === 'mainnet')
                          ? 'text-emerald-400 font-semibold'
                          : net.category === 'testnet'
                          ? 'text-sky-400 font-semibold'
                          : 'text-amber-400'
                      }
                    >
                      {net.isZeroFeeHosted
                        ? 'FREE · 0 GAS MAINNET'
                        : net.isFreeRealPublic && net.category === 'mainnet'
                        ? 'FREE REAL MAINNET · $0'
                        : net.category === 'testnet'
                        ? 'FREE REAL TESTNET · $0'
                        : 'PAID EXTERNAL GAS'}
                    </span>
                    {isMetaMaskActive && (
                      <span className="text-emerald-400 font-semibold">ACTIVE</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Configure & Deploy via MetaMask */}
        <form
          onSubmit={handleDeployContract}
          className="p-5 rounded-md border border-[#1E2533] bg-[#0B0E14] space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-6 space-y-1.5 min-w-0">
              <label className="block text-xs font-medium text-[#C9D3DF]">
                Token Metadata (Audited Solidity)
              </label>
              <div className="px-3 py-2 rounded-md border border-[#1D2432] bg-[#121721] flex items-center gap-2.5 text-xs">
                <img
                  src={XYPHER_COIN_ICON_PATH}
                  alt={NAME}
                  className="w-5 h-5 rounded-full object-cover shrink-0"
                />
                <span className="font-semibold text-[#E6EDF3]">{NAME}</span>
                <span className="font-mono text-amber-400">({SYMBOL})</span>
                <span className="text-[#8B98A8] ml-auto font-mono whitespace-nowrap">
                  {XYPH_TOKEN_DECIMALS} dec
                </span>
              </div>
            </div>

            <div className="md:col-span-6 space-y-1.5 min-w-0">
              <label
                htmlFor="deploy-supply-input"
                className="block text-xs font-medium text-[#C9D3DF]"
              >
                Initial Total Supply (Whole {SYMBOL})
              </label>
              <input
                id="deploy-supply-input"
                type="text"
                inputMode="numeric"
                value={initialSupplyInput}
                onChange={(e) => setInitialSupplyInput(e.target.value)}
                placeholder="60000000"
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-[#121721] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div className="md:col-span-12 flex flex-wrap items-center justify-between gap-2.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {selectedNetwork.faucetUrl && (
                  <a
                    href={selectedNetwork.faucetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-md hover:bg-emerald-500/20 whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    {selectedNetwork.faucetLabel || `Free ${selectedNetwork.nativeCurrency.symbol} Faucet`}
                  </a>
                )}
                {selectedNetwork.explorerUrl && (
                  <a
                    href={selectedNetwork.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap"
                  >
                    <Globe2 className="w-3.5 h-3.5 shrink-0" />
                    Public Explorer
                  </a>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2.5 ml-auto">
                <button
                  type="button"
                  onClick={() => void handleSwitchNetwork(selectedNetwork)}
                  disabled={switchingNet || deploying}
                  className="px-3.5 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap cursor-pointer disabled:opacity-50 max-w-full"
                >
                  {switchingNet ? 'Switching...' : `Switch to ${selectedNetwork.shortName}`}
                </button>
                <button
                  type="submit"
                  disabled={deploying}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap cursor-pointer disabled:opacity-50 max-w-full"
                >
                  <Rocket className="w-3.5 h-3.5 shrink-0" />
                  {deploying ? 'Deploying...' : `Deploy on ${selectedNetwork.shortName}`}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8B98A8] pt-1 border-t border-[#1D2432]">
            <span>
              100% of minted {SYMBOL} tokens are credited directly to your connected MetaMask deployer wallet.
            </span>
            <span>
              Network fee:{' '}
              <span
                className={`font-mono ${
                  selectedNetwork.isZeroFeeHosted || selectedNetwork.isFreeRealPublic
                    ? 'text-emerald-400 font-semibold'
                    : 'text-[#E6EDF3]'
                }`}
              >
                {selectedNetwork.isZeroFeeHosted
                  ? `0 ${selectedNetwork.nativeCurrency.symbol} (FREE · Zero Gas)`
                  : selectedNetwork.isFreeRealPublic
                  ? `$0 Real Cost (Free ${selectedNetwork.nativeCurrency.symbol} via official faucet)`
                  : `Paid in ${selectedNetwork.nativeCurrency.symbol}`}
              </span>
            </span>
          </div>
        </form>

        {/* Live Deployment Progress / Error */}
        {deployStatus && (
          <div className="p-3.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300 flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="break-all">{deployStatus}</span>
          </div>
        )}

        {deployError && (
          <div className="p-3.5 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
            {deployError}
          </div>
        )}

        {/* Newly Deployed Contract Confirmation Card */}
        {lastDeployed && (
          <div className="p-5 rounded-md border border-emerald-500/30 bg-emerald-500/5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-emerald-400">
                  Contract Confirmed On-Chain · {lastDeployed.networkName} (Chain ID{' '}
                  {lastDeployed.chainId})
                </div>
                <div className="font-mono text-sm text-[#E6EDF3] mt-0.5 break-all">
                  {lastDeployed.contractAddress}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => copyText(lastDeployed.contractAddress, 'last-addr')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap cursor-pointer"
                >
                  {copiedId === 'last-addr' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  Copy Address
                </button>
                {lastDeployed.explorerUrl && (
                  <a
                    href={`${lastDeployed.explorerUrl}/address/${lastDeployed.contractAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Explorer
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void handleImportContractToMetaMask(lastDeployed)}
                  disabled={watchingId === lastDeployed.id}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <img
                    src={XYPHER_COIN_ICON_PATH}
                    alt={SYMBOL}
                    className="w-4 h-4 rounded-full object-cover shrink-0"
                  />
                  {watchingId === lastDeployed.id
                    ? 'Adding...'
                    : `Add ${SYMBOL} + Picture to MetaMask`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Published Global Smart Contracts Registry */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-medium text-[#C9D3DF]">
              <Globe2 className="w-4 h-4 text-amber-400" />
              <span>Published Global {SYMBOL} Smart Contracts ({deployments.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowSource((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              {showSource ? 'Hide Verified Solidity Source' : 'View Solidity Source & ABI'}
            </button>
          </div>

          <div className="border border-[#1E2533] rounded-md bg-[#0B0E14] overflow-x-auto">
            {deployments.length === 0 ? (
              <div className="p-5 text-xs text-[#6B7788] text-center">
                No public smart contracts deployed yet. Select a Free Real Mainnet above (XYPH Mainnet, SKALE Europa Mainnet, SKALE Nebula Mainnet, SKALE Calypso Mainnet, or SKALE Titan Mainnet — all real production mainnets, zero testnets) and click Deploy to publish your live {SYMBOL} contract worldwide for $0.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1D2432] text-[#8B98A8] bg-[#0F141D]">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Network</th>
                    <th className="px-4 py-2.5 font-medium">Contract Address</th>
                    <th className="px-4 py-2.5 font-medium">Supply</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D2432]">
                  {deployments.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#121721]/70">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-[#E6EDF3]">{rec.networkName}</div>
                        <div className="font-mono text-[11px] text-[#8B98A8]">
                          Chain ID {rec.chainId}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[#E6EDF3]">
                        <div className="flex items-center gap-1.5">
                          <span>
                            {rec.contractAddress.slice(0, 12)}...{rec.contractAddress.slice(-8)}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText(rec.contractAddress, rec.id)}
                            className="p-1 text-[#8B98A8] hover:text-amber-400 cursor-pointer"
                            title="Copy contract address"
                          >
                            {copiedId === rec.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-[#C9D3DF] whitespace-nowrap">
                        {Number(rec.initialSupply).toLocaleString()} {rec.symbol}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {rec.explorerUrl && (
                            <a
                              href={`${rec.explorerUrl}/address/${rec.contractAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D]"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Explorer
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleImportContractToMetaMask(rec)}
                            disabled={watchingId === rec.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B0E14] bg-amber-500 rounded hover:bg-amber-400 cursor-pointer disabled:opacity-50"
                          >
                            <img
                              src={XYPHER_COIN_ICON_PATH}
                              alt={rec.symbol}
                              className="w-3.5 h-3.5 rounded-full object-cover"
                            />
                            {watchingId === rec.id ? 'Adding...' : 'Add to MetaMask'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Collapsible Verified Solidity Source & ABI for Block Explorer Verification */}
        {showSource && (
          <div className="pt-4 border-t border-[#1D2432] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-medium text-[#E6EDF3]">
                <FileCode2 className="w-4 h-4 text-amber-400" />
                <span>
                  Verified Solidity Source (<span className="font-mono">contracts/XypherToken.sol</span>)
                  — Compiler <span className="font-mono">{XYPHER_SOLC_VERSION.split('+')[0]}</span>, Optimizer 200 runs, EVM <span className="font-mono">paris</span>, MIT License
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => copyText(JSON.stringify(XYPHER_TOKEN_ABI, null, 2), 'sol-abi')}
                  className="inline-flex items-center gap-1 text-[#C9D3DF] hover:text-amber-400 cursor-pointer"
                >
                  {copiedId === 'sol-abi' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  Copy ABI
                </button>
                <button
                  type="button"
                  onClick={() => copyText(XYPHER_TOKEN_SOURCE, 'sol-src')}
                  className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 cursor-pointer"
                >
                  {copiedId === 'sol-src' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  Copy Solidity Source
                </button>
              </div>
            </div>
            <pre className="p-4 rounded-md bg-[#0B0E14] border border-[#1E2533] text-[11px] font-mono text-[#C9D3DF] max-h-72 overflow-auto leading-relaxed">
              {XYPHER_TOKEN_SOURCE}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
