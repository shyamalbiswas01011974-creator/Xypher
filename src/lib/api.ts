import type {
  AddressInfo,
  BalanceVerificationResult,
  BlockDetail,
  BlockSummary,
  ChainInfo,
  MempoolTxItem,
  MetaMaskTokenBalanceItem,
  MetaMaskTokenDelivery,
  NetworkProfile,
  SelfTestResultItem,
  TransferAccountingReceipt,
  TxData,
} from './types.ts';

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const maxAttempts = method === 'GET' ? 3 : 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      };
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            headers[key] = value;
          }
        } else {
          Object.assign(headers, init.headers);
        }
      }

      const res = await fetch(url, {
        ...init,
        cache: 'no-store',
        credentials: 'same-origin',
        headers,
      });

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const rawText = await res.text();
      const trimmed = rawText.trim();
      const looksLikeJson =
        contentType.includes('application/json') ||
        contentType.includes('+json') ||
        trimmed.startsWith('{') ||
        trimmed.startsWith('[');

      if (!looksLikeJson) {
        const isTransient = res.status === 200 || res.status === 502 || res.status === 503 || res.status === 504;
        lastError = new Error(
          res.status === 200
            ? 'Node API is starting up or temporarily returning HTML instead of JSON. Retrying connection...'
            : `Node API unavailable (HTTP ${res.status})`
        );
        if (attempt < maxAttempts && isTransient) {
          await waitMs(attempt * 450);
          continue;
        }
        throw lastError;
      }

      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        lastError = new Error(`Invalid JSON response from node API (HTTP ${res.status})`);
        if (attempt < maxAttempts && (res.status === 200 || res.status >= 500)) {
          await waitMs(attempt * 450);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        const errMsg =
          data &&
          typeof data === 'object' &&
          'error' in data &&
          typeof (data as { error?: unknown }).error === 'string'
            ? (data as { error: string }).error
            : `HTTP ${res.status}`;
        if (attempt < maxAttempts && (res.status === 502 || res.status === 503 || res.status === 504)) {
          lastError = new Error(errMsg);
          await waitMs(attempt * 450);
          continue;
        }
        throw new Error(errMsg);
      }

      return data as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Node API request failed');
      const isNetworkFailure = err instanceof TypeError;
      if (attempt < maxAttempts && isNetworkFailure) {
        await waitMs(attempt * 450);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('Node API unavailable');
}

export interface TransactionDetailResponse {
  txid: string;
  status: 'confirmed' | 'mempool';
  blockHeight: number | null;
  blockHash: string | null;
  confirmations: number;
  time: number;
  isCoinbase: boolean;
  v: number;
  ins: Array<{
    prev_txid: string;
    index: number;
    pub: string;
    sig: string;
    value?: number;
    addr?: string;
  }>;
  outs: Array<{
    index: number;
    value: number;
    addr: string;
    spent: boolean;
  }>;
  totalOut: number;
  fee: number;
}

export interface NetworkGatewayStatus {
  apiKeyConfigured: boolean;
  authMode: 'env' | 'claimed' | 'unconfigured';
  publicBaseUrl: string | null;
  networkName: string;
  networkFeeXyph: number;
  maxBlocks: number;
  gasPriceHex: string;
  evmRpcPath: string;
  chainId: number;
  chainIdHex: string;
  endpoints: {
    evmRpc: string;
    networkManifest: string;
    info: string;
    blocks: string;
    blockSubmit: string;
    txBroadcast: string;
    rpc: string;
    peers: string;
  };
  peers: Array<{
    id: string;
    url: string;
    label: string;
    addedAt: number;
    lastSeenHeight: number | null;
    status: 'registered' | 'reachable' | 'unreachable';
  }>;
}

export const xypherApi = {
  getInfo: () => requestJson<ChainInfo>('/api/info'),

  getBlocks: (limit = 25, offset = 0) =>
    requestJson<{
      blocks: BlockSummary[];
      total: number;
      maxBlocks?: number;
      networkName?: string;
      networkFeeXyph?: number;
    }>(`/api/blocks?limit=${limit}&offset=${offset}`),

  getBlock: (idOrHash: string) =>
    requestJson<BlockDetail>(`/api/blocks/${encodeURIComponent(idOrHash)}`),

  getTransaction: (txid: string) =>
    requestJson<TransactionDetailResponse>(`/api/tx/${encodeURIComponent(txid)}`),

  getMempool: () => requestJson<{ count: number; txs: MempoolTxItem[] }>('/api/mempool'),

  getAddress: (addr: string) =>
    requestJson<AddressInfo>(`/api/address/${encodeURIComponent(addr)}`),

  verifyTransferBalance: (payload: {
    fromAddress: string;
    toAddress?: string | null;
    amountUnits: number;
    feeUnits?: number;
  }) =>
    requestJson<BalanceVerificationResult>('/api/tx/verify-balance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitTx: (tx: TxData) =>
    requestJson<{
      ok: boolean;
      txid: string;
      blockHeight?: number | null;
      accounting?: TransferAccountingReceipt;
    }>('/api/tx/submit', {
      method: 'POST',
      body: JSON.stringify({ tx }),
    }),

  submitBridgeTransfer: (payload: {
    fromXyph: string;
    toAddress: string;
    amountUnits: number;
    feeUnits: number;
    timestamp: number;
    pubHex: string;
    sigHex: string;
  }) =>
    requestJson<{
      ok: boolean;
      txid: string;
      blockHeight?: number | null;
      accounting?: TransferAccountingReceipt;
    }>('/api/tx/bridge-transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitEvmSignedTransfer: (payload: {
    fromEvm: string;
    toAddress: string;
    amountUnits: number;
    feeUnits: number;
    timestamp: number;
    signature: string;
  }) =>
    requestJson<{
      ok: boolean;
      txid: string;
      blockHeight?: number | null;
      accounting?: TransferAccountingReceipt;
    }>('/api/tx/evm-signed-transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitEvmSignedDeploy: (payload: {
    deployerEvm: string;
    chainId: number;
    initialSupplyWholeTokens: number;
    timestamp: number;
    signature: string;
  }) =>
    requestJson<{
      ok: boolean;
      contractAddress: string;
      txHash: string;
      deployerAddress: string;
      chainId: number;
      chainIdHex: string;
      initialSupply: string;
      blockHeight?: number | null;
    }>('/api/tx/evm-signed-deploy', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitEvmSignedTokenTransfer: (payload: {
    symbol: import('./supportedCoins.ts').SupportedCoinSymbol;
    fromEvm: string;
    toEvm: string;
    amount: number;
    timestamp: number;
    signature: string;
  }) =>
    requestJson<{
      ok: boolean;
      txHash: string;
      blockHeight: number;
      contractAddress: string;
      symbol: import('./supportedCoins.ts').SupportedCoinSymbol;
      fromEvm: string;
      toEvm: string;
      amount: number;
      senderBefore: string;
      senderAfter: string;
      receiverBefore: string;
      receiverAfter: string;
    }>('/api/tx/evm-signed-token-transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getBridgeNonce: (addr: string, chainId?: number) =>
    requestJson<{ nonce: number }>(
      `/api/tx/bridge-nonce/${encodeURIComponent(addr)}${
        chainId ? `?chainId=${encodeURIComponent(String(chainId))}` : ''
      }`
    ),

  // UPI Buy XYPH Payment System (₹1 = 100 XYPH)
  getPaymentConfig: () => requestJson<import('./types.ts').PaymentConfig>('/api/payments/config'),

  createPaymentOrder: (payload: {
    inrAmount: number;
    recipientAddress: string;
    payerName: string;
    utr: string;
  }) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').PaymentOrder;
      market?: import('./types.ts').MarketTicker;
    }>('/api/payments/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPaymentOrdersForAddress: (address: string) =>
    requestJson<{ orders: import('./types.ts').PaymentOrder[] }>(
      `/api/payments/orders?address=${encodeURIComponent(address)}`
    ),

  setupMerchantAdmin: (passcode: string) =>
    requestJson<{ ok: boolean; token: string; authMode: 'claimed' }>('/api/payments/admin/setup', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),

  loginMerchantAdmin: (passcode: string) =>
    requestJson<{ ok: boolean; token: string }>('/api/payments/admin/login', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),

  getMerchantOrders: (adminToken: string) =>
    requestJson<{
      orders: import('./types.ts').PaymentOrder[];
      summary: import('./types.ts').PaymentAdminSummary;
    }>('/api/payments/admin/orders', {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),

  approveMerchantOrder: (adminToken: string, orderId: string) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').PaymentOrder;
      market?: import('./types.ts').MarketTicker;
    }>(`/api/payments/admin/orders/${encodeURIComponent(orderId)}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }),

  rejectMerchantOrder: (adminToken: string, orderId: string, reason: string) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').PaymentOrder;
      market?: import('./types.ts').MarketTicker;
    }>(`/api/payments/admin/orders/${encodeURIComponent(orderId)}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason }),
    }),

  // Live Coin Market Price & Sell XYPH at Live Market Price
  getMarketPrice: () => requestJson<import('./types.ts').MarketTicker>('/api/market/price'),

  createSellOrder: (payload: {
    depositTxid: string;
    payoutMethod: 'upi' | 'bank';
    upiId?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
    bankName?: string;
    accountHolderName?: string;
    sellerName: string;
  }) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').SellOrder;
      market: import('./types.ts').MarketTicker;
    }>('/api/payments/sell-orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSellOrdersForAddress: (address: string) =>
    requestJson<{ orders: import('./types.ts').SellOrder[] }>(
      `/api/payments/sell-orders?address=${encodeURIComponent(address)}`
    ),

  getMerchantSellOrders: (adminToken: string) =>
    requestJson<{
      orders: import('./types.ts').SellOrder[];
      summary: import('./types.ts').SellAdminSummary;
    }>('/api/payments/admin/sell-orders', {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),

  markSellOrderPaid: (adminToken: string, orderId: string, payoutUtr: string) =>
    requestJson<{ ok: boolean; order: import('./types.ts').SellOrder }>(
      `/api/payments/admin/sell-orders/${encodeURIComponent(orderId)}/payout`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ payoutUtr }),
      }
    ),

  refundSellOrder: (adminToken: string, orderId: string, reason: string) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').SellOrder;
      market?: import('./types.ts').MarketTicker;
    }>(`/api/payments/admin/sell-orders/${encodeURIComponent(orderId)}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason }),
    }),

  validateChain: () =>
    requestJson<{
      valid: boolean;
      height: number;
      utxoCount: number;
      blocksChecked: number;
      error?: string;
    }>('/api/validate', { method: 'POST' }),

  runSelfTest: () =>
    requestJson<{ allPassed: boolean; results: SelfTestResultItem[] }>('/api/selftest', {
      method: 'POST',
    }),

  resetNetwork: (profile: NetworkProfile) =>
    requestJson<{ ok: boolean; profile: NetworkProfile; genesisHash: string }>(
      '/api/network/reset',
      {
        method: 'POST',
        body: JSON.stringify({ profile }),
      }
    ),

  getGatewayStatus: () => requestJson<NetworkGatewayStatus>('/api/network/gateway'),

  activateGatewayKey: (apiKey: string) =>
    requestJson<{ ok: boolean; authMode: 'claimed' }>('/api/network/gateway/activate', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    }),

  addPeer: (url: string, label: string) =>
    requestJson<{ ok: boolean; peer: NetworkGatewayStatus['peers'][number] }>('/api/network/peers', {
      method: 'POST',
      body: JSON.stringify({ url, label }),
    }),

  syncPeer: (id: string) =>
    requestJson<{ ok: boolean; peer: NetworkGatewayStatus['peers'][number]; error?: string }>(
      `/api/network/peers/${encodeURIComponent(id)}/sync`,
      { method: 'POST' }
    ),

  removePeer: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/network/peers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  callRpc: (method: string, params: Record<string, unknown> = {}) =>
    requestJson<{ id: number; result?: unknown; error?: string }>('/api/rpc', {
      method: 'POST',
      body: JSON.stringify({ id: Date.now(), method, params }),
    }),

  callEvmRpc: (method: string, params: unknown[] = []) =>
    requestJson<{ jsonrpc: string; id: number; result?: unknown; error?: { message: string } }>(
      '/evm-rpc',
      {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      }
    ),

  testPublicRpc: (apiKey: string, method: string, params: Record<string, unknown> = {}) =>
    requestJson<{ id: number; result?: unknown; error?: string }>('/api/public/rpc', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({ id: Date.now(), method, params }),
    }),

  // Public Smart Contract Deployment Registry (Multi-Chain ERC-20)
  getDeployments: () =>
    requestJson<{ deployments: import('./types.ts').DeployedContractRecord[] }>(
      '/api/contracts/deployments'
    ),

  saveDeployment: (payload: {
    contractAddress: string;
    txHash: string;
    deployerAddress: string;
    chainId: number;
    chainIdHex: string;
    networkName: string;
    explorerUrl: string;
    symbol: string;
    decimals: number;
    initialSupply: string;
    solcVersion: string;
  }) =>
    requestJson<{ ok: boolean; deployment: import('./types.ts').DeployedContractRecord }>(
      '/api/contracts/deployments',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Wallet Block Mining System (10-min block time, 10 XYPH reward, 10-year halving)
  getMiningStatus: () => requestJson<import('./types.ts').MiningStatus>('/api/mining/status'),

  startMining: (minerAddress: string) =>
    requestJson<{ ok: boolean; status: import('./types.ts').MiningStatus }>('/api/mining/start', {
      method: 'POST',
      body: JSON.stringify({ minerAddress }),
    }),

  stopMining: () =>
    requestJson<{ ok: boolean; status: import('./types.ts').MiningStatus }>('/api/mining/stop', {
      method: 'POST',
    }),

  // Multi-Crypto Exchange & Buy XYPH with Crypto (ETH, SOL, BTC, TRX, BNB, POL, MON, XLM, XYPH)
  getExchangeAssets: () =>
    requestJson<{
      assets: import('./types.ts').CryptoExchangeAsset[];
      summary: import('./types.ts').CryptoVaultSummary;
      usdToInr: number;
      xyphPriceInr: number;
      xyphPriceUsd: number;
      updatedAt: number;
    }>('/api/exchange/assets'),

  getExchangeOrders: (address?: string, coin?: string) => {
    const qs = new URLSearchParams();
    if (address) qs.set('address', address);
    if (coin) qs.set('coin', coin);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<{
      orders: import('./types.ts').CryptoExchangeOrder[];
      summary: import('./types.ts').CryptoVaultSummary;
    }>(`/api/exchange/orders${suffix}`);
  },

  buyXyphWithCrypto: (payload: {
    payCoin: import('./supportedCoins.ts').SupportedCoinSymbol;
    payAmount: number;
    depositTxHash: string;
    recipientAddress: string;
    payerLabel?: string;
  }) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').CryptoExchangeOrder;
      market?: import('./types.ts').MarketTicker;
      summary: import('./types.ts').CryptoVaultSummary;
    }>('/api/exchange/buy-xyph', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createCryptoSwap: (payload: {
    fromCoin: import('./supportedCoins.ts').SupportedCoinSymbol;
    toCoin: import('./supportedCoins.ts').SupportedCoinSymbol;
    fromAmount: number;
    depositTxHash: string;
    recipientAddress: string;
  }) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').CryptoExchangeOrder;
      tokenDelivery?: MetaMaskTokenDelivery;
      market?: import('./types.ts').MarketTicker;
      summary: import('./types.ts').CryptoVaultSummary;
    }>('/api/exchange/swap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMetaMaskExchangeTokens: (evmAddr: string) =>
    requestJson<{
      evmAddress: string;
      chainId: number;
      chainIdHex: string;
      tokens: MetaMaskTokenBalanceItem[];
    }>(`/api/exchange/metamask-tokens/${encodeURIComponent(evmAddr)}`),

  claimExchangeOrderToMetaMask: (orderId: string, metamaskAddress: string) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').CryptoExchangeOrder;
      tokenDelivery?: MetaMaskTokenDelivery;
      accounting?: TransferAccountingReceipt;
      summary: import('./types.ts').CryptoVaultSummary;
    }>(`/api/exchange/orders/${encodeURIComponent(orderId)}/claim-metamask`, {
      method: 'POST',
      body: JSON.stringify({ metamaskAddress }),
    }),

  settleExchangePayout: (
    orderId: string,
    payload: {
      payoutTxHash?: string;
      recipientAddress?: string;
      senderAddress?: string;
      payoutMethod?: import('./types.ts').CryptoExchangeOrder['payoutMethod'];
    }
  ) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').CryptoExchangeOrder;
      verifiedOnChain: boolean;
      accounting?: TransferAccountingReceipt;
      tokenDelivery?: MetaMaskTokenDelivery;
      summary: import('./types.ts').CryptoVaultSummary;
    }>(`/api/exchange/orders/${encodeURIComponent(orderId)}/settle-payout`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  recordCryptoTransfer: (payload: {
    coin: import('./supportedCoins.ts').SupportedCoinSymbol;
    amount: number;
    txHash: string;
    recipientAddress: string;
    senderAddress?: string;
    payoutMethod?: import('./types.ts').CryptoExchangeOrder['payoutMethod'];
  }) =>
    requestJson<{
      ok: boolean;
      order: import('./types.ts').CryptoExchangeOrder;
      verifiedOnChain: boolean;
      accounting?: TransferAccountingReceipt;
      summary: import('./types.ts').CryptoVaultSummary;
    }>('/api/exchange/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Native C++17 Bitcoin-Core-style Engine (xypherd) & Supply-Demand Pricing API
  getCppCoreStatus: () =>
    requestJson<import('./types.ts').CppCoreStatus>('/api/core-cpp/status'),

  getCppCoreSource: (fileId: string) =>
    requestJson<{
      entry: import('./types.ts').CppCoreSourceEntry;
      content: string;
    }>(`/api/core-cpp/source/${encodeURIComponent(fileId)}`),

  quoteCppSupplyDemand: (payload: {
    side: 'buy' | 'sell';
    amount: number;
    circulatingSupplyXyph?: number;
    totalBoughtXyph?: number;
    totalSoldXyph?: number;
  }) =>
    requestJson<import('./types.ts').CppCoreQuoteResponse>('/api/core-cpp/quote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runCppCoreSelfTest: () =>
    requestJson<import('./types.ts').CppCoreSelfTestResponse>('/api/core-cpp/self-test', {
      method: 'POST',
    }),

  runCppCoreBenchmark: (iterations = 50000) =>
    requestJson<import('./types.ts').CppCoreBenchmarkResponse>('/api/core-cpp/benchmark', {
      method: 'POST',
      body: JSON.stringify({ iterations }),
    }),

  getCppVerifiedLiveChain: () =>
    requestJson<import('./types.ts').CppChainVerificationReport>('/api/core-cpp/chain'),

  runCppChainDemo: (blocks = 4, tamperHeight?: number) =>
    requestJson<import('./types.ts').CppChainVerificationReport>('/api/core-cpp/chain-demo', {
      method: 'POST',
      body: JSON.stringify(
        tamperHeight !== undefined ? { blocks, tamperHeight } : { blocks }
      ),
    }),
};



