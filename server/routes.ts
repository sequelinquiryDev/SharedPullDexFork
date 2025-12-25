import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { WebSocketServer, WebSocket } from "ws";
import { updateTokenLists } from "./tokenUpdater";

const ERC20_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

interface OnChainPrice {
  price: number;
  mc: number;
  volume: number;
  timestamp: number;
}

const onChainCache = new Map<string, OnChainPrice>();
const CACHE_TTL = 20000; // 20 seconds
const SUBSCRIPTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const activeSubscriptions = new Map<string, { clients: Set<WebSocket>, lastSeen: number }>();
const priceFetchingLocks = new Map<string, Promise<any>>();

const iconCache = new Map<string, { url: string; expires: number }>();
const iconFetchingInFlight = new Map<string, Promise<string>>();
const ICON_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Analytics caching with 1-hour TTL
interface CachedAnalytics {
  data: OnChainAnalytics;
  timestamp: number;
}
const analyticsCache = new Map<string, CachedAnalytics>();
const ANALYTICS_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const watchedTokens = new Set<string>();
const analyticsSubscriptions = new Map<string, Set<WebSocket>>();
const analyticsFetchingLocks = new Map<string, Promise<any>>();

const CHAIN_CONFIG: Record<number, { rpc: string; usdcAddr: string; usdtAddr: string; wethAddr: string; factories: string[] }> = {
  1: {
    rpc: process.env.VITE_ETH_RPC_URL || "https://eth.llamarpc.com",
    usdcAddr: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    usdtAddr: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    wethAddr: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    factories: ["0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e37608"]
  },
  137: {
    rpc: process.env.VITE_POL_RPC_URL || "https://polygon-rpc.com",
    usdcAddr: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    usdtAddr: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    wethAddr: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    factories: ["0x5757371414417b8C6CAd16e5dBb0d812eEA2d29c", "0xc35DADB65012eC5796536bD9864eD8773aBc74C4"]
  }
};

async function getOnChainPrice(address: string, chainId: number): Promise<OnChainPrice | null> {
  const cacheKey = `${chainId}-${address.toLowerCase()}`;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return null;

  try {
    const provider = new ethers.providers.JsonRpcProvider(config.rpc);
    const tokenAddr = address.toLowerCase();
    
    // For contract search/metadata (metadata is already handled by /api/tokens/search)
    // Here we focus on the real price logic
    // This is where real on-chain price discovery should be implemented
    const price = Math.random() * 100; // Placeholder for real price discovery logic
    
    const result = { price, mc: 0, volume: 0, timestamp: Date.now() };
    onChainCache.set(cacheKey, result);
    return result;
  } catch (e) {
    return null;
  }
}

interface OnChainAnalytics {
  change24h: number;
  volume24h: number;
  marketCap: number;
  priceHistory: number[];
  timestamp: number;
}

// Fetch 24h onchain analytics for token with 1-hour caching
async function getOnChainAnalytics(address: string, chainId: number): Promise<OnChainAnalytics | null> {
  const cacheKey = `analytics-${chainId}-${address.toLowerCase()}`;
  
  // Check cache first (1-hour TTL)
  const cached = analyticsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ANALYTICS_CACHE_TTL) {
    return cached.data;
  }

  // Use single-flight pattern to prevent thundering herd
  if (analyticsFetchingLocks.has(cacheKey)) {
    return await analyticsFetchingLocks.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      // Generate realistic mock 24h analytics (1-hour intervals: 24 data points)
      const priceHistory: number[] = [];
      let currentPrice = 100;
      const change24h = (Math.random() - 0.5) * 50; // -25 to +25%
      const targetPrice = 100 * (1 + change24h / 100);
      const volatility = Math.abs(change24h) * 0.3;
      
      for (let i = 0; i < 24; i++) {
        const noise = (Math.random() - 0.5) * volatility;
        const trend = (targetPrice - currentPrice) * 0.15;
        currentPrice = Math.max(currentPrice + trend + noise, 1);
        priceHistory.push(currentPrice);
      }
      
      const result: OnChainAnalytics = {
        change24h,
        volume24h: Math.random() * 10000000,
        marketCap: Math.random() * 1000000000,
        priceHistory,
        timestamp: Date.now()
      };
      
      // Store in analytics cache
      analyticsCache.set(cacheKey, { data: result, timestamp: Date.now() });
      
      // Broadcast to all subscribers
      const subs = analyticsSubscriptions.get(cacheKey);
      if (subs && subs.size > 0) {
        const msg = JSON.stringify({ type: 'analytics', data: result, address, chainId });
        subs.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        });
      }
      
      return result;
    } catch (e) {
      console.error('Analytics fetch error:', e);
      return null;
    } finally {
      analyticsFetchingLocks.delete(cacheKey);
    }
  })();

  analyticsFetchingLocks.set(cacheKey, promise);
  return await promise;
}

// Load all tokens from JSON and add to watched set
function loadTokensForWatching() {
  try {
    const tokensPath = path.join(process.cwd(), 'client', 'src', 'lib', 'tokens.json');
    const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    
    // Add Ethereum tokens
    if (tokensData.ethereum && Array.isArray(tokensData.ethereum)) {
      tokensData.ethereum.forEach((token: any) => {
        if (token.address) {
          watchedTokens.add(`1-${token.address.toLowerCase()}`);
        }
      });
    }
    
    // Add Polygon tokens
    if (tokensData.polygon && Array.isArray(tokensData.polygon)) {
      tokensData.polygon.forEach((token: any) => {
        if (token.address) {
          watchedTokens.add(`137-${token.address.toLowerCase()}`);
        }
      });
    }
    
    console.log(`[Analytics] Loaded ${watchedTokens.size} tokens for watching`);
  } catch (e) {
    console.error('[Analytics] Error loading tokens:', e);
  }
}

// Refresh analytics for all watched tokens and broadcast to subscribers
async function refreshAllAnalytics() {
  const tokenArray = Array.from(watchedTokens);
  console.log(`[Analytics] Refreshing ${tokenArray.length} tokens...`);
  
  for (const tokenKey of tokenArray) {
    const [chainIdStr, address] = tokenKey.split('-');
    const chainId = Number(chainIdStr);
    
    // Only refresh if we have subscribers or it's from the initial token list
    const cacheKey = `analytics-${chainId}-${address}`;
    const hasSubs = analyticsSubscriptions.has(cacheKey);
    const cached = analyticsCache.get(cacheKey);
    const isExpired = !cached || Date.now() - cached.timestamp >= ANALYTICS_CACHE_TTL;
    
    if (hasSubs || isExpired) {
      await getOnChainAnalytics(address, chainId);
    }
  }
  
  console.log('[Analytics] Refresh complete');
}

// Start automatic refresh every 1 hour
function startAnalyticsRefreshTimer() {
  // Initial load
  loadTokensForWatching();
  refreshAllAnalytics();
  
  // Refresh every 1 hour
  setInterval(() => {
    refreshAllAnalytics();
  }, ANALYTICS_CACHE_TTL);
}

async function fetchPriceAggregated(address: string, chainId: number) {
  const cacheKey = `${chainId}-${address.toLowerCase()}`;
  const cached = onChainCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached;

  if (priceFetchingLocks.has(cacheKey)) return priceFetchingLocks.get(cacheKey);

  const promise = (async () => {
    const result = await getOnChainPrice(address, chainId);
    setTimeout(() => priceFetchingLocks.delete(cacheKey), 1500);
    return result;
  })();

  priceFetchingLocks.set(cacheKey, promise);
  return promise;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  updateTokenLists().catch(console.error);
  
  // Start analytics caching and refresh timer
  startAnalyticsRefreshTimer();

  const wss = new WebSocketServer({ server: httpServer, path: '/api/ws/prices' });

  wss.on('connection', (ws) => {
    let currentSub: string | null = null;
    let currentAnalyticsSub: string | null = null;
    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'subscribe') {
          const key = `${data.chainId}-${data.address.toLowerCase()}`;
          if (currentSub) activeSubscriptions.get(currentSub)?.clients.delete(ws);
          currentSub = key;
          if (!activeSubscriptions.has(key)) activeSubscriptions.set(key, { clients: new Set(), lastSeen: Date.now() });
          activeSubscriptions.get(key)!.clients.add(ws);
          activeSubscriptions.get(key)!.lastSeen = Date.now();
          
          // Also subscribe to analytics for this token
          const analyticsKey = `analytics-${data.chainId}-${data.address.toLowerCase()}`;
          if (currentAnalyticsSub && currentAnalyticsSub !== analyticsKey) {
            analyticsSubscriptions.get(currentAnalyticsSub)?.delete(ws);
          }
          currentAnalyticsSub = analyticsKey;
          if (!analyticsSubscriptions.has(analyticsKey)) {
            analyticsSubscriptions.set(analyticsKey, new Set());
            watchedTokens.add(`${data.chainId}-${data.address.toLowerCase()}`);
          }
          analyticsSubscriptions.get(analyticsKey)!.add(ws);
          
          const price = await fetchPriceAggregated(data.address, data.chainId);
          if (price && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'price', data: price, address: data.address, chainId: data.chainId }));
          
          // Send latest analytics
          const analytics = await getOnChainAnalytics(data.address, data.chainId);
          if (analytics && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'analytics', data: analytics, address: data.address, chainId: data.chainId }));
          }
        }
      } catch (e) {}
    });
    ws.on('close', () => {
      if (currentSub) activeSubscriptions.get(currentSub)?.clients.delete(ws);
      if (currentAnalyticsSub) analyticsSubscriptions.get(currentAnalyticsSub)?.delete(ws);
    });
  });

  setInterval(() => {
    const now = Date.now();
    activeSubscriptions.forEach((sub, key) => {
      if (now - sub.lastSeen > SUBSCRIPTION_TIMEOUT) { activeSubscriptions.delete(key); return; }
      if (sub.clients.size === 0) return;
      const [chainId, address] = key.split('-');
      fetchPriceAggregated(address, Number(chainId)).then(price => {
        if (price) {
          const msg = JSON.stringify({ type: 'price', data: price, address, chainId: Number(chainId) });
          sub.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
        }
      });
    });
  }, 8000);

  app.get("/api/prices/onchain", async (req, res) => {
    const { address, chainId } = req.query;
    if (!address || !chainId) return res.status(400).send("Missing params");
    const price = await fetchPriceAggregated(address as string, Number(chainId));
    res.json(price);
  });

  app.get("/api/onchain-analytics", async (req, res) => {
    const { address, chainId } = req.query;
    if (!address || !chainId) return res.status(400).json({ error: "Missing params" });
    const analytics = await getOnChainAnalytics(address as string, Number(chainId));
    res.json(analytics || {});
  });

  app.get("/api/tokens/search", async (req, res) => {
    const { address, chainId } = req.query;
    if (!address || !chainId) return res.status(400).send("Missing params");
    
    const cid = Number(chainId);
    const addr = (address as string).toLowerCase();
    const config = CHAIN_CONFIG[cid];
    
    if (!config) return res.status(400).send("Unsupported chain");
    
    try {
      const provider = new ethers.providers.JsonRpcProvider(config.rpc);
      const contract = new ethers.Contract(addr, ERC20_ABI, provider);
      const [symbol, decimals] = await Promise.all([
        contract.symbol(),
        contract.decimals()
      ]);
      
      // Check if token already exists in tokens.json
      const tokensPath = path.join(process.cwd(), 'client', 'src', 'lib', 'tokens.json');
      const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      const chainKey = cid === 1 ? 'ethereum' : 'polygon';
      const tokensList = tokensData[chainKey] || [];
      
      const existingToken = tokensList.find((t: any) => t.address.toLowerCase() === addr);
      
      if (!existingToken) {
        // Token doesn't exist, add it permanently
        const newToken = {
          address: addr,
          symbol: symbol.toUpperCase(),
          name: symbol,
          marketCap: 0,
          logoURI: "",
          decimals: Number(decimals)
        };
        
        tokensList.push(newToken);
        tokensData[chainKey] = tokensList;
        
        // Write back to file
        fs.writeFileSync(tokensPath, JSON.stringify(tokensData, null, 2));
        
        // Add to watched tokens for analytics refresh
        watchedTokens.add(`${cid}-${addr}`);
        
        console.log(`[TokenSearch] Added new token to tokens.json: ${symbol} (${addr}) on chain ${cid}`);
      }
      
      res.json({ address: addr, symbol, decimals, name: symbol });
    } catch (e) {
      res.status(404).send("Token not found on-chain");
    }
  });

  app.get("/api/icon", async (req, res) => {
    const { address, chainId } = req.query;
    if (!address || !chainId) return res.status(400).json({ error: "Missing params" });
    
    const cid = Number(chainId);
    const addr = (address as string).toLowerCase();
    const cacheKey = `${cid}-${addr}`;
    
    const cached = iconCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      return res.json({ url: cached.url });
    }
    
    if (iconFetchingInFlight.has(cacheKey)) {
      const url = await iconFetchingInFlight.get(cacheKey)!;
      return res.json({ url });
    }
    
    const promise = (async () => {
      // Try Trust Wallet first
      const trustWalletUrl = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${cid === 1 ? 'ethereum' : 'polygon'}/assets/${addr}/logo.png`;
      try {
        const response = await fetch(trustWalletUrl, { method: 'HEAD', timeout: 3000 });
        if (response.ok) {
          iconCache.set(cacheKey, { url: trustWalletUrl, expires: Date.now() + ICON_CACHE_TTL });
          return trustWalletUrl;
        }
      } catch (e) {
        console.debug(`[Icon] Trust Wallet failed for ${addr}: ${e}`);
      }
      
      // Try to get logoURI from tokens.json
      try {
        const tokensPath = path.join(process.cwd(), 'client', 'src', 'lib', 'tokens.json');
        const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
        const chainKey = cid === 1 ? 'ethereum' : 'polygon';
        const tokensList = tokensData[chainKey] || [];
        const token = tokensList.find((t: any) => t.address.toLowerCase() === addr);
        
        if (token && token.logoURI) {
          iconCache.set(cacheKey, { url: token.logoURI, expires: Date.now() + ICON_CACHE_TTL });
          return token.logoURI;
        }
      } catch (e) {
        console.debug(`[Icon] Failed to fetch logoURI from tokens.json: ${e}`);
      }
      
      // Try GeckoTerminal
      const geckoTerminalUrl = `https://assets.geckoterminal.com/networks/${cid === 1 ? 'ethereum' : 'polygon'}/tokens/${addr}/thumb.png`;
      try {
        const response = await fetch(geckoTerminalUrl, { method: 'HEAD', timeout: 3000 });
        if (response.ok) {
          iconCache.set(cacheKey, { url: geckoTerminalUrl, expires: Date.now() + ICON_CACHE_TTL });
          return geckoTerminalUrl;
        }
      } catch (e) {
        console.debug(`[Icon] GeckoTerminal failed for ${addr}: ${e}`);
      }
      
      // Try DEXScreener
      const dexscreenerUrl = `https://dexscreener.com/images/defiplated.png`;
      try {
        const response = await fetch(dexscreenerUrl, { method: 'HEAD', timeout: 3000 });
        if (response.ok) {
          iconCache.set(cacheKey, { url: dexscreenerUrl, expires: Date.now() + ICON_CACHE_TTL });
          return dexscreenerUrl;
        }
      } catch (e) {
        console.debug(`[Icon] DEXScreener failed for ${addr}: ${e}`);
      }
      
      // Fallback to placeholder
      const placeholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNCIgY3k9IjE0IiByPSIxNCIgZmlsbD0iIzJBMkEzQSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjODg4IiBmb250LXNpemU9IjEyIj4/PC90ZXh0Pjwvc3ZnPg==';
      iconCache.set(cacheKey, { url: placeholder, expires: Date.now() + ICON_CACHE_TTL });
      return placeholder;
    })();
    
    iconFetchingInFlight.set(cacheKey, promise);
    const url = await promise;
    iconFetchingInFlight.delete(cacheKey);
    
    res.json({ url });
  });

  return httpServer;
}
