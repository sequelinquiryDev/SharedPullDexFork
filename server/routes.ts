import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { WebSocketServer, WebSocket } from "ws";
import { ensureTokenListExists } from "./tokenUpdater";
import { subscribeToken, unsubscribeToken, getActiveTokens, getMetrics } from "./watchlistManager";
import { startHourlyRefreshScheduler, scheduleNewTokenRefresh } from "./hourlyRefreshScheduler";
import { startNewTokenChecker } from "./newTokenChecker";

// Single-flight token refresh mechanism
let tokenRefreshTimer: NodeJS.Timeout | null = null;
let pendingTokensAdded = false;
const TOKEN_REFRESH_TTL = 5000; // 5 seconds
let tokenRefreshClients: Set<WebSocket> = new Set();

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
const PRICE_REFRESH_INTERVAL = 25000; // 25 seconds for unconditional server refresh
const SUBSCRIPTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const activeSubscriptions = new Map<string, { clients: Set<WebSocket>, lastSeen: number }>();
const priceFetchingLocks = new Map<string, Promise<any>>();

const iconCache = new Map<string, { url: string; expires: number }>();
const iconFetchingInFlight = new Map<string, Promise<string>>();
const iconRefreshTimers = new Map<string, NodeJS.Timeout>();
const ICON_CACHE_TTL = 60 * 24 * 60 * 60 * 1000; // 60 days

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

const CHAIN_CONFIG: Record<number, { rpc: string; usdcAddr: string; usdtAddr: string; wethAddr: string; factories: string[]; scanApi: string; scanKey: string }> = {
  1: {
    rpc: process.env.VITE_ETH_RPC_URL || "https://eth.llamarpc.com",
    usdcAddr: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    usdtAddr: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    wethAddr: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    factories: ["0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e37608"],
    scanApi: "https://api.etherscan.io/api",
    scanKey: process.env.VITE_ETH_POL_API || ""
  },
  137: {
    rpc: process.env.VITE_POL_RPC_URL || "https://polygon-rpc.com",
    usdcAddr: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    usdtAddr: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    wethAddr: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    factories: ["0x5757371414417b8C6CAd16e5dBb0d812eEA2d29c", "0xc35DADB65012eC5796536bD9864eD8773aBc74C4"],
    scanApi: "https://api.polygonscan.com/api",
    scanKey: process.env.VITE_ETH_POL_API || ""
  }
};

async function getOnChainPrice(address: string, chainId: number): Promise<OnChainPrice | null> {
  const { fetchOnChainData } = await import("./onchainDataFetcher");
  
  try {
    const data = await fetchOnChainData(address, chainId);
    if (!data) return null;
    
    const result: OnChainPrice = {
      price: data.price,
      mc: data.marketCap,
      volume: data.volume24h,
      timestamp: data.timestamp,
    };
    
    const cacheKey = `${chainId}-${address.toLowerCase()}`;
    onChainCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error("[OnChainPrice] Error:", e);
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
      const { fetchOnChainData } = await import("./onchainDataFetcher");
      const onchainData = await fetchOnChainData(address, chainId);
      
      if (!onchainData) {
        console.warn(`[Analytics] Could not fetch on-chain data for ${address} on chain ${chainId}`);
        return null;
      }

      // Generate realistic 24h price history based on actual change24h
      const priceHistory: number[] = [];
      let currentPrice = onchainData.price;
      const targetPrice = currentPrice * (1 + onchainData.change24h / 100);
      const volatility = Math.abs(onchainData.change24h) * 0.3;
      
      for (let i = 0; i < 24; i++) {
        const noise = (Math.random() - 0.5) * volatility;
        const trend = (targetPrice - currentPrice) * 0.15;
        currentPrice = Math.max(currentPrice + trend + noise, onchainData.price * 0.5);
        priceHistory.push(currentPrice);
      }
      
      const result: OnChainAnalytics = {
        change24h: onchainData.change24h,
        volume24h: onchainData.volume24h,
        marketCap: onchainData.marketCap,
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
      console.error('[Analytics] fetch error:', e);
      return null;
    } finally {
      analyticsFetchingLocks.delete(cacheKey);
    }
  })();

  analyticsFetchingLocks.set(cacheKey, promise);
  return await promise;
}

// Dynamically reload all tokens from current tokens.json
// IMPORTANT: This ensures watched tokens stay in sync with the dynamic token list
// Every token MUST have decimals property for accurate math operations
function reloadAllTokensForWatching() {
  try {
    const tokensPath = path.join(process.cwd(), 'client', 'src', 'lib', 'tokens.json');
    const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    const prevSize = watchedTokens.size;
    let newTokensAdded = 0;
    
    // Reload Ethereum tokens with strict decimal validation
    if (tokensData.ethereum && Array.isArray(tokensData.ethereum)) {
      tokensData.ethereum.forEach((token: any) => {
        if (token.address) {
          const key = `1-${token.address.toLowerCase()}`;
          if (!watchedTokens.has(key)) {
            newTokensAdded++;
          }
          watchedTokens.add(key);
          // CRITICAL: Validate decimals exist for accurate calculations
          if (token.decimals === undefined || token.decimals === null) {
            console.warn(`[PriceRefresh] Ethereum token ${token.symbol} (${token.address}) missing decimals property`);
          }
        }
      });
    }
    
    // Reload Polygon tokens with strict decimal validation
    if (tokensData.polygon && Array.isArray(tokensData.polygon)) {
      tokensData.polygon.forEach((token: any) => {
        if (token.address) {
          const key = `137-${token.address.toLowerCase()}`;
          if (!watchedTokens.has(key)) {
            newTokensAdded++;
          }
          watchedTokens.add(key);
          // CRITICAL: Validate decimals exist for accurate calculations
          if (token.decimals === undefined || token.decimals === null) {
            console.warn(`[PriceRefresh] Polygon token ${token.symbol} (${token.address}) missing decimals property`);
          }
        }
      });
    }
    
    if (watchedTokens.size !== prevSize) {
      console.log(`[PriceRefresh] Updated watched tokens: ${prevSize} → ${watchedTokens.size} (${newTokensAdded} new)`);
    }
  } catch (e) {
    console.error('[PriceRefresh] Error loading tokens:', e);
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

// Start unconditional price refresh every 25 seconds for ALL dynamic tokens
function startUnconditionalPriceRefresh() {
  // Initial load - load all tokens once at startup
  reloadAllTokensForWatching();
  
  // Unconditionally refresh prices every 25 seconds (no reload, just refresh cache)
  setInterval(async () => {
    const activeTokens = getActiveTokens();
    console.log(`[PriceCache] Refreshing ${activeTokens.length} tokens (server-side caching only)...`);
    
    for (const tokenKey of activeTokens) {
      const [chainIdStr, address] = tokenKey.split('-');
      const chainId = Number(chainIdStr);
      
      // Fetch fresh price unconditionally (ignore cache)
      await getOnChainPrice(address, chainId);
      // Price is now cached in onChainCache, ready to stream on subscription
    }
    
    console.log('[PriceCache] Refresh complete');
  }, PRICE_REFRESH_INTERVAL);
}

// DEPRECATED: Use hourlyRefreshScheduler instead for GMT/UTC aligned hourly refresh
// This function is kept for backwards compatibility but not used
function startAnalyticsRefreshTimer() {
  console.log("[Routes] Analytics refresh now handled by hourlyRefreshScheduler");
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

// Trigger single-flight token refresh to all connected clients
function triggerTokenRefresh() {
  if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
  
  if (!pendingTokensAdded) {
    pendingTokensAdded = true;
    tokenRefreshTimer = setTimeout(() => {
      console.log(`[TokenRefresh] Broadcasting refresh to ${tokenRefreshClients.size} clients`);
      tokenRefreshClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'refresh-tokens' }));
        }
      });
      pendingTokensAdded = false;
      tokenRefreshTimer = null;
    }, TOKEN_REFRESH_TTL);
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  ensureTokenListExists();
  
  // Start unconditional 25-second price refresh for all dynamic tokens
  startUnconditionalPriceRefresh();
  
  // Start hourly refresh scheduler (GMT/UTC aligned)
  startHourlyRefreshScheduler();
  
  // Start 8-second new token checker (pauses at min 59 and min 0 GMT for hourly refresh)
  startNewTokenChecker();

  const wss = new WebSocketServer({ server: httpServer, path: '/api/ws/prices' });

  wss.on('connection', (ws) => {
    tokenRefreshClients.add(ws);
    const sessionSubscriptions = new Set<string>();           // Track all tokens client ever subscribed to
    const sessionAnalyticsSubscriptions = new Set<string>();  // Track all analytics subscriptions in session
    
    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'subscribe') {
          const key = `${data.chainId}-${data.address.toLowerCase()}`;
          
          // ACCUMULATION MODEL: Never unsubscribe during session, only on disconnect
          // Add to price subscriptions (only if not already in session)
          if (!sessionSubscriptions.has(key)) {
            sessionSubscriptions.add(key);
            subscribeToken(data.chainId, data.address);
            
            if (!activeSubscriptions.has(key)) {
              activeSubscriptions.set(key, { clients: new Set(), lastSeen: Date.now() });
            }
            activeSubscriptions.get(key)!.clients.add(ws);
            console.log(`[WS] Client subscribed to ${key} (session count: ${sessionSubscriptions.size})`);
          }
          
          activeSubscriptions.get(key)!.lastSeen = Date.now();
          
          // Add to analytics subscriptions (only if not already in session)
          const analyticsKey = `analytics-${key}`;
          if (!sessionAnalyticsSubscriptions.has(analyticsKey)) {
            sessionAnalyticsSubscriptions.add(analyticsKey);
            if (!analyticsSubscriptions.has(analyticsKey)) {
              analyticsSubscriptions.set(analyticsKey, new Set());
            }
            analyticsSubscriptions.get(analyticsKey)!.add(ws);
            console.log(`[WS] Client subscribed to analytics for ${key} (session analytics count: ${sessionAnalyticsSubscriptions.size})`);
          }
          
          // Send initial price data to client
          const price = await fetchPriceAggregated(data.address, data.chainId);
          if (price && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'price', data: price, address: data.address, chainId: data.chainId }));
          }
          
          // Send initial analytics data to client
          // Background cache will update this token's analytics
          const analytics = await getOnChainAnalytics(data.address, data.chainId);
          if (analytics && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'analytics', data: analytics, address: data.address, chainId: data.chainId }));
          }
        }
      } catch (e) {
        console.error('[WS] Message error:', e);
      }
    });
    
    ws.on('close', () => {
      // ONLY unsubscribe when session ends (WebSocket closes)
      // This happens for ALL accumulated subscriptions in one go
      for (const key of sessionSubscriptions) {
        activeSubscriptions.get(key)?.clients.delete(ws);
        const [chainId, addr] = key.split('-');
        unsubscribeToken(Number(chainId), addr);
      }
      
      // Remove all analytics subscriptions for this client
      for (const analyticsKey of sessionAnalyticsSubscriptions) {
        analyticsSubscriptions.get(analyticsKey)?.delete(ws);
      }
      
      console.log(`[WS] Client disconnected (unsubscribed from ${sessionSubscriptions.size} tokens)`);
      tokenRefreshClients.delete(ws);
    });
  });

  // Cleanup inactive subscriptions every 1 minute
  setInterval(() => {
    const now = Date.now();
    activeSubscriptions.forEach((sub, key) => {
      if (now - sub.lastSeen > SUBSCRIPTION_TIMEOUT) {
        console.log(`[Subscriptions] Removing inactive subscription: ${key}`);
        activeSubscriptions.delete(key);
      }
    });
  }, 60000);

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

  // CRITICAL: Fetch decimals ONCE from Etherscan/Polygonscan API and cache forever
  // Never fetch decimals again after initial fetch - use cached value always
  async function fetchDecimalsFromScan(address: string, chainId: number): Promise<number | null> {
    const config = CHAIN_CONFIG[chainId];
    if (!config || !config.scanKey) {
      console.warn(`[TokenSearch] VITE_ETH_POL_API not configured - cannot fetch decimals from scan`);
      return null;
    }
    
    try {
      const url = `${config.scanApi}?module=account&action=tokenlist&address=${address}&apikey=${config.scanKey}`;
      const response = await fetch(url, { timeout: 5000 });
      if (!response.ok) return null;
      
      const data = await response.json();
      if (data.status === "1" && data.result && Array.isArray(data.result) && data.result.length > 0) {
        const token = data.result[0];
        const decimals = Number(token.decimals);
        console.log(`[TokenSearch] Fetched decimals from scan: ${address} = ${decimals}`);
        return decimals;
      }
    } catch (e) {
      console.error(`[TokenSearch] Error fetching from scan API:`, e);
    }
    return null;
  }

  app.get("/api/tokens/search", async (req, res) => {
    const { address, chainId } = req.query;
    if (!address || !chainId) return res.status(400).send("Missing params");
    
    const cid = Number(chainId);
    const addr = (address as string).toLowerCase();
    const config = CHAIN_CONFIG[cid];
    
    if (!config) return res.status(400).send("Unsupported chain");
    
    try {
      // Check if token already exists in tokens.json with cached decimals
      const tokensPath = path.join(process.cwd(), 'client', 'src', 'lib', 'tokens.json');
      const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      const chainKey = cid === 1 ? 'ethereum' : 'polygon';
      const tokensList = tokensData[chainKey] || [];
      
      const existingToken = tokensList.find((t: any) => t.address.toLowerCase() === addr);
      
      if (existingToken && existingToken.decimals !== undefined && existingToken.decimals !== null) {
        // CACHED: Token exists with decimals - use cached value, NEVER refetch
        console.log(`[TokenSearch] Using CACHED decimals for ${existingToken.symbol}: ${existingToken.decimals}`);
        return res.json({ 
          address: addr, 
          symbol: existingToken.symbol, 
          decimals: existingToken.decimals, 
          name: existingToken.name 
        });
      }
      
      // Token doesn't exist or missing decimals - fetch from contract for symbol
      const provider = new ethers.providers.JsonRpcProvider(config.rpc);
      const contract = new ethers.Contract(addr, ERC20_ABI, provider);
      let symbol: string;
      let decimals: number;
      
      try {
        symbol = await contract.symbol();
      } catch {
        symbol = "UNKNOWN";
      }
      
      // CRITICAL: Fetch decimals from Etherscan/Polygonscan API first (more reliable)
      // Only fall back to contract call if API fails
      let decimalsFromScan = await fetchDecimalsFromScan(addr, cid);
      if (decimalsFromScan !== null) {
        decimals = decimalsFromScan;
      } else {
        // Fallback: fetch from contract
        try {
          decimals = await contract.decimals();
          console.warn(`[TokenSearch] Fell back to contract call for decimals: ${addr}`);
        } catch {
          console.error(`[TokenSearch] Could not fetch decimals for ${addr} - using default 18`);
          decimals = 18;
        }
      }
      
      if (!existingToken) {
        // NEW TOKEN: Add with decimals from Etherscan/Polygonscan or contract fallback
        // These decimals will be CACHED forever and never refetched
        const newToken = {
          address: addr,
          symbol: symbol.toUpperCase(),
          name: symbol,
          marketCap: 0,
          logoURI: "",
          decimals: Number(decimals)
        };
        
        // Validate decimals before storing
        if (Number.isNaN(newToken.decimals) || newToken.decimals < 0 || newToken.decimals > 255) {
          console.error(`[TokenSearch] CRITICAL: Invalid decimals ${decimals} for token ${symbol} on chain ${cid}`);
          return res.status(500).send("Invalid token decimals - cannot proceed");
        }
        
        tokensList.push(newToken);
        tokensData[chainKey] = tokensList;
        
        // Write back to file with PERMANENT decimals - NEVER refetch
        fs.writeFileSync(tokensPath, JSON.stringify(tokensData, null, 2));
        
        // Register new token for immediate and hourly refresh
        scheduleNewTokenRefresh(cid, addr);
        
        // Trigger single-flight token refresh to all connected clients
        triggerTokenRefresh();
        
        const metrics = getMetrics();
        console.log(`[TokenSearch] ✓ Added new token: ${symbol} (${addr}) chain ${cid} | Decimals: ${decimals} (CACHED FOREVER) | Watched tokens: ${metrics.totalWatchedTokens}`);
      }
      
      res.json({ address: addr, symbol, decimals, name: symbol });
    } catch (e) {
      console.error(`[TokenSearch] Error:`, e);
      res.status(404).send("Token not found on-chain");
    }
  });

  app.get("/api/tokens/list", async (req, res) => {
    const { chainId } = req.query;
    if (!chainId) return res.status(400).json({ error: "Missing chainId" });
    
    const cid = Number(chainId);
    const chainKey = cid === 1 ? 'ethereum' : 'polygon';
    
    try {
      const tokensPath = path.join(process.cwd(), 'client', 'src', 'lib', 'tokens.json');
      const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      const tokensList = tokensData[chainKey] || [];
      
      // Return fresh tokens from disk
      res.json(tokensList);
    } catch (e) {
      console.error(`[TokenList] Error reading tokens for chain ${cid}:`, e);
      res.status(500).json({ error: "Failed to load tokens" });
    }
  });

  // Helper function to set up auto-refresh timer for an icon
  function setupIconAutoRefresh(cacheKey: string) {
    // Clear existing timer if any
    if (iconRefreshTimers.has(cacheKey)) {
      clearTimeout(iconRefreshTimers.get(cacheKey)!);
    }
    
    // Set up a timer to auto-refresh when TTL expires
    const timer = setTimeout(async () => {
      console.log(`[Icon] Auto-refreshing expired icon for ${cacheKey}`);
      iconCache.delete(cacheKey);
      iconRefreshTimers.delete(cacheKey);
      
      // Trigger a refresh by fetching the icon again
      const [chainId, addr] = cacheKey.split('-');
      const cid = Number(chainId);
      
      // Use the same fetch logic to re-cache the icon
      if (!iconFetchingInFlight.has(cacheKey)) {
        const promise = fetchIconUrl(addr, cid);
        iconFetchingInFlight.set(cacheKey, promise);
        await promise;
        iconFetchingInFlight.delete(cacheKey);
        
        // Set up auto-refresh again for the newly cached icon
        const cached = iconCache.get(cacheKey);
        if (cached) {
          setupIconAutoRefresh(cacheKey);
        }
      }
    }, ICON_CACHE_TTL);
    
    iconRefreshTimers.set(cacheKey, timer);
  }

  // Helper function to fetch icon URL from various sources
  async function fetchIconUrl(addr: string, cid: number): Promise<string> {
    console.log(`[Icon] Fetching for ${addr} on chain ${cid}`);
    const cacheKey = `${cid}-${addr}`;
    
    // 1. Try to get logoURI from tokens.json first (highest priority)
    try {
      const tokensPath = path.join(process.cwd(), 'client', 'src', 'lib', 'tokens.json');
      const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      const chainKey = cid === 1 ? 'ethereum' : 'polygon';
      const tokensList = tokensData[chainKey] || [];
      const token = tokensList.find((t: any) => t.address.toLowerCase() === addr);
      
      if (token && token.logoURI && token.logoURI.startsWith('http')) {
        console.log(`[Icon] Found logoURI in tokens.json for ${addr}: ${token.logoURI}`);
        iconCache.set(cacheKey, { url: token.logoURI, expires: Date.now() + ICON_CACHE_TTL });
        setupIconAutoRefresh(cacheKey);
        return token.logoURI;
      }
    } catch (e) {
      console.debug(`[Icon] Failed to fetch logoURI from tokens.json: ${e}`);
    }

    // Try Trust Wallet first
    const trustWalletUrl = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${cid === 1 ? 'ethereum' : 'polygon'}/assets/${ethers.utils.getAddress(addr)}/logo.png`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(trustWalletUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        console.log(`[Icon] Found on Trust Wallet for ${addr} (Checksummed)`);
        iconCache.set(cacheKey, { url: trustWalletUrl, expires: Date.now() + ICON_CACHE_TTL });
        setupIconAutoRefresh(cacheKey);
        return trustWalletUrl;
      }
    } catch (e) {
      console.debug(`[Icon] Trust Wallet failed for ${addr}: ${e}`);
    }
    
    // 3. Try GeckoTerminal
    const geckoTerminalUrl = `https://assets.geckoterminal.com/networks/${cid === 1 ? 'ethereum' : 'polygon'}/tokens/${addr}/thumb.png`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(geckoTerminalUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        console.log(`[Icon] Found on GeckoTerminal for ${addr}`);
        iconCache.set(cacheKey, { url: geckoTerminalUrl, expires: Date.now() + ICON_CACHE_TTL });
        setupIconAutoRefresh(cacheKey);
        return geckoTerminalUrl;
      }
    } catch (e) {
      console.debug(`[Icon] GeckoTerminal failed for ${addr}: ${e}`);
    }
    
    // Try DEXScreener
    const dexscreenerUrl = `https://dexscreener.com/images/defiplated.png`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(dexscreenerUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        iconCache.set(cacheKey, { url: dexscreenerUrl, expires: Date.now() + ICON_CACHE_TTL });
        setupIconAutoRefresh(cacheKey);
        return dexscreenerUrl;
      }
    } catch (e) {
      console.debug(`[Icon] DEXScreener failed for ${addr}: ${e}`);
    }
    
    // Fallback to placeholder
    const placeholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNCIgY3k9IjE0IiByPSIxNCIgZmlsbD0iIzJBMkEzQSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjODg4IiBmb250LXNpemU9IjEyIj4/PC90ZXh0Pjwvc3ZnPg==';
    iconCache.set(cacheKey, { url: placeholder, expires: Date.now() + ICON_CACHE_TTL });
    setupIconAutoRefresh(cacheKey);
    return placeholder;
  }

  app.get("/api/icon", async (req, res) => {
    const { address, chainId } = req.query;
    if (!address || !chainId) return res.status(400).json({ error: "Missing params" });
    
    const cid = Number(chainId);
    const addr = (address as string).toLowerCase();
    const cacheKey = `${cid}-${addr}`;
    
    const cached = iconCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      return res.redirect(cached.url);
    }
    
    if (iconFetchingInFlight.has(cacheKey)) {
      const url = await iconFetchingInFlight.get(cacheKey)!;
      return res.redirect(url);
    }
    
    const promise = fetchIconUrl(addr, cid);
    iconFetchingInFlight.set(cacheKey, promise);
    const url = await promise;
    iconFetchingInFlight.delete(cacheKey);
    
    res.redirect(url);
  });

  // Monitoring endpoint for scalability verification
  app.get("/api/system/metrics", async (req, res) => {
    const { getCacheMetrics } = await import("./onchainDataFetcher");
    const { getRefreshStatus } = await import("./hourlyRefreshScheduler");
    const { getNewTokenCheckerStatus } = await import("./newTokenChecker");
    
    const watchlistMetrics = getMetrics();
    const cacheMetrics = getCacheMetrics();
    const refreshStatus = getRefreshStatus();
    const checkerStatus = getNewTokenCheckerStatus();
    
    res.json({
      watchlist: watchlistMetrics,
      cache: cacheMetrics,
      refresh: refreshStatus,
      newTokenChecker: checkerStatus,
      timestamp: new Date().toISOString(),
    });
  });

  // Check if specific token is subscribed
  app.get("/api/token/subscription-status", (req, res) => {
    const { address, chainId } = req.query;
    if (!address || !chainId) return res.status(400).json({ error: "Missing params" });
    
    const cid = Number(chainId);
    const addr = (address as string).toLowerCase();
    const key = `${cid}-${addr}`;
    
    const subs = activeSubscriptions.get(key);
    const analyticsSubs = analyticsSubscriptions.get(`analytics-${key}`);
    
    res.json({
      tokenKey: key,
      priceSubscribers: subs?.clients.size || 0,
      analyticsSubscribers: analyticsSubs?.size || 0,
      hasActiveSubscribers: (subs?.clients.size || 0) > 0 || (analyticsSubs?.size || 0) > 0,
      cachedPrice: onChainCache.get(key) ? 'YES' : 'NO',
      cachedAnalytics: analyticsCache.get(`analytics-${key}`) ? 'YES' : 'NO',
    });
  });

  return httpServer;
}
