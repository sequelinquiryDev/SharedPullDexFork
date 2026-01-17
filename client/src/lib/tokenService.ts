import { config, ethereumConfig, low, fetchWithTimeout, type OnChainPrice } from './config';
import { ethers } from 'ethers';
import { iconCache, getIconCacheKey as getIconCacheKeyUtil } from './iconCache';

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
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
const statsMapByAddressChain = new Map<number, Map<string, TokenStats>>();

function getChainConfigForId(chainId: number) {
  if (chainId === 1) return ethereumConfig;
  return config;
}

// Load tokens from API (fresh from disk) instead of static import to show newly added tokens
async function loadTokensFromSelfHosted(chainId: number): Promise<Token[] | null> {
  try {
    const res = await fetch(`/api/tokens/list?chainId=${chainId}`);
    if (!res.ok) throw new Error(`Failed to fetch tokens: ${res.status}`);
    
    const tokens = await res.json();
    
    if (!Array.isArray(tokens) || tokens.length === 0) {
      console.warn(`No tokens for chain ${chainId}`);
      return null;
    }
    
    return tokens.map((t: any) => {
      // CRITICAL: Every token MUST have explicit decimals from on-chain data
      // If decimals is missing, log warning as it indicates incomplete token data
      const decimals = t.decimals ?? 18;
      if (t.decimals === undefined) {
        console.warn(`[TokenService] Token ${t.symbol} (${t.address}) on chain ${chainId} missing decimals - using default 18. This indicates incomplete token metadata.`);
      }
      return {
        address: low(t.address || ''),
        symbol: t.symbol || '',
        name: t.name || '',
        decimals: decimals,
        logoURI: t.logoURI || ''
      };
    }).filter((t: any) => t.address).filter(isTokenAllowed);
  } catch (e) {
    console.error(`Failed to load tokens from API for chain ${chainId}:`, e);
    return null;
  }
}

async function updateCachedTokens(chainId: number, tokenList: Token[]): Promise<void> {
  const tokenMap = new Map<string, Token>();
  tokenList.forEach((t) => tokenMap.set(t.address, t));

  tokenListByChain.set(chainId, tokenList);
  tokenMapByChain.set(chainId, tokenMap);
  if (!statsMapByAddressChain.has(chainId)) {
    statsMapByAddressChain.set(chainId, new Map<string, TokenStats>());
  }

  console.log(`✓ Loaded ${tokenList.length} tokens for chain ${chainId}`);
  
  // Explicitly check for defaults being in the map
  const nativeAddr = chainId === 1 ? '0x0000000000000000000000000000000000000000' : '0x0000000000000000000000000000000000001010';
  if (!tokenMap.has(nativeAddr)) {
    console.warn(`[TokenService] Native address ${nativeAddr} missing for chain ${chainId}`);
  }
}

export async function loadTokensForChain(chainId: number): Promise<void> {
  try {
    const tokenList = await loadTokensFromSelfHosted(chainId) || [];
    await updateCachedTokens(chainId, tokenList);
  } catch (e) {
    console.error(`loadTokensForChain error ${chainId}:`, e);
  }
}

export async function refreshTokensForChain(chainId: number): Promise<void> {
  try {
    const tokenList = await loadTokensFromSelfHosted(chainId) || [];
    await updateCachedTokens(chainId, tokenList);
    console.log(`✓ Token list refreshed for chain ${chainId}`);
  } catch (e) {
    console.error(`refreshTokensForChain error ${chainId}:`, e);
  }
}

export async function loadTokensAndMarkets(): Promise<void> {
  await Promise.all([
    loadTokensForChain(1),
    loadTokensForChain(137)
  ]);
  console.log("✓ Token lists loaded from API");
  
  // Listen for token refresh events from server (single-flight refresh)
  // When tokens are added by users, server will signal refresh within 5 seconds
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('refresh-tokens', async () => {
      await Promise.all([
        refreshTokensForChain(1),
        refreshTokensForChain(137)
      ]);
      console.log('✓ Token list refreshed from server signal');
    });
  }
}

export function getTokenList(chainId?: number): Token[] {
  const cid = chainId ?? config.chainId;
  return tokenListByChain.get(cid) || [];
}

export function clearPriceCache() {
  // Logic to clear price cache if needed, or just a stub if handled by server
}

export function getTokenMap(chainId?: number): Map<string, Token> {
  const cid = chainId ?? config.chainId;
  return tokenMapByChain.get(cid) || new Map();
}

export function getStatsByTokenAddress(address: string, chainId?: number): TokenStats | null {
  const cid = chainId ?? config.chainId;
  return statsMapByAddressChain.get(cid)?.get(low(address)) || null;
}

export function getCgStatsMap(chainId: number): Map<string, TokenStats> {
  return statsMapByAddressChain.get(chainId) || new Map();
}

export function getPlaceholderImage(): string {
  return iconCache.getPlaceholder();
}

const priceCache = new Map<string, { price: number; timestamp: number }>();
const PRICE_CACHE_TTL = 15000; // 15 seconds

export async function getTokenPriceUSD(address: string, decimals = 18, chainId?: number): Promise<number | null> {
  const addr = low(address);
  const cid = (chainId === 1 || chainId === 137) ? chainId : config.chainId;
  const cacheKey = `${cid}-${addr}`;

  // Check client-side cache
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
    return cached.price;
  }

  try {
    const res = await fetch(`/api/prices/onchain?address=${addr}&chainId=${cid}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.price) {
        priceCache.set(cacheKey, { price: data.price, timestamp: Date.now() });
        return data.price;
      }
    }
  } catch (e) { console.error('Price fetch error:', e); }
  return null;
}

export async function searchTokens(query: string, chainId?: number): Promise<Token[]> {
  const cid = chainId ?? config.chainId;
  const list = getTokenList(cid);
  const q = query.toLowerCase();
  return list.filter(t => 
    t.symbol.toLowerCase().includes(q) || 
    t.name.toLowerCase().includes(q) ||
    low(t.address) === q
  ).slice(0, 15);
}

export function getTopTokens(limit = 14, chainId?: number): { token: Token; stats: TokenStats | null }[] {
  const cid = chainId ?? config.chainId;
  const list = getTokenList(cid);
  // If stats aren't loaded yet, just return first N tokens
  return list.slice(0, limit).map(token => ({
    token,
    stats: getStatsByTokenAddress(token.address, cid)
  }));
}

export function getTopTokensByChain(chainId: number, limit = 14): { token: Token; stats: TokenStats | null }[] {
  return getTopTokens(limit, chainId);
}

export async function getTokenByAddress(address: string, chainId?: number): Promise<Token | null> {
  const cid = chainId ?? config.chainId;
  const addr = low(address);
  const token = getTokenMap(cid).get(addr);
  if (token) return token;

  try {
    const res = await fetch(`/api/tokens/search?address=${addr}&chainId=${cid}`);
    if (res.ok) {
      const data = await res.json();
      return {
        address: low(data.address),
        symbol: data.symbol || '???',
        name: data.name || 'Unknown',
        decimals: data.decimals || 18,
        logoURI: ''
      };
    }
  } catch {}
  return null;
}

export function getIconCacheKey(address: string, chainId: number): string {
  return getIconCacheKeyUtil(address, chainId);
}

export function getTokenLogoUrl(token: Token, chainId?: number): string {
  if (!token || !token.address) return getPlaceholderImage();
  const cid = chainId ?? config.chainId;
  // Use unified icon cache for consistent behavior
  // This will return placeholder and trigger background fetch if not cached
  return iconCache.getIconSync(token.address, cid);
}

export async function fetchTokenIcon(token: Token, chainId?: number): Promise<string> {
  const cid = chainId ?? config.chainId;
  if (!token || !token.address) return getPlaceholderImage();
  
  // Use unified icon cache with race condition protection
  return iconCache.getIcon(token.address, cid);
}

export interface OnChainAnalytics {
  change24h: number;
  volume24h: number;
  marketCap: number;
  priceHistory: number[];
  timestamp: number;
  stabilityStatus?: string;
}

export async function getOnChainAnalytics(address: string, chainId?: number): Promise<OnChainAnalytics | null> {
  const cid = chainId ?? config.chainId;
  const addr = low(address);
  try {
    const res = await fetch(`/api/onchain-analytics?address=${addr}&chainId=${cid}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.error('Onchain analytics error:', e);
  }
  return null;
}

export async function refreshMarketData(chainId?: number): Promise<void> {}
