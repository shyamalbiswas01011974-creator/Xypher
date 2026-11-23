import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Check,
  Code2,
  Copy,
  Layers,
  Search,
} from 'lucide-react';
import { type TransactionDetailResponse, xypherApi } from '../lib/api.ts';
import { decodeBlockExtraData } from '../lib/blockExtraData.ts';
import type {
  AddressInfo,
  BlockDetail,
  BlockExtraDataDecoded,
  BlockSummary,
  ChainInfo,
  MempoolTxItem,
} from '../lib/types.ts';
import {
  MAX_BLOCKS,
  NETWORK_FEE_XYPH,
  NETWORK_NAME,
  SYMBOL,
  formatXYPH,
  isValidAddress,
  isValidEvmAddress,
  truncateHash,
  xypherToEvmAddress,
} from '../lib/xypherCrypto.ts';

const SAMPLE_BOR_EXTRADATA_HEX =
  '0xd88301100883626f7289676f312e32362e3131856c696e757800000000000000c68083f4240040bee89c2af12c6441827dbe62af20b11cab0291470720b0c68642a0a68b53ad9960d7a6c183f723f0e53e45d748b16eec16edbcdfc96cb42667f831e73e9324c701';

interface ExplorerViewProps {
  chainInfo: ChainInfo | null;
  blocks: BlockSummary[];
  totalBlocks?: number;
  mempool: MempoolTxItem[];
  inspectRequest?: { type: 'tx' | 'block' | 'address'; value: string; seq: number } | null;
}

type InspectorState =
  | { kind: 'none' }
  | { kind: 'block'; data: BlockDetail }
  | { kind: 'tx'; data: TransactionDetailResponse }
  | { kind: 'address'; data: AddressInfo };

const PAGE_SIZE = 25;

export const ExplorerView: React.FC<ExplorerViewProps> = ({
  chainInfo,
  blocks,
  totalBlocks,
  mempool,
  inspectRequest,
}) => {
  const [tab, setTab] = useState<'blocks' | 'mempool'>('blocks');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [inspector, setInspector] = useState<InspectorState>({ kind: 'none' });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pagedBlocks, setPagedBlocks] = useState<BlockSummary[] | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [showExtraDecoder, setShowExtraDecoder] = useState(false);
  const [extraHexInput, setExtraHexInput] = useState('');
  const [decodedExtra, setDecodedExtra] = useState<BlockExtraDataDecoded | null>(null);
  const [decodeExtraError, setDecodeExtraError] = useState<string | null>(null);

  const handleDecodeExtraHex = (rawValue?: string) => {
    const input = (rawValue ?? extraHexInput).trim();
    if (!input) {
      setDecodedExtra(null);
      setDecodeExtraError('Paste a block extraData hex string (0x...) to decode.');
      return;
    }
    try {
      const parsed = decodeBlockExtraData(input);
      setDecodedExtra(parsed);
      setDecodeExtraError(null);
    } catch (err) {
      setDecodedExtra(null);
      setDecodeExtraError(err instanceof Error ? err.message : 'Unable to decode block extraData hex.');
    }
  };

  const liveTotalBlocks = totalBlocks ?? (chainInfo ? chainInfo.height + 1 : blocks.length);
  const maxBlocksCap = chainInfo?.maxBlocks ?? MAX_BLOCKS;
  const currentHeight = chainInfo?.height ?? blocks[0]?.height ?? 0;
  const remainingBlocks = Math.max(0, maxBlocksCap - currentHeight);
  const totalPages = Math.max(1, Math.ceil(liveTotalBlocks / PAGE_SIZE));
  const displayedBlocks = page === 0 ? blocks : pagedBlocks ?? [];

  useEffect(() => {
    if (page === 0) {
      setPagedBlocks(null);
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    void xypherApi
      .getBlocks(PAGE_SIZE, page * PAGE_SIZE)
      .then((res) => {
        if (!cancelled) {
          setPagedBlocks(Array.isArray(res.blocks) ? res.blocks : []);
        }
      })
      .catch(() => {
        if (!cancelled) setPagedBlocks([]);
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const copyVal = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1600);
  };

  const inspectBlock = async (idOrHash: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      const data = await xypherApi.getBlock(idOrHash);
      setInspector({ kind: 'block', data });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Block not found');
    } finally {
      setSearching(false);
    }
  };

  const inspectTx = async (txid: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      const data = await xypherApi.getTransaction(txid);
      setInspector({ kind: 'tx', data });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Transaction not found');
    } finally {
      setSearching(false);
    }
  };

  const inspectAddress = async (addr: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      const data = await xypherApi.getAddress(addr);
      setInspector({ kind: 'address', data });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Address lookup failed');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!inspectRequest) return;
    if (inspectRequest.type === 'tx') {
      void inspectTx(inspectRequest.value);
    } else if (inspectRequest.type === 'block') {
      void inspectBlock(inspectRequest.value);
    } else if (inspectRequest.type === 'address') {
      void inspectAddress(inspectRequest.value);
    }
  }, [inspectRequest]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearchError(null);

    if (isValidAddress(q) || isValidEvmAddress(q)) {
      await inspectAddress(q);
      return;
    }
    if (/^\d+$/.test(q)) {
      await inspectBlock(q);
      return;
    }
    if (/^(0x)?[0-9a-fA-F]{6,64}$/.test(q)) {
      setSearching(true);
      try {
        try {
          const blk = await xypherApi.getBlock(q);
          setInspector({ kind: 'block', data: blk });
          return;
        } catch {
          const tx = await xypherApi.getTransaction(q);
          setInspector({ kind: 'tx', data: tx });
          return;
        }
      } catch {
        setSearchError('No matching block hash or transaction ID found on this chain.');
      } finally {
        setSearching(false);
      }
      return;
    }
    setSearchError(
      'Enter a block height, block hash, TXID, MetaMask 0x address, or Xypher Base58Check address.'
    );
  };

  return (
    <div className="space-y-6">
      {/* Real 24,000,000-Block XYPH Network Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="border border-[#222A38] rounded-lg bg-[#121721] px-4 py-3.5">
          <div className="text-[11px] text-[#8B98A8]">Public Network</div>
          <div className="mt-1 text-sm font-semibold text-[#E6EDF3] truncate">
            {chainInfo?.networkName || NETWORK_NAME}
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-amber-400">
            Chain ID {chainInfo?.chainId ?? 5790032}
          </div>
        </div>
        <div className="border border-[#222A38] rounded-lg bg-[#121721] px-4 py-3.5">
          <div className="text-[11px] text-[#8B98A8]">Real Confirmed Height</div>
          <div className="mt-1 text-sm font-mono font-semibold text-emerald-400 tabular-nums">
            #{currentHeight.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-[#8B98A8] tabular-nums">
            {liveTotalBlocks.toLocaleString()} real block{liveTotalBlocks === 1 ? '' : 's'} on ledger
          </div>
        </div>
        <div className="border border-[#222A38] rounded-lg bg-[#121721] px-4 py-3.5">
          <div className="text-[11px] text-[#8B98A8]">Max Block Capacity</div>
          <div className="mt-1 text-sm font-mono font-semibold text-[#E6EDF3] tabular-nums">
            {maxBlocksCap.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-[#8B98A8] tabular-nums">
            {remainingBlocks.toLocaleString()} blocks remaining
          </div>
        </div>
        <div className="border border-[#222A38] rounded-lg bg-[#121721] px-4 py-3.5">
          <div className="text-[11px] text-[#8B98A8]">Network Fee</div>
          <div className="mt-1 text-sm font-mono font-semibold text-emerald-400 tabular-nums">
            {chainInfo?.networkFeeXyph ?? NETWORK_FEE_XYPH} {SYMBOL}
          </div>
          <div className="mt-0.5 text-[11px] text-[#8B98A8]">
            Zero-fee on-chain transfers &amp; deploys
          </div>
        </div>
      </div>

      {/* Unified Search Bar */}
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#6B7788] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search block height, block hash, TXID, 0x... MetaMask address, or Xypher address"
            spellCheck={false}
            className="w-full pl-10 pr-4 py-2.5 text-xs font-mono bg-[#121721] border border-[#222A38] rounded-lg text-[#E6EDF3] placeholder:font-sans placeholder:text-[#6B7788] focus:outline-none focus:border-amber-500"
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="px-5 py-2.5 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
        >
          {searching ? 'Searching...' : 'Inspect'}
        </button>
        <button
          type="button"
          onClick={() => setShowExtraDecoder((prev) => !prev)}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-[#C9D3DF] bg-[#121721] border border-[#222A38] rounded-lg hover:bg-[#1B2230] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Code2 className="w-3.5 h-3.5 text-amber-400" />
          {showExtraDecoder ? 'Hide ExtraData Decoder' : 'Decode ExtraData Hex'}
        </button>
      </form>

      {showExtraDecoder && (
        <div className="border border-[#222A38] rounded-lg bg-[#121721] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-[#E6EDF3]">
                Block ExtraData RLP &amp; Validator Seal Decoder
              </h3>
              <p className="text-[11px] text-[#8B98A8] mt-0.5">
                Decode any EVM / Polygon Bor / Xypher block ExtraData hex into ExtraVanity, ValidatorBytes, GasTarget, BaseFeeChangeDenominator, and 65-byte SignedData.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setExtraHexInput(SAMPLE_BOR_EXTRADATA_HEX);
                handleDecodeExtraHex(SAMPLE_BOR_EXTRADATA_HEX);
              }}
              className="px-3 py-1.5 text-[11px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded hover:bg-amber-500/20 cursor-pointer whitespace-nowrap"
            >
              Load Bor Example Hex
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={extraHexInput}
              onChange={(e) => setExtraHexInput(e.target.value)}
              placeholder="0xd88301100883626f7289..."
              spellCheck={false}
              className="flex-1 px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => handleDecodeExtraHex()}
              className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer whitespace-nowrap"
            >
              Decode Hex
            </button>
          </div>
          {decodeExtraError && (
            <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-xs text-red-300">
              {decodeExtraError}
            </div>
          )}
          {decodedExtra && (
            <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] font-mono text-xs space-y-2">
              <div className="flex items-start justify-between gap-2 pb-2 border-b border-[#1D2432]">
                <span className="text-[#8B98A8] shrink-0">Hex ({decodedExtra.byteLength} B):</span>
                <span className="text-[#C9D3DF] break-all text-right">{decodedExtra.hex}</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-[#E6EDF3]">
                <div>
                  <span className="text-[#8B98A8]">ExtraVanity : </span>
                  <span className="text-emerald-400">{decodedExtra.extraVanity}</span>
                </div>
                <div>
                  <span className="text-[#8B98A8]">ValidatorBytes : </span>
                  <span className="break-all">{decodedExtra.validatorBytes}</span>
                </div>
                <div>
                  <span className="text-[#8B98A8]">GasTarget : </span>
                  <span className="text-amber-300 tabular-nums">{decodedExtra.gasTarget}</span>
                </div>
                <div>
                  <span className="text-[#8B98A8]">BaseFeeChangeDenominator : </span>
                  <span className="text-amber-300 tabular-nums">{decodedExtra.baseFeeChangeDenominator}</span>
                </div>
                <div className="break-all">
                  <span className="text-[#8B98A8]">SignedData : </span>
                  <span className="text-[#C9D3DF]">{decodedExtra.signedData}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {searchError && (
        <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
          {searchError}
        </div>
      )}

      {/* Inspector View */}
      {inspector.kind !== 'none' && (
        <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#222A38] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setInspector({ kind: 'none' })}
                className="inline-flex items-center gap-1.5 text-xs text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Ledger
              </button>
              <span className="text-[#364154]">/</span>
              <h2 className="text-sm font-semibold text-[#E6EDF3]">
                {inspector.kind === 'block'
                  ? `Block #${inspector.data.height}`
                  : inspector.kind === 'tx'
                  ? 'Transaction Detail'
                  : 'Address Ledger'}
              </h2>
            </div>
            {inspector.kind === 'block' && (
              <div className="flex items-center gap-2 text-xs">
                {inspector.data.height > 0 && (
                  <button
                    type="button"
                    onClick={() => inspectBlock(String(inspector.data.height - 1))}
                    className="px-2.5 py-1 text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] cursor-pointer"
                  >
                    Prev Block
                  </button>
                )}
                {blocks[0] && inspector.data.height < blocks[0].height && (
                  <button
                    type="button"
                    onClick={() => inspectBlock(String(inspector.data.height + 1))}
                    className="px-2.5 py-1 text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] cursor-pointer"
                  >
                    Next Block
                  </button>
                )}
              </div>
            )}
          </div>

          {inspector.kind === 'block' && (
            <div className="p-6 space-y-6">
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-xs">
                <div className="md:col-span-2 flex flex-col sm:flex-row sm:justify-between gap-1 pb-2.5 border-b border-[#1D2432]">
                  <dt className="text-[#8B98A8]">
                    Block Hash (Double-SHA256 · {inspector.data.hash.length} chars)
                  </dt>
                  <dd className="font-mono text-[#E6EDF3] break-all flex items-center gap-2">
                    <span>{inspector.data.hash}</span>
                    <button
                      type="button"
                      onClick={() => copyVal(inspector.data.hash, 'bhash')}
                      className="text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer shrink-0"
                    >
                      {copiedKey === 'bhash' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </dd>
                </div>
                <div className="md:col-span-2 flex flex-col sm:flex-row sm:justify-between gap-1 pb-2.5 border-b border-[#1D2432]">
                  <dt className="text-[#8B98A8]">
                    Previous Hash ({inspector.data.prev.length} chars{' '}
                    {inspector.data.height === 0 ? '· 64 Zeros Genesis' : `· Linked to #${inspector.data.height - 1}`})
                  </dt>
                  <dd className="font-mono text-[#9AA6B6] break-all flex items-center gap-2">
                    {inspector.data.height > 0 ? (
                      <button
                        type="button"
                        onClick={() => inspectBlock(inspector.data.prev)}
                        className="text-amber-400 hover:underline text-left cursor-pointer"
                      >
                        {inspector.data.prev}
                      </button>
                    ) : (
                      <span className="text-amber-300">{inspector.data.prev}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => copyVal(inspector.data.prev, 'bprev')}
                      className="text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer shrink-0"
                    >
                      {copiedKey === 'bprev' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </dd>
                </div>
                <div className="md:col-span-2 flex flex-col sm:flex-row sm:justify-between gap-1 pb-2.5 border-b border-[#1D2432]">
                  <dt className="text-[#8B98A8]">Merkle Root</dt>
                  <dd className="font-mono text-[#C9D3DF] break-all">{inspector.data.merkleRoot}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#8B98A8]">Timestamp</dt>
                  <dd className="font-mono text-[#E6EDF3] tabular-nums">
                    {new Date(inspector.data.time * 1000).toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#8B98A8]">Nonce</dt>
                  <dd className="font-mono text-[#E6EDF3] tabular-nums">
                    {inspector.data.nonce.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#8B98A8]">Block Subsidy + Fees</dt>
                  <dd className="font-mono text-emerald-400 tabular-nums">
                    {formatXYPH(inspector.data.subsidy)} + {formatXYPH(inspector.data.fees)} {SYMBOL}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#8B98A8]">Serialized Size</dt>
                  <dd className="font-mono text-[#E6EDF3] tabular-nums">
                    {inspector.data.sizeBytes.toLocaleString()} bytes
                  </dd>
                </div>
              </dl>

              {inspector.data.extraData && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-[#C9D3DF]">
                      Extra Data (RLP Header + 65-Byte Validator Seal · {inspector.data.extraData.byteLength} bytes)
                    </h3>
                    <button
                      type="button"
                      onClick={() => copyVal(inspector.data.extraData!.hex, 'bextra-hex')}
                      className="inline-flex items-center gap-1.5 text-[11px] text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
                    >
                      {copiedKey === 'bextra-hex' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      Copy Hex
                    </button>
                  </div>
                  <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] font-mono text-xs space-y-3">
                    <div className="pb-2.5 border-b border-[#1D2432] break-all text-[#9AA6B6]">
                      <span className="text-[#8B98A8]">Hex: </span>
                      <span className="text-[#E6EDF3]">{inspector.data.extraData.hex}</span>
                    </div>
                    <div className="space-y-1.5 leading-relaxed">
                      <div>
                        <span className="text-[#8B98A8]">ExtraVanity : </span>
                        <span className="text-emerald-400">{inspector.data.extraData.extraVanity}</span>
                      </div>
                      <div className="break-all">
                        <span className="text-[#8B98A8]">ValidatorBytes : </span>
                        <span className="text-[#E6EDF3]">{inspector.data.extraData.validatorBytes}</span>
                      </div>
                      <div>
                        <span className="text-[#8B98A8]">GasTarget : </span>
                        <span className="text-amber-300 tabular-nums">
                          {inspector.data.extraData.gasTarget}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#8B98A8]">BaseFeeChangeDenominator : </span>
                        <span className="text-amber-300 tabular-nums">
                          {inspector.data.extraData.baseFeeChangeDenominator}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="break-all">
                          <span className="text-[#8B98A8]">SignedData : </span>
                          <span className="text-[#C9D3DF]">{inspector.data.extraData.signedData}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyVal(inspector.data.extraData!.signedData, 'bextra-sig')}
                          className="text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer shrink-0 mt-0.5"
                          title="Copy SignedData"
                        >
                          {copiedKey === 'bextra-sig' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-[#C9D3DF]">
                  Included Transactions ({inspector.data.txs.length})
                </h3>
                <div className="divide-y divide-[#1D2432] border border-[#1E2533] rounded-md bg-[#0B0E14]">
                  {inspector.data.txs.map((tx) => (
                    <div key={tx.txid} className="p-4 space-y-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => inspectTx(tx.txid)}
                          className="font-mono text-amber-400 hover:underline cursor-pointer"
                        >
                          {tx.txid}
                        </button>
                        <span className="text-[#8B98A8]">
                          {tx.isCoinbase ? 'Coinbase Generation' : `Fee ${formatXYPH(tx.fee)} ${SYMBOL}`}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1">
                          <div className="text-[11px] text-[#6B7788]">
                            Inputs ({tx.ins.length})
                          </div>
                          {tx.isCoinbase ? (
                            <div className="font-mono text-[#9AA6B6]">
                              Newly Generated Coins (Height #{inspector.data.height})
                            </div>
                          ) : (
                            tx.ins.map((inp, idx) => (
                              <div key={idx} className="font-mono text-[#9AA6B6]">
                                {truncateHash(inp.prev_txid, 10, 8)}:{inp.index}
                              </div>
                            ))
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="text-[11px] text-[#6B7788]">
                            Outputs ({tx.outs.length})
                          </div>
                          {tx.outs.map((o, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2 font-mono">
                              <button
                                type="button"
                                onClick={() => inspectAddress(o.addr)}
                                className="text-[#C9D3DF] hover:text-amber-400 hover:underline truncate cursor-pointer"
                              >
                                {truncateHash(o.addr, 10, 8)}
                              </button>
                              <span className="text-emerald-400 tabular-nums shrink-0">
                                {formatXYPH(o.value)} {SYMBOL}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {inspector.kind === 'tx' && (
            <div className="p-6 space-y-6 text-xs">
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                <div className="md:col-span-2 flex flex-col sm:flex-row sm:justify-between gap-1 pb-2.5 border-b border-[#1D2432]">
                  <dt className="text-[#8B98A8]">Transaction ID</dt>
                  <dd className="font-mono text-[#E6EDF3] break-all">{inspector.data.txid}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#8B98A8]">Status</dt>
                  <dd
                    className={
                      inspector.data.status === 'confirmed'
                        ? 'text-emerald-400 font-medium'
                        : 'text-amber-400 font-medium'
                    }
                  >
                    {inspector.data.status === 'confirmed'
                      ? `Confirmed (${inspector.data.confirmations} confirmations)`
                      : 'Pending confirmation'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#8B98A8]">Block</dt>
                  <dd className="font-mono">
                    {inspector.data.blockHeight !== null ? (
                      <button
                        type="button"
                        onClick={() => inspectBlock(String(inspector.data.blockHeight))}
                        className="text-amber-400 hover:underline cursor-pointer"
                      >
                        Block #{inspector.data.blockHeight}
                      </button>
                    ) : (
                      <span className="text-[#8B98A8]">Pending</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#8B98A8]">Total Output</dt>
                  <dd className="font-mono text-[#E6EDF3] tabular-nums">
                    {formatXYPH(inspector.data.totalOut)} {SYMBOL}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#8B98A8]">Transaction Fee</dt>
                  <dd className="font-mono text-amber-400 tabular-nums">
                    {formatXYPH(inspector.data.fee)} {SYMBOL}
                  </dd>
                </div>
              </dl>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-[#1E2533] rounded-md bg-[#0B0E14] p-4 space-y-2.5">
                  <h4 className="font-semibold text-[#C9D3DF]">
                    Inputs ({inspector.data.ins.length})
                  </h4>
                  {inspector.data.isCoinbase ? (
                    <p className="font-mono text-[#9AA6B6]">Coinbase block subsidy &amp; fees</p>
                  ) : (
                    inspector.data.ins.map((inp, idx) => (
                      <div
                        key={idx}
                        className="py-2 border-t border-[#1A202D] first:border-0 first:pt-0 space-y-1 font-mono"
                      >
                        <div className="flex justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => inspectTx(inp.prev_txid)}
                            className="text-amber-400 hover:underline cursor-pointer"
                          >
                            {truncateHash(inp.prev_txid, 8, 6)}:{inp.index}
                          </button>
                          {inp.value !== undefined && (
                            <span className="text-[#E6EDF3] tabular-nums">
                              {formatXYPH(inp.value)} {SYMBOL}
                            </span>
                          )}
                        </div>
                        {inp.addr && (
                          <button
                            type="button"
                            onClick={() => inspectAddress(inp.addr!)}
                            className="text-[11px] text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
                          >
                            From {truncateHash(inp.addr, 10, 8)}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="border border-[#1E2533] rounded-md bg-[#0B0E14] p-4 space-y-2.5">
                  <h4 className="font-semibold text-[#C9D3DF]">
                    Outputs ({inspector.data.outs.length})
                  </h4>
                  {inspector.data.outs.map((out) => (
                    <div
                      key={out.index}
                      className="py-2 border-t border-[#1A202D] first:border-0 first:pt-0 space-y-1 font-mono"
                    >
                      <div className="flex justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => inspectAddress(out.addr)}
                          className="text-[#C9D3DF] hover:text-amber-400 hover:underline cursor-pointer"
                        >
                          #{out.index} · {truncateHash(out.addr, 10, 8)}
                        </button>
                        <span className="text-emerald-400 tabular-nums">
                          {formatXYPH(out.value)} {SYMBOL}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#6B7788]">
                        {out.spent ? 'Spent' : 'Unspent (UTXO)'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {inspector.kind === 'address' && (
            <div className="p-6 space-y-6 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#1D2432]">
                <div className="space-y-1">
                  <p className="text-[#8B98A8]">Native Xypher Address</p>
                  <p className="font-mono text-sm text-[#E6EDF3] break-all">
                    {inspector.data.address}
                  </p>
                  <p className="font-mono text-xs text-[#8B98A8] break-all">
                    MetaMask 0x: {xypherToEvmAddress(inspector.data.address)}
                  </p>
                </div>
                <div className="text-left sm:text-right font-mono tabular-nums">
                  <div className="text-lg font-semibold text-emerald-400">
                    {formatXYPH(inspector.data.total)} {SYMBOL}
                  </div>
                  <div className="text-[#8B98A8]">
                    Available {formatXYPH(inspector.data.spendable)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-[#C9D3DF]">
                  Address Transactions ({inspector.data.history.length})
                </h4>
                {inspector.data.history.length === 0 ? (
                  <p className="text-[#6B7788] py-4">No transactions recorded for this address.</p>
                ) : (
                  <div className="divide-y divide-[#1D2432] border border-[#1E2533] rounded-md bg-[#0B0E14]">
                    {inspector.data.history.map((h) => (
                      <div
                        key={h.txid}
                        className="px-4 py-3 flex items-center justify-between gap-4"
                      >
                        <div className="font-mono">
                          <button
                            type="button"
                            onClick={() => inspectTx(h.txid)}
                            className="text-amber-400 hover:underline cursor-pointer"
                          >
                            {truncateHash(h.txid, 12, 10)}
                          </button>
                          <div className="text-[11px] text-[#6B7788]">
                            {h.blockHeight === null
                              ? 'Mempool'
                              : `Block #${h.blockHeight} · ${h.confirmations} conf`}
                          </div>
                        </div>
                        <span
                          className={`font-mono tabular-nums ${
                            h.netChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {h.netChange >= 0 ? '+' : ''}
                          {formatXYPH(h.netChange)} {SYMBOL}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Segmented Tabs for Blocks / Mempool */}
      {inspector.kind === 'none' && (
        <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#222A38] flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-[#0B0E14] rounded-md border border-[#1E2533]">
              <button
                type="button"
                onClick={() => setTab('blocks')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'blocks'
                    ? 'bg-[#1D2534] text-[#E6EDF3]'
                    : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                }`}
              >
                <Blocks className="w-3.5 h-3.5" />
                Real Blocks ({liveTotalBlocks.toLocaleString()} / {maxBlocksCap.toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => setTab('mempool')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'mempool'
                    ? 'bg-[#1D2534] text-[#E6EDF3]'
                    : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Pending ({mempool.length})
              </button>
            </div>
            {tab === 'blocks' && (
              <div className="flex items-center gap-2 text-xs text-[#8B98A8]">
                <span className="hidden md:inline">
                  Starts cleanly at Genesis #0 · Zero pre-mined filler blocks
                </span>
                {totalPages > 1 && (
                  <div className="inline-flex items-center gap-1.5 ml-2">
                    <button
                      type="button"
                      disabled={page === 0 || pageLoading}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      className="px-2.5 py-1 text-xs text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    >
                      Newer
                    </button>
                    <span className="font-mono text-[11px] tabular-nums text-[#C9D3DF]">
                      {page + 1} / {totalPages.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      disabled={page + 1 >= totalPages || pageLoading}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      className="px-2.5 py-1 text-xs text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded hover:bg-[#232C3D] disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    >
                      Older
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {tab === 'blocks' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#222A38] text-[#8B98A8]">
                    <th className="py-3 px-5">Height</th>
                    <th className="py-3 px-4">Block Hash (64 chars)</th>
                    <th className="py-3 px-4">Previous Hash (Chain Link)</th>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4 text-right">TXs</th>
                    <th className="py-3 px-4 text-right">Reward + Fees ({SYMBOL})</th>
                    <th className="py-3 px-4 text-right">Nonce</th>
                    <th className="py-3 px-5 text-right">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D2432]">
                  {pageLoading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-[#8B98A8]">
                        Loading blocks from {NETWORK_NAME} ledger...
                      </td>
                    </tr>
                  ) : (
                    displayedBlocks.map((b) => (
                      <tr
                        key={b.hash}
                        onClick={() => inspectBlock(b.hash)}
                        className="hover:bg-[#171E2B] transition-colors cursor-pointer"
                      >
                        <td className="py-3.5 px-5 font-mono font-semibold text-amber-400 tabular-nums whitespace-nowrap">
                          #{b.height.toLocaleString()}
                          {b.height === 0 && (
                            <span className="ml-2 text-[10px] font-sans font-medium text-emerald-400">
                              GENESIS
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[#C9D3DF] whitespace-nowrap" title={b.hash}>
                          {truncateHash(b.hash, 10, 8)}
                        </td>
                        <td className="py-3.5 px-4 font-mono whitespace-nowrap" title={b.prev}>
                          {b.height === 0 ? (
                            <span className="text-amber-300">00000000…00000000 (64 zeros)</span>
                          ) : (
                            <span className="text-[#8B98A8]">{truncateHash(b.prev, 10, 8)}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[#8B98A8] tabular-nums whitespace-nowrap">
                          {new Date(b.time * 1000).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-[#E6EDF3] tabular-nums">
                          {b.txCount}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-emerald-400 tabular-nums whitespace-nowrap">
                          {formatXYPH(b.subsidy + b.fees, 4)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-[#9AA6B6] tabular-nums">
                          {b.nonce.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-5 text-right font-mono text-[#8B98A8] tabular-nums whitespace-nowrap">
                          {b.sizeBytes.toLocaleString()} B
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : mempool.length === 0 ? (
            <div className="p-10 text-center space-y-1">
              <p className="text-sm text-[#C9D3DF]">No pending transactions</p>
              <p className="text-xs text-[#6B7788]">
                Submitted wallet and MetaMask transactions confirm automatically into new blocks.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#222A38] text-[#8B98A8]">
                    <th className="py-3 px-5">Transaction ID</th>
                    <th className="py-3 px-4">Inputs / Outputs</th>
                    <th className="py-3 px-4 text-right">Total Output ({SYMBOL})</th>
                    <th className="py-3 px-4 text-right">Fee ({SYMBOL})</th>
                    <th className="py-3 px-5 text-right">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D2432]">
                  {mempool.map((m) => (
                    <tr
                      key={m.txid}
                      onClick={() => inspectTx(m.txid)}
                      className="hover:bg-[#171E2B] transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-5 font-mono text-amber-400 whitespace-nowrap">
                        {truncateHash(m.txid, 14, 10)}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[#C9D3DF] whitespace-nowrap">
                        {m.tx.ins.length} in <ArrowRight className="inline w-3 h-3 text-[#6B7788] mx-1" />{' '}
                        {m.tx.outs.length} out
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-[#E6EDF3] tabular-nums">
                        {formatXYPH(m.totalOut)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-amber-400 tabular-nums">
                        {formatXYPH(m.fee)}
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono text-[#8B98A8] tabular-nums">
                        {m.sizeBytes} B
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
