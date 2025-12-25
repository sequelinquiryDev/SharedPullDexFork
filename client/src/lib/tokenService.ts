import { config, ethereumConfig, low, fetchWithTimeout, type OnChainPrice } from './config';
import { ethers } from 'ethers';

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
}

// Filter function to remove unwanted tokens
function isTokenAllowed(token: Token): boolean {
  return true;
}

export interface TokenStats {
  price: number | null;
  change: number | null;
  changePeriod: string | null;
  volume24h: number;
  marketCap: number;
  image: string;
}

const tokenListByChain = new Map<number, Token[]>();
const tokenMapByChain = new Map<number, Map<string, Token>>();
const statsMapByAddressChain = new Map<number, Map<string, TokenStats>>(); // On-chain prices by address

// WebSocket path for real-time prices
const WS_PRICE_URL = typeof window !== 'undefined' 
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws/prices`
  : '';

// REMOVED: Price WebSocket handling moved to priceService.ts

const DARK_SVG_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNCIgY3k9IjE0IiByPSIxNCIgZmlsbD0iIzJBMkEzQSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjODg4IiBmb250LXNpemU9IjEyIj4/PC90ZXh0Pjwvc3ZnPg==';

const chainIdToCoingeckoNetwork: Record<number, string> = {
  1: 'ethereum',
  137: 'polygon-pos',
};

function getChainConfigForId(chainId: number) {
  if (chainId === 1) return ethereumConfig;
  return config;
}


// Load tokens from local JSON (OFFICIAL HOST)
import localTokens from './tokens.json';

async function loadTokensFromSelfHosted(chainId: number): Promise<Token[] | null> {
  const chainKey = chainId === 1 ? 'ethereum' : 'polygon';
  const tokens = (localTokens as any)[chainKey] || [];
  
  if (tokens.length === 0) {
    console.warn(`Local tokens for chain ${chainId} not found in tokens.json`);
    return null;
  }
  
  const tokenList: Token[] = tokens.map((t: any) => ({
    address: low(t.address || ''),
    symbol: t.symbol || '',
    name: t.name || '',
    decimals: t.decimals || 18,
    logoURI: t.logoURI || '',
  })).filter((t: any) => t.address).filter(isTokenAllowed);
  
  console.log(`✓ Loaded ${tokenList.length} tokens for chain ${chainId} from local host`);
  return tokenList;
}


export async function loadTokensForChain(chainId: number): Promise<void> {
  const chainConfig = getChainConfigForId(chainId);
  
  let tokenList: Token[] = [];
  const tokenMap = new Map<string, Token>();
  
  try {
    // PRIMARY: Load from self-hosted JSON only (top 500 tokens per chain)
    console.log(`Loading tokens for chain ${chainId}...`);
    tokenList = await loadTokensFromSelfHosted(chainId) || [];
    
    if (tokenList.length === 0) {
      console.warn(`⚠️ Chain ${chainId}: Token list unavailable. Contract address search still works.`);
    }

    tokenList.forEach((t) => tokenMap.set(t.address, t));

    const nativeAddr = chainId === 1 
      ? '0x0000000000000000000000000000000000000000'
      : low(config.maticAddr);
    
    const ethToken = {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      logoURI: '',
    };
    
    const maticToken = {
      address: low(config.maticAddr),
      symbol: 'MATIC',
      name: 'Polygon',
      decimals: 18,
      logoURI: '',
    };

    if (!tokenMap.has(nativeAddr)) {
      tokenMap.set(nativeAddr, chainId === 1 ? ethToken : maticToken);
    }

    // Force add WETH and USDC to the list if missing for ETH chain
    if (chainId === 1) {
      const wethAddr = low('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      const usdcAddr = low('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      
      if (!tokenMap.has(wethAddr)) {
        tokenMap.set(wethAddr, { address: wethAddr, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, logoURI: '' });
        tokenList.unshift(tokenMap.get(wethAddr)!);
      }
      if (!tokenMap.has(usdcAddr)) {
        tokenMap.set(usdcAddr, { address: usdcAddr, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: '' });
        tokenList.unshift(tokenMap.get(usdcAddr)!);
      }
      if (!tokenMap.has(ethToken.address)) {
        tokenList.unshift(ethToken);
      }
    }

    const seen = new Set<string>();
    tokenList = tokenList.filter((t) => {
      if (!t || !t.address) return false;
      const addr = low(t.address);
      if (seen.has(addr)) return false;
      seen.add(addr);
      return true;
    });

    console.log(`[loadTokensForChain] Final list size for chain ${chainId}: ${tokenList.length}`);
    tokenListByChain.set(chainId, tokenList);
    tokenMapByChain.set(chainId, tokenMap);
    
    // Empty on-chain stats map - will be filled by WebSocket updates
    statsMapByAddressChain.set(chainId, new Map<string, TokenStats>());

    console.log(`✓ Loaded ${tokenList.length} tokens for chain ${chainId} (self-hosted primary source)`);
  } catch (e) {
    console.error(`loadTokensForChain error for chainId ${chainId}:`, e);
  }
}

export async function loadTokensAndMarkets(): Promise<void> {
  await loadTokensForChain(config.chainId);
}

export function getTokenList(chainId?: number): Token[] {
  const cid = chainId ?? config.chainId;
  const list = tokenListByChain.get(cid) || [];
  if (list.length === 0) {
    // If not loaded, return some basics to avoid empty UI
    const nativeAddr = cid === 1 
      ? '0x0000000000000000000000000000000000000000'
      : low(config.maticAddr);
    return [{
      address: nativeAddr,
      symbol: cid === 1 ? 'ETH' : 'MATIC',
      name: cid === 1 ? 'Ethereum' : 'Polygon',
      decimals: 18,
      logoURI: '',
    }];
  }
  return list;
}

export function getTokenMap(chainId?: number): Map<string, Token> {
  const cid = chainId ?? config.chainId;
  return tokenMapByChain.get(cid) || new Map();
}


export function getStatsByTokenAddress(address: string, chainId?: number): TokenStats | null {
  const cid = chainId ?? config.chainId;
  const addr = low(address);
  const statsMapByAddress = statsMapByAddressChain.get(cid);
  return statsMapByAddress?.get(addr) || null;
}

// Get stats map for a chain (used by TokenSearchBar)
export function getCgStatsMap(chainId: number): Map<string, TokenStats> {
  return statsMapByAddressChain.get(chainId) || new Map();
}


export function getPlaceholderImage(): string {
  return DARK_SVG_PLACEHOLDER;
}


// On-chain price fetching ONLY - no external fallback
export async function getTokenPriceUSD(address: string, decimals = 18, chainId?: number): Promise<number | null> {
  if (!address) return null;
  const addr = low(address);
  const validChainId = (chainId === 1 || chainId === 137) ? chainId : config.chainId;
  
  // Fetch on-chain price from server cache (20-second TTL)
  try {
    const res = await fetch(`/api/prices/onchain?address=${addr}&chainId=${validChainId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.price && data.price > 0) {
        return data.price;
      }
    }
  } catch (e) {
    console.error('On-chain price fetch error:', e);
  }
  
  // No fallback - return null if on-chain fetch fails
  return null;
}

export async function searchTokens(query: string, chainId?: number): Promise<Token[]> {
  const cid = chainId ?? config.chainId;
  const tokenList = getTokenList(cid);
  
  const q = query.toLowerCase();
  const matches = tokenList.filter((t) => {
    const s = t.symbol || '';
    const n = t.name || '';
    return (s.toLowerCase().includes(q) || n.toLowerCase().includes(q));
  });

  const withStats = matches.map((t) => {
    const stats = getStatsByTokenAddress(t.address, cid);
    const symbolLower = (t.symbol || '').toLowerCase();
    const nameLower = (t.name || '').toLowerCase();
    
    // Major exact match bonus
    let startBonus = 0;
    if (symbolLower === q || nameLower === q) {
      startBonus = 1e20;
    } else if (symbolLower.startsWith(q) || nameLower.startsWith(q)) {
      startBonus = 1e15;
    }
    
    const marketCap = stats?.marketCap || 0;
    const v24 = stats?.volume24h || 0;
    
    const score = startBonus + (marketCap * 10) + v24;
    
    return { t, stats, score, marketCap, v24 };
  });

  withStats.sort((a, b) => b.score - a.score);

  return withStats.slice(0, 15).map((x) => x.t);
}

export function getTopTokens(limit = 14, chainId?: number): { token: Token; stats: TokenStats | null }[] {
  const cid = chainId ?? config.chainId;
  const tokenList = getTokenList(cid);
  
  const withStats = tokenList.map((t) => {
    const stat = getStatsByTokenAddress(t.address, cid);
    return { token: t, stats: stat };
  });

  if (withStats.length === 0) return [];

  const sorted = [...withStats].sort((a, b) => {
    const mcA = a.stats?.marketCap || 0;
    const mcB = b.stats?.marketCap || 0;
    return mcB - mcA;
  });

  // Fallback: If still nothing for ETH, use some hardcoded defaults
  if (sorted.length === 0 && cid === 1) {
    return [
      { token: { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoURI: '' }, stats: null },
      { token: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: '' }, stats: null },
      { token: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6, logoURI: '' }, stats: null }
    ].slice(0, limit);
  }

  return sorted.slice(0, limit);
}

export function getTopTokensByChain(chainId: number, limit = 14): { token: Token; stats: TokenStats | null }[] {
  return getTopTokens(limit, chainId);
}

export async function getTokenByAddress(address: string, chainId?: number): Promise<Token | null> {
  const cid = chainId ?? config.chainId;
  const addr = low(address);
  
  // Check local token map ONLY (no external API fallback)
  const tokenMap = getTokenMap(cid);
  return tokenMap.get(addr) || null;
}

export function getTokenLogoUrl(token: Token, chainId?: number): string {
  if (token.logoURI) return token.logoURI;
  
  const cid = chainId ?? config.chainId;
  const addr = low(token.address);
  
  // Icon fallbacks (KEPT: only image assets, not price data)
  const logoSources = [
    `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${cid === 1 ? 'ethereum' : 'polygon'}/assets/${addr}/logo.png`,
    `https://assets.coingecko.com/coins/images/1/small/${token.symbol?.toLowerCase()}.png`,
    `https://tokens.1inch.io/${addr}.png`,
  ];
  
  return logoSources[0] || getPlaceholderImage();
}

export async function refreshMarketData(chainId?: number): Promise<void> {
  // Market data is now streamed via WebSocket
  console.log(`Market data for chain ${chainId} updated via WebSocket`);
}

// REMOVED: Historical price data fetch (use on-chain only)

