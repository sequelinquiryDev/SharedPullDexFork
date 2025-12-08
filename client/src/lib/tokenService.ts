import { config, low, fetchWithTimeout } from './config';
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
  image: string;
}

let tokenList: Token[] = [];
const tokenMap = new Map<string, Token>();
const cgStatsMap = new Map<string, TokenStats>();
const priceCache = new Map<string, { price: number | null; ts: number }>();

const DARK_SVG_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNCIgY3k9IjE0IiByPSIxNCIgZmlsbD0iIzJBMkEzQSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjODg4IiBmb250LXNpemU9IjEyIj4/PC90ZXh0Pjwvc3ZnPg==';

export async function loadTokensAndMarkets(): Promise<void> {
  try {
    const r = await fetch('https://tokens.coingecko.com/polygon-pos/all.json');
    const j = await r.json();
    tokenList = ((j.tokens || []) as any[]).map((t: any) => ({
      address: low(t.address),
      symbol: t.symbol || '',
      name: t.name || '',
      decimals: t.decimals || 18,
      logoURI: t.logoURI || t.logo || '',
    }));
    tokenList.forEach((t) => tokenMap.set(t.address, t));
    
    if (!tokenMap.has(low(config.maticAddr))) {
      tokenMap.set(low(config.maticAddr), {
        address: low(config.maticAddr),
        symbol: 'MATIC',
        name: 'Polygon',
        decimals: 18,
        logoURI: '',
      });
    }

    try {
      const marketsUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
      const rm = await fetchWithTimeout(marketsUrl, {}, 5000);
      const jm = await rm.json();
      (jm as any[]).forEach((c: any) => {
        const sym = low(c.symbol || '');
        const name = low(c.name || '');
        const stat: TokenStats = {
          price: typeof c.current_price === 'number' ? c.current_price : null,
          change: typeof c.price_change_percentage_24h === 'number' ? c.price_change_percentage_24h : null,
          changePeriod: '24h',
          volume24h: typeof c.total_volume === 'number' ? c.total_volume : 0,
          image: c.image || '',
        };
        if (sym) cgStatsMap.set(sym, stat);
        if (name) cgStatsMap.set(name, stat);
      });
    } catch (e) {
      console.warn('CoinGecko markets failed', e);
    }

    try {
      const r1 = await fetch(`${config.oneInchBase}/tokens`);
      const j1 = await r1.json();
      if (j1 && j1.tokens) {
        Object.values(j1.tokens as Record<string, any>).forEach((t: any) => {
          const addr = low(t.address || '');
          if (!addr) return;
          if (tokenMap.has(addr)) return;
          const obj: Token = {
            address: addr,
            symbol: t.symbol || '',
            name: t.name || '',
            decimals: t.decimals || 18,
            logoURI: t.logoURI || '',
          };
          tokenList.push(obj);
          tokenMap.set(addr, obj);
        });
      }
    } catch (e) {
      /* ignore */
    }

    const seen = new Set<string>();
    tokenList = tokenList.filter((t) => {
      if (!t || !t.address) return false;
      if (seen.has(t.address)) return false;
      seen.add(t.address);
      return true;
    });

    console.log('Loaded tokens:', tokenList.length);
  } catch (e) {
    console.error('loadTokensAndMarkets error', e);
  }
}

export function getTokenList(): Token[] {
  return tokenList;
}

export function getTokenMap(): Map<string, Token> {
  return tokenMap;
}

export function getCgStatsMap(): Map<string, TokenStats> {
  return cgStatsMap;
}

export function getPlaceholderImage(): string {
  return DARK_SVG_PLACEHOLDER;
}

async function fetch0xPrice(addr: string): Promise<number | null> {
  try {
    const sellToken = addr;
    const buyToken = config.usdcAddr;
    const resp = await fetchWithTimeout(
      `${config.zeroXBase}/swap/v1/price?sellToken=${encodeURIComponent(sellToken)}&buyToken=${encodeURIComponent(buyToken)}&sellAmount=1`,
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

async function fetch1InchQuotePrice(addr: string, decimals = 18): Promise<number | null> {
  try {
    const amountBN = ethers.BigNumber.from(10).pow(decimals);
    const qUrl = `${config.oneInchBase}/quote?fromTokenAddress=${addr}&toTokenAddress=${config.usdcAddr}&amount=${amountBN.toString()}`;
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

async function fetchCoingeckoSimple(addr: string): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${config.coingeckoChain}?contract_addresses=${addr}&vs_currencies=usd`;
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

export async function getTokenPriceUSD(address: string, decimals = 18): Promise<number | null> {
  if (!address) return null;
  const addr = low(address);
  const cached = priceCache.get(addr);
  if (cached && Date.now() - cached.ts < config.priceCacheTtl) {
    return cached.price;
  }

  const sources = [
    { name: '0x', fn: () => fetch0xPrice(addr), priority: 1 },
    { name: '1inch', fn: () => fetch1InchQuotePrice(addr, decimals), priority: 2 },
    { name: 'coingecko_simple', fn: () => fetchCoingeckoSimple(addr), priority: 3 },
    { name: 'dexscreener', fn: () => fetchDexscreenerPrice(addr), priority: 4 },
  ];

  let best: { price: number; priority: number } | null = null;

  const results = await Promise.allSettled(sources.map((s) => s.fn()));

  results.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value) {
      const val = result.value;
      if (Number.isFinite(val) && val > 0) {
        if (!best || sources[idx].priority < best.priority) {
          best = { price: val, priority: sources[idx].priority };
        }
      }
    }
  });

  const finalPrice = best?.price ?? null;
  priceCache.set(addr, { price: finalPrice, ts: Date.now() });
  return finalPrice;
}

export async function searchTokens(query: string): Promise<Token[]> {
  const q = query.toLowerCase();
  const matches = tokenList.filter((t) => {
    const s = t.symbol || '';
    const n = t.name || '';
    return s.toLowerCase().includes(q) || n.toLowerCase().includes(q);
  });

  const cgMatches = matches
    .filter((t) => cgStatsMap.has(low(t.symbol)) || cgStatsMap.has(low(t.name)))
    .map((t) => {
      const stats = cgStatsMap.get(low(t.symbol)) || cgStatsMap.get(low(t.name));
      const startBonus =
        t.symbol.toLowerCase().startsWith(q) || t.name.toLowerCase().startsWith(q) ? 1e12 : 0;
      const v24 = stats?.volume24h || 0;
      return { t, stats, score: v24 + startBonus };
    })
    .sort((a, b) => b.score - a.score);

  const nonCgMatches = matches
    .filter((t) => {
      const hasCG = cgStatsMap.has(low(t.symbol)) || cgStatsMap.has(low(t.name));
      return !hasCG;
    })
    .map((t) => {
      const startBonus =
        t.symbol.toLowerCase().startsWith(q) || t.name.toLowerCase().startsWith(q) ? 1e10 : 0;
      return { t, stats: null, score: startBonus };
    })
    .sort((a, b) => b.score - a.score);

  return [...cgMatches.map((x) => x.t), ...nonCgMatches.map((x) => x.t)].slice(0, 12);
}

export function getTopTokens(limit = 15): { token: Token; stats: TokenStats | null }[] {
  const candidates = tokenList.filter((t) => {
    const s = low(t.symbol);
    const n = low(t.name);
    return cgStatsMap.has(s) || cgStatsMap.has(n);
  });

  const withStats = candidates.map((t) => {
    const s = low(t.symbol);
    const n = low(t.name);
    const stat = cgStatsMap.get(s) || cgStatsMap.get(n) || null;
    return { token: t, stats: stat };
  });

  withStats.sort((a, b) => (b.stats?.volume24h || 0) - (a.stats?.volume24h || 0));

  return withStats.slice(0, limit);
}
