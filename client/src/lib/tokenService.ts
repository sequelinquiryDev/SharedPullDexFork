import { config, ethereumConfig, low, fetchWithTimeout } from './config';
import { ethers } from 'ethers';

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
}

export interface TokenStats {
  price: number | null;
  change: number | null;
  changePeriod: string | null;
  volume24h: number;
  marketCap: number;
  image: string;
}

type DataSource = 'coingecko' | 'cmc';
const DATA_SOURCE_ROTATION_INTERVAL = 2 * 60 * 1000;

let currentDataSource: DataSource = 'coingecko';
let lastSourceRotation = Date.now();

const tokenListByChain = new Map<number, Token[]>();
const tokenMapByChain = new Map<number, Map<string, Token>>();
const statsMapByChain = new Map<number, Map<string, TokenStats>>();
const priceCache = new Map<string, { price: number | null; ts: number }>();

const DARK_SVG_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNCIgY3k9IjE0IiByPSIxNCIgZmlsbD0iIzJBMkEzQSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjODg4IiBmb250LXNpemU9IjEyIj4/PC90ZXh0Pjwvc3ZnPg==';

const chainIdToCoingeckoNetwork: Record<number, string> = {
  1: 'ethereum',
  137: 'polygon-pos',
};

function getChainConfigForId(chainId: number) {
  if (chainId === 1) return ethereumConfig;
  return config;
}

function getCurrentDataSource(): DataSource {
  const now = Date.now();
  if (now - lastSourceRotation >= DATA_SOURCE_ROTATION_INTERVAL) {
    currentDataSource = currentDataSource === 'coingecko' ? 'cmc' : 'coingecko';
    lastSourceRotation = now;
    console.log(`Data source rotated to: ${currentDataSource}`);
  }
  return currentDataSource;
}

async function fetchCMCMarketData(): Promise<Map<string, TokenStats>> {
  const statsMap = new Map<string, TokenStats>();
  const cmcApiKey = import.meta.env.VITE_CMC_API_KEY;
  
  if (!cmcApiKey) {
    console.warn('CMC API key not configured, skipping CMC data fetch');
    return statsMap;
  }

  try {
    const response = await fetchWithTimeout(
      `/api/cmc/listings?limit=250`,
      { headers: { 'Content-Type': 'application/json' } },
      10000
    );
    
    if (!response.ok) {
      throw new Error(`CMC API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach((coin: any) => {
        const symbol = low(coin.symbol || '');
        const name = low(coin.name || '');
        const quote = coin.quote?.USD || {};
        
        const stat: TokenStats = {
          price: typeof quote.price === 'number' ? quote.price : null,
          change: typeof quote.percent_change_24h === 'number' ? quote.percent_change_24h : null,
          changePeriod: '24h',
          volume24h: typeof quote.volume_24h === 'number' ? quote.volume_24h : 0,
          marketCap: typeof quote.market_cap === 'number' ? quote.market_cap : 0,
          image: '',
        };
        
        if (symbol) statsMap.set(symbol, stat);
        if (name) statsMap.set(name, stat);
      });
    }
  } catch (e) {
    console.warn('CMC market data fetch failed:', e);
  }
  
  return statsMap;
}

async function fetchCoinGeckoMarketData(): Promise<Map<string, TokenStats>> {
  const statsMap = new Map<string, TokenStats>();
  
  try {
    // Use server proxy to avoid CORS and protect API keys
    const marketsUrl = `/api/prices/coingecko/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
    const response = await fetchWithTimeout(marketsUrl, {}, 10000);
    
    if (!response.ok) {
      throw new Error(`CoinGecko proxy returned ${response.status}`);
    }
    
    const data = await response.json();
    
    (data as any[]).forEach((coin: any) => {
      const symbol = low(coin.symbol || '');
      const name = low(coin.name || '');
      
      const stat: TokenStats = {
        price: typeof coin.current_price === 'number' ? coin.current_price : null,
        change: typeof coin.price_change_percentage_24h === 'number' ? coin.price_change_percentage_24h : null,
        changePeriod: '24h',
        volume24h: typeof coin.total_volume === 'number' ? coin.total_volume : 0,
        marketCap: typeof coin.market_cap === 'number' ? coin.market_cap : 0,
        image: coin.image || '',
      };
      
      if (symbol) statsMap.set(symbol, stat);
      if (name) statsMap.set(name, stat);
    });
  } catch (e) {
    console.warn('CoinGecko market data fetch failed:', e);
  }
  
  return statsMap;
}

async function fetchMarketData(): Promise<Map<string, TokenStats>> {
  const source = getCurrentDataSource();
  
  let statsMap: Map<string, TokenStats>;
  
  if (source === 'cmc') {
    statsMap = await fetchCMCMarketData();
    if (statsMap.size === 0) {
      console.log('CMC returned no data, falling back to CoinGecko');
      statsMap = await fetchCoinGeckoMarketData();
    }
  } else {
    statsMap = await fetchCoinGeckoMarketData();
    if (statsMap.size === 0) {
      console.log('CoinGecko returned no data, falling back to CMC');
      statsMap = await fetchCMCMarketData();
    }
  }
  
  return statsMap;
}

export async function loadTokensForChain(chainId: number): Promise<void> {
  const network = chainIdToCoingeckoNetwork[chainId] || 'polygon-pos';
  const chainConfig = getChainConfigForId(chainId);
  
  let tokenList: Token[] = [];
  const tokenMap = new Map<string, Token>();
  
  try {
    const [cgResponse, uniResponse] = await Promise.all([
      fetch(`https://tokens.coingecko.com/${network}/all.json`),
      fetch('https://tokens.uniswap.org/').catch(() => null),
    ]);

    const cgData = await cgResponse.json();
    
    tokenList = ((cgData.tokens || []) as any[]).map((t: any) => ({
      address: low(t.address),
      symbol: t.symbol || '',
      name: t.name || '',
      decimals: t.decimals || 18,
      logoURI: t.logoURI || t.logo || '',
    }));

    if (uniResponse) {
      const uniData = await uniResponse.json().catch(() => null);
      if (uniData && uniData.tokens) {
        const uniTokens = ((uniData.tokens || []) as any[])
          .filter((t: any) => t.chainId === chainId)
          .map((t: any) => ({
            address: low(t.address),
            symbol: t.symbol || '',
            name: t.name || '',
            decimals: t.decimals || 18,
            logoURI: t.logoURI || '',
          }));

        const existingAddrs = new Set(tokenList.map((t) => t.address));
        uniTokens.forEach((t) => {
          if (!existingAddrs.has(t.address)) {
            tokenList.push(t);
          }
        });
      }
    }

    tokenList.forEach((t) => tokenMap.set(t.address, t));

    const nativeAddr = chainId === 1 
      ? '0x0000000000000000000000000000000000000000'
      : low(config.maticAddr);
    
    if (!tokenMap.has(nativeAddr)) {
      tokenMap.set(nativeAddr, {
        address: nativeAddr,
        symbol: chainId === 1 ? 'ETH' : 'MATIC',
        name: chainId === 1 ? 'Ethereum' : 'Polygon',
        decimals: 18,
        logoURI: '',
      });
    }

    // Skip 1inch direct API call - use CoinGecko/Uniswap token lists only (more reliable)

    const seen = new Set<string>();
    tokenList = tokenList.filter((t) => {
      if (!t || !t.address) return false;
      if (seen.has(t.address)) return false;
      seen.add(t.address);
      return true;
    });

    tokenListByChain.set(chainId, tokenList);
    tokenMapByChain.set(chainId, tokenMap);

    const statsMap = await fetchMarketData();
    statsMapByChain.set(chainId, statsMap);

    console.log(`Loaded ${tokenList.length} tokens for chain ${chainId}`);
  } catch (e) {
    console.error(`loadTokensForChain error for chainId ${chainId}:`, e);
  }
}

export async function loadTokensAndMarkets(): Promise<void> {
  await loadTokensForChain(config.chainId);
}

export function getTokenList(chainId?: number): Token[] {
  const cid = chainId ?? config.chainId;
  return tokenListByChain.get(cid) || [];
}

export function getTokenMap(chainId?: number): Map<string, Token> {
  const cid = chainId ?? config.chainId;
  return tokenMapByChain.get(cid) || new Map();
}

export function getCgStatsMap(chainId?: number): Map<string, TokenStats> {
  const cid = chainId ?? config.chainId;
  return statsMapByChain.get(cid) || new Map();
}

export function getPlaceholderImage(): string {
  return DARK_SVG_PLACEHOLDER;
}

async function fetch0xPrice(addr: string, chainId?: number): Promise<number | null> {
  const cid = chainId ?? config.chainId;
  const chainConfig = getChainConfigForId(cid);
  
  try {
    const sellToken = addr;
    const buyToken = chainConfig.usdcAddr;
    const resp = await fetchWithTimeout(
      `${chainConfig.zeroXBase}/swap/v1/price?sellToken=${encodeURIComponent(sellToken)}&buyToken=${encodeURIComponent(buyToken)}&sellAmount=1`,
      { headers: { '0x-api-key': config.zeroXApiKey } },
      3500
    );
    if (!resp.ok) throw new Error('0x price fail');
    const j = await resp.json();
    if (j && j.price) return Number(j.price);
    if (j && j.buyAmount) {
      const val = Number(j.buyAmount);
      if (Number.isFinite(val) && val > 0) return val;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function fetch1InchQuotePrice(addr: string, decimals = 18, chainId?: number): Promise<number | null> {
  const cid = chainId ?? config.chainId;
  const chainConfig = getChainConfigForId(cid);
  
  try {
    const amountBN = ethers.BigNumber.from(10).pow(decimals);
    const qUrl = `${chainConfig.oneInchBase}/quote?fromTokenAddress=${addr}&toTokenAddress=${chainConfig.usdcAddr}&amount=${amountBN.toString()}`;
    const res = await fetchWithTimeout(qUrl, {}, 3000);
    if (!res.ok) throw new Error('1inch non-ok');
    const j = await res.json();
    if (!j || !j.toTokenAmount) throw new Error('1inch no toTokenAmount');
    const usdcAmountBN = ethers.BigNumber.from(j.toTokenAmount);
    const usdc = Number(ethers.utils.formatUnits(usdcAmountBN, j.toToken?.decimals ?? 6));
    if (!Number.isFinite(usdc) || usdc <= 0) throw new Error('1inch invalid price');
    return usdc;
  } catch (e) {
    return null;
  }
}

async function fetchCoingeckoSimple(addr: string, chainId?: number): Promise<number | null> {
  const cid = chainId ?? config.chainId;
  const network = chainIdToCoingeckoNetwork[cid] || 'polygon-pos';
  
  try {
    // Use server proxy to avoid CORS and protect API keys
    const url = `/api/prices/coingecko/simple/token_price/${network}?contract_addresses=${addr}&vs_currencies=usd`;
    const res = await fetchWithTimeout(url, {}, 3000);
    if (!res.ok) throw new Error('cg simple non-ok');
    const j = await res.json();
    const v = j[low(addr)]?.usd ?? null;
    if (v && typeof v === 'number' && v > 0) return v;
    return null;
  } catch (e) {
    return null;
  }
}

async function fetchDexscreenerPrice(addr: string): Promise<number | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${addr}`;
    const res = await fetchWithTimeout(url, {}, 3000);
    if (!res.ok) throw new Error('dexscreener non-ok');
    const j = await res.json();
    const pairs = j?.pairs || [];
    for (const p of pairs) {
      if (p?.priceUsd) {
        const v = Number(p.priceUsd);
        if (Number.isFinite(v) && v > 0) return v;
      }
      if (p?.price) {
        const v = Number(p.price);
        if (Number.isFinite(v) && v > 0) return v;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function fetchGeckoTerminalPrice(addr: string, chainId?: number): Promise<number | null> {
  const cid = chainId ?? config.chainId;
  const networkMap: Record<number, string> = {
    1: 'eth',
    137: 'polygon_pos',
  };
  const network = networkMap[cid] || 'polygon_pos';
  
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${addr}`;
    const res = await fetchWithTimeout(url, {}, 3000);
    if (!res.ok) throw new Error('geckoterminal non-ok');
    const j = await res.json();
    const price = j?.data?.attributes?.price_usd;
    if (price && typeof price === 'string') {
      const v = Number(price);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export async function getTokenPriceUSD(address: string, decimals = 18, chainId?: number): Promise<number | null> {
  if (!address) return null;
  const addr = low(address);
  const cacheKey = `${chainId ?? config.chainId}-${addr}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < config.priceCacheTtl) {
    return cached.price;
  }

  const sources = [
    { name: 'coingecko_simple', fn: () => fetchCoingeckoSimple(addr, chainId), priority: 1, retries: 2 },
    { name: '0x', fn: () => fetch0xPrice(addr, chainId), priority: 2, retries: 2 },
    { name: '1inch', fn: () => fetch1InchQuotePrice(addr, decimals, chainId), priority: 3, retries: 2 },
    { name: 'dexscreener', fn: () => fetchDexscreenerPrice(addr), priority: 4, retries: 1 },
    { name: 'geckoterminal', fn: () => fetchGeckoTerminalPrice(addr, chainId), priority: 5, retries: 1 },
  ];

  let best: { price: number; priority: number } | null = null;

  for (const source of sources) {
    for (let attempt = 0; attempt <= source.retries; attempt++) {
      try {
        const price = await source.fn();
        if (price && Number.isFinite(price) && price > 0) {
          if (!best || source.priority < best.priority) {
            best = { price, priority: source.priority };
            break;
          }
        }
      } catch (e) {
        if (attempt === source.retries) {
          console.warn(`${source.name} failed after ${source.retries + 1} attempts`);
        }
        if (attempt < source.retries) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
    
    if (best && best.priority <= 2) break;
  }

  const finalPrice = best?.price ?? null;
  priceCache.set(cacheKey, { price: finalPrice, ts: Date.now() });
  return finalPrice;
}

export async function searchTokens(query: string, chainId?: number): Promise<Token[]> {
  const cid = chainId ?? config.chainId;
  const tokenList = getTokenList(cid);
  const statsMap = getCgStatsMap(cid);
  
  const q = query.toLowerCase();
  const matches = tokenList.filter((t) => {
    const s = t.symbol || '';
    const n = t.name || '';
    return s.toLowerCase().includes(q) || n.toLowerCase().includes(q);
  });

  const withStats = matches.map((t) => {
    const stats = statsMap.get(low(t.symbol)) || statsMap.get(low(t.name));
    const startBonus = (t.symbol.toLowerCase().startsWith(q) || t.name.toLowerCase().startsWith(q)) ? 1e15 : 0;
    
    const marketCap = stats?.marketCap || (stats?.price && stats?.volume24h ? (stats.price * stats.volume24h * 0.01) : 0);
    const v24 = stats?.volume24h || 0;
    
    const score = startBonus + (marketCap * 10) + v24;
    
    return { t, stats, score, marketCap, v24 };
  });

  withStats.sort((a, b) => b.score - a.score);

  const top7ByMarketCap = withStats
    .filter((x) => x.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 7);

  const usedAddresses = new Set(top7ByMarketCap.map((x) => x.t.address));
  
  const top7ByVolume = withStats
    .filter((x) => !usedAddresses.has(x.t.address) && x.v24 > 0)
    .sort((a, b) => b.v24 - a.v24)
    .slice(0, 7);

  const combined = [...top7ByMarketCap, ...top7ByVolume];
  
  const seen = new Set<string>();
  const unique = combined.filter((x) => {
    if (seen.has(x.t.address)) return false;
    seen.add(x.t.address);
    return true;
  });

  return unique.slice(0, 14).map((x) => x.t);
}

export function getTopTokens(limit = 14, chainId?: number): { token: Token; stats: TokenStats | null }[] {
  const cid = chainId ?? config.chainId;
  const tokenList = getTokenList(cid);
  const statsMap = getCgStatsMap(cid);
  
  const candidates = tokenList.filter((t) => {
    const s = low(t.symbol);
    const n = low(t.name);
    return statsMap.has(s) || statsMap.has(n);
  });

  const withStats = candidates.map((t) => {
    const s = low(t.symbol);
    const n = low(t.name);
    const stat = statsMap.get(s) || statsMap.get(n) || null;
    return { token: t, stats: stat };
  });

  const halfLimit = Math.floor(limit / 2);
  
  const byMarketCap = [...withStats]
    .filter((x) => x.stats?.marketCap && x.stats.marketCap > 0)
    .sort((a, b) => (b.stats?.marketCap || 0) - (a.stats?.marketCap || 0))
    .slice(0, halfLimit);

  const usedAddresses = new Set(byMarketCap.map((x) => x.token.address));
  
  const byVolume = [...withStats]
    .filter((x) => !usedAddresses.has(x.token.address) && x.stats?.volume24h && x.stats.volume24h > 0)
    .sort((a, b) => (b.stats?.volume24h || 0) - (a.stats?.volume24h || 0))
    .slice(0, halfLimit);

  const combined = [...byMarketCap, ...byVolume];
  
  const seen = new Set<string>();
  return combined.filter((x) => {
    if (seen.has(x.token.address)) return false;
    seen.add(x.token.address);
    return true;
  }).slice(0, limit);
}

export function getTopTokensByChain(chainId: number, limit = 14): { token: Token; stats: TokenStats | null }[] {
  return getTopTokens(limit, chainId);
}

export async function getTokenByAddress(address: string, chainId?: number): Promise<Token | null> {
  const cid = chainId ?? config.chainId;
  const addr = low(address);
  
  // First check local token map
  const tokenMap = getTokenMap(cid);
  if (tokenMap.has(addr)) {
    return tokenMap.get(addr) || null;
  }
  
  // Try to fetch from multiple sources
  const sources = [
    // CoinGecko
    async () => {
      const network = chainIdToCoingeckoNetwork[cid] || 'polygon-pos';
      const url = `https://api.coingecko.com/api/v3/coins/${network}/contract/${addr}`;
      const headers: Record<string, string> = {};
      if (config.coingeckoApiKey) {
        headers['x-cg-pro-api-key'] = config.coingeckoApiKey;
      }
      const res = await fetchWithTimeout(url, { headers }, 5000);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.symbol) {
        return {
          address: addr,
          symbol: data.symbol?.toUpperCase() || '',
          name: data.name || '',
          decimals: data.detail_platforms?.[network]?.decimal_place || 18,
          logoURI: data.image?.small || data.image?.thumb || '',
        };
      }
      return null;
    },
    // GeckoTerminal
    async () => {
      const networkMap: Record<number, string> = { 1: 'eth', 137: 'polygon_pos' };
      const network = networkMap[cid] || 'polygon_pos';
      const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${addr}`;
      const res = await fetchWithTimeout(url, {}, 5000);
      if (!res.ok) return null;
      const data = await res.json();
      const attrs = data?.data?.attributes;
      if (attrs && attrs.symbol) {
        return {
          address: addr,
          symbol: attrs.symbol?.toUpperCase() || '',
          name: attrs.name || '',
          decimals: attrs.decimals || 18,
          logoURI: attrs.image_url || '',
        };
      }
      return null;
    },
    // DexScreener
    async () => {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${addr}`;
      const res = await fetchWithTimeout(url, {}, 5000);
      if (!res.ok) return null;
      const data = await res.json();
      const pairs = data?.pairs || [];
      const chainFilter = cid === 1 ? 'ethereum' : 'polygon';
      const pair = pairs.find((p: any) => p.chainId === chainFilter);
      if (pair) {
        const baseToken = pair.baseToken?.address?.toLowerCase() === addr ? pair.baseToken : pair.quoteToken;
        if (baseToken) {
          return {
            address: addr,
            symbol: baseToken.symbol || '',
            name: baseToken.name || '',
            decimals: 18,
            logoURI: '',
          };
        }
      }
      return null;
    },
  ];
  
  for (const source of sources) {
    try {
      const token = await source();
      if (token) {
        // Cache it
        const tokenList = tokenListByChain.get(cid) || [];
        tokenList.push(token);
        tokenListByChain.set(cid, tokenList);
        tokenMap.set(addr, token);
        tokenMapByChain.set(cid, tokenMap);
        return token;
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

export function getTokenLogoUrl(token: Token, chainId?: number): string {
  if (token.logoURI) return token.logoURI;
  
  const cid = chainId ?? config.chainId;
  const addr = low(token.address);
  
  // Multiple fallback sources for token logos
  const logoSources = [
    `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${cid === 1 ? 'ethereum' : 'polygon'}/assets/${addr}/logo.png`,
    `https://assets.coingecko.com/coins/images/1/small/${token.symbol?.toLowerCase()}.png`,
    `https://tokens.1inch.io/${addr}.png`,
  ];
  
  return logoSources[0] || getPlaceholderImage();
}

export async function refreshMarketData(chainId?: number): Promise<void> {
  const cid = chainId ?? config.chainId;
  const statsMap = await fetchMarketData();
  statsMapByChain.set(cid, statsMap);
  console.log(`Refreshed market data for chain ${cid}, source: ${currentDataSource}`);
}
