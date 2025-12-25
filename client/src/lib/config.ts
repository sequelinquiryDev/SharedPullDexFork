// Load default tokens for initial selection
import ethTokens from '../assets/tokens/eth-tokens.json';
import polTokens from '../assets/tokens/polygon-tokens.json';

const defaultEth = (ethTokens as any[]).find((t: any) => t.symbol === 'ETH' || t.symbol === 'WETH') || ethTokens[0];
const defaultPol = (polTokens as any[]).find((t: any) => t.symbol === 'MATIC' || t.symbol === 'POL') || polTokens[0];
const defaultUsdtEth = (ethTokens as any[]).find((t: any) => t.symbol === 'USDT') || ethTokens[1];
const defaultUsdtPol = (polTokens as any[]).find((t: any) => t.symbol === 'USDT') || polTokens[1];

export const DEFAULT_TOKENS = {
  1: { from: defaultEth, to: defaultUsdtEth },
  137: { from: defaultPol, to: defaultUsdtPol }
};

// SECURITY: All API keys are protected server-side.
// RPC URLs, API keys, and secrets are fetched from /api/config at runtime.

// Server config cache
let serverConfigCache: ServerConfig | null = null;
let serverConfigPromise: Promise<ServerConfig> | null = null;

export interface OnChainPrice {
  price: number;
  mc: number;
  volume: number;
  timestamp: number;
}

interface ServerConfig {
  chainId: number;
  chainIdHex: string;
  chainName: string;
  coingeckoChain: string;
  // SECURITY: RPC URLs are NOT exposed - use proxy endpoints instead
  rpcProxyEndpoints: {
    eth: string;
    pol: string;
  };
  oneInchBase: string;
  zeroXBase: string;
  usdcAddr: string;
  wethAddr: string;
  maticAddr: string;
  feePercent: number;
  feeRecipient: string;
  quoteCacheTtl: number;
  priceCacheTtl: number;
  siteName: string;
  explorerUrl: string;
  defaultSlippage: number;
  slippageOptions: number[];
  hasCoingeckoKey: boolean;
  hasCmcKey: boolean;
  hasZeroXKey: boolean;
  hasLifiKey: boolean;
  hasEthPolApi: boolean;
  hasCustomEthRpc: boolean;
  hasCustomPolRpc: boolean;
  walletConnectProjectId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

// Fetch server config once and cache it
export async function fetchServerConfig(): Promise<ServerConfig> {
  if (serverConfigCache) return serverConfigCache;
  if (serverConfigPromise) return serverConfigPromise;
  
  serverConfigPromise = fetch('/api/config')
    .then(res => res.json())
    .then(data => {
      serverConfigCache = data;
      return data;
    })
    .catch(err => {
      console.error('Failed to fetch server config:', err);
      return getDefaultConfig();
    });
  
  return serverConfigPromise;
}

// Get cached config synchronously (returns defaults if not loaded)
export function getServerConfig(): ServerConfig | null {
  return serverConfigCache;
}

function getDefaultConfig(): ServerConfig {
  return {
    chainId: 137,
    chainIdHex: '0x89',
    chainName: 'Polygon',
    coingeckoChain: 'polygon-pos',
    // SECURITY: Only proxy endpoints, never raw RPC URLs
    rpcProxyEndpoints: {
      eth: '/api/proxy/rpc/eth',
      pol: '/api/proxy/rpc/pol',
    },
    oneInchBase: 'https://api.1inch.io/v5.0/137',
    zeroXBase: 'https://polygon.api.0x.org',
    usdcAddr: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    wethAddr: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    maticAddr: '0x0000000000000000000000000000000000001010',
    feePercent: 0.00001,
    feeRecipient: '',
    quoteCacheTtl: 10000,
    priceCacheTtl: 10000,
    siteName: 'NOLA Exchange',
    explorerUrl: 'https://polygonscan.com',
    defaultSlippage: 1,
    slippageOptions: [0.5, 1, 2, 3],
    hasCoingeckoKey: false,
    hasCmcKey: false,
    hasZeroXKey: false,
    hasLifiKey: false,
    hasEthPolApi: false,
    hasCustomEthRpc: false,
    hasCustomPolRpc: false,
    walletConnectProjectId: '',
    supabaseUrl: '',
    supabaseAnonKey: '',
  };
}

// Static config with safe defaults (NO API KEYS exposed)
export const config = {
  chainId: 137,
  chainIdHex: '0x89',
  chainName: 'Polygon',
  coingeckoChain: 'polygon-pos',
  // SECURITY: RPC URLs provided as safe fallbacks, server uses custom RPCs
  rpcUrls: [
    'https://polygon-rpc.com',
    'https://rpc-mainnet.maticvigil.com',
  ],
  oneInchBase: 'https://api.1inch.io/v5.0/137',
  zeroXBase: 'https://polygon.api.0x.org',
  usdcAddr: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  wethAddr: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  maticAddr: '0x0000000000000000000000000000000000001010',
  // SECURITY: These are intentionally empty - all API calls go through server proxy
  zeroXApiKey: '', // Never expose - use /api/proxy/0x/*
  walletConnectProjectId: '', // Loaded from server at runtime
  feePercent: 0.00001,
  feeRecipient: '',
  quoteCacheTtl: 10000,
  priceCacheTtl: 10000,
  // SECURITY: Supabase client credentials (anon key is designed to be public)
  supabaseUrl: '',
  supabaseAnonKey: '',
  logoUrl: 'https://nol.pages.dev/logoapp.png',
  siteName: 'NOLA Exchange',
  explorerUrl: 'https://polygonscan.com',
  defaultSlippage: 1,
  slippageOptions: [0.5, 1, 2, 3],
};

export const ethereumConfig = {
  chainId: 1,
  chainIdHex: '0x1',
  chainName: 'Ethereum',
  coingeckoChain: 'ethereum',
  // SECURITY: RPC URLs provided as safe fallbacks, server uses custom RPCs as primary
  rpcUrls: [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
  ],
  oneInchBase: 'https://api.1inch.io/v5.0/1',
  zeroXBase: 'https://api.0x.org',
  usdcAddr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  wethAddr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  explorerUrl: 'https://etherscan.io',
  feeUsd: 1.2,
};

// Initialize config from server on app load
// SECURITY: Does NOT copy any RPC URLs - all RPC calls go through proxy endpoints
export async function initializeConfig(): Promise<void> {
  try {
    const serverConfig = await fetchServerConfig();
    // Only update non-sensitive values from server
    if (serverConfig.walletConnectProjectId) {
      (config as any).walletConnectProjectId = serverConfig.walletConnectProjectId;
    }
    if (serverConfig.supabaseUrl) {
      (config as any).supabaseUrl = serverConfig.supabaseUrl;
    }
    if (serverConfig.supabaseAnonKey) {
      (config as any).supabaseAnonKey = serverConfig.supabaseAnonKey;
    }
    // RPC URLs are NEVER copied - wagmi uses /api/proxy/rpc/* endpoints directly
  } catch (err) {
    console.error('Config initialization error:', err);
  }
}

export const explorerTxLink = (tx: string) => `${config.explorerUrl}/tx/${tx}`;

export const isAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test((v || '').trim());

export const low = (s: string) => (s || '').toLowerCase();

export const formatUSD = (v: number | null | undefined, forSuggestions: boolean = false): string => {
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
    opts.maximumFractionDigits = forSuggestions ? 4 : 2;
    opts.minimumFractionDigits = 2;
  } else if (absN >= 0.01) {
    opts.maximumFractionDigits = forSuggestions ? 6 : 4;
    opts.minimumFractionDigits = 2;
  } else if (absN >= 0.0001) {
    opts.maximumFractionDigits = forSuggestions ? 8 : 6;
    opts.minimumFractionDigits = forSuggestions ? 6 : 4;
  } else if (absN >= 0.00000001) {
    opts.maximumFractionDigits = forSuggestions ? 12 : 10;
    opts.minimumFractionDigits = forSuggestions ? 8 : 6;
  } else {
    // Very small values (like some micro-cap tokens)
    opts.maximumFractionDigits = 14;
    opts.minimumFractionDigits = 10;
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