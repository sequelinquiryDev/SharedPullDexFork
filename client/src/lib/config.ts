export const config = {
  chainId: Number(import.meta.env.VITE_CHAIN_ID || 137),
  chainIdHex: import.meta.env.VITE_CHAIN_ID_HEX || '0x89',
  chainName: import.meta.env.VITE_CHAIN_NAME || 'Polygon',
  coingeckoChain: import.meta.env.VITE_COINGECKO_CHAIN || 'polygon-pos',
  coingeckoApiKey: import.meta.env.VITE_COINGECKO_API_KEY || '',
  rpcUrls: [
    'https://polygon-rpc.com', // Use public RPC by default
    'https://rpc-mainnet.maticvigil.com',
  ],
  oneInchBase: import.meta.env.VITE_ONEINCH_BASE || 'https://api.1inch.io/v5.0/137',
  zeroXBase: import.meta.env.VITE_ZEROX_BASE || 'https://polygon.api.0x.org',
  usdcAddr: import.meta.env.VITE_USDC_ADDR || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  wethAddr: import.meta.env.VITE_WETH_ADDR || '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  maticAddr: import.meta.env.VITE_MATIC_ADDR || '0x0000000000000000000000000000000000001010',
  zeroXApiKey: import.meta.env.VITE_ZEROX_API_KEY || '',
  walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '',
  feePercent: Number(import.meta.env.VITE_FEE_PERCENT || 0.00001),
  feeRecipient: import.meta.env.VITE_FEE_RECIPIENT || '',
  quoteCacheTtl: Number(import.meta.env.VITE_QUOTE_CACHE_TTL || 10000),
  priceCacheTtl: Number(import.meta.env.VITE_PRICE_CACHE_TTL || 10000),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  logoUrl: 'https://nol.pages.dev/logoapp.png',
  siteName: import.meta.env.VITE_SITE_NAME || 'NOLA Exchange',
  explorerUrl: import.meta.env.VITE_EXPLORER_URL || 'https://polygonscan.com',
  defaultSlippage: Number(import.meta.env.VITE_DEFAULT_SLIPPAGE) || 1,
  slippageOptions: (import.meta.env.VITE_SLIPPAGE_OPTIONS || '0.5,1,2,3').split(',').map(Number),
};

export const ethereumConfig = {
  chainId: 1,
  chainIdHex: '0x1',
  chainName: 'Ethereum',
  coingeckoChain: 'ethereum',
  rpcUrls: [
    'https://eth.llamarpc.com', // Use public RPC by default
    'https://rpc.ankr.com/eth',
  ],
  oneInchBase: 'https://api.1inch.io/v5.0/1',
  zeroXBase: 'https://api.0x.org',
  usdcAddr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  wethAddr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  explorerUrl: 'https://etherscan.io',
  feeUsd: 1.2,
};

export const explorerTxLink = (tx: string) => `${config.explorerUrl}/tx/${tx}`;

export const isAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test((v || '').trim());

export const low = (s: string) => (s || '').toLowerCase();

export const formatUSD = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const n = Number(v);
  const opts: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
  };
  
  // Dynamic decimal precision based on value magnitude
  const absN = Math.abs(n);
  if (absN === 0) {
    opts.maximumFractionDigits = 2;
    opts.minimumFractionDigits = 2;
  } else if (absN >= 1000) {
    opts.maximumFractionDigits = 2;
    opts.minimumFractionDigits = 2;
  } else if (absN >= 1) {
    opts.maximumFractionDigits = 2;
    opts.minimumFractionDigits = 2;
  } else if (absN >= 0.01) {
    opts.maximumFractionDigits = 4;
    opts.minimumFractionDigits = 2;
  } else if (absN >= 0.0001) {
    opts.maximumFractionDigits = 6;
    opts.minimumFractionDigits = 4;
  } else if (absN >= 0.00000001) {
    opts.maximumFractionDigits = 10;
    opts.minimumFractionDigits = 6;
  } else {
    // Very small values (like some micro-cap tokens)
    opts.maximumFractionDigits = 12;
    opts.minimumFractionDigits = 8;
  }
  
  return new Intl.NumberFormat('en-US', opts).format(n);
};

// Format token amount with decimal awareness
export const formatTokenAmount = (v: number | null | undefined, decimals: number = 18): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const n = Number(v);
  const absN = Math.abs(n);
  
  // Calculate significant digits based on value
  let maxDecimals = 6;
  if (absN === 0) {
    maxDecimals = 2;
  } else if (absN >= 1000) {
    maxDecimals = 2;
  } else if (absN >= 1) {
    maxDecimals = 4;
  } else if (absN >= 0.01) {
    maxDecimals = 6;
  } else if (absN >= 0.0001) {
    maxDecimals = 8;
  } else {
    maxDecimals = Math.min(decimals, 12);
  }
  
  return n.toLocaleString('en-US', {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: 2,
  });
};

export const shortAddr = (addr: string) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

export const fetchWithTimeout = async (
  url: string,
  opts: RequestInit = {},
  ms = 5000
): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  const init = { ...opts, signal: controller.signal };
  try {
    const response = await fetch(url, init);
    return response;
  } finally {
    clearTimeout(id);
  }
};