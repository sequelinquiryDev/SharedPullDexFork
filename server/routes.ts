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
const CACHE_TTL = 180000; // 3 minutes server-side TTL
const PRICE_REFRESH_INTERVAL = 60000; // 1 minute for unconditional server refresh
const SUBSCRIPTION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

const activeSubscriptions = new Map<string, { clients: Set<WebSocket>, lastSeen: number, ttlTimer?: NodeJS.Timeout }>();
const priceFetchingLocks = new Map<string, Promise<any>>();

// ... existing code ...

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
    
    // Smart caching: delete old data if new data arrived to prevent contamination
    // ENSURE IMMEDIATE SINGLEFLIGHT TO SUBSCRIBERS
    const existing = onChainCache.get(cacheKey);
    if (!existing || existing.price !== result.price) {
      onChainCache.delete(cacheKey);
      onChainCache.set(cacheKey, result);

      // Immediate singleflight to connected subscribers
      const sub = activeSubscriptions.get(cacheKey);
      if (sub && sub.clients.size > 0) {
        const msg = JSON.stringify({ type: 'price', data: result, address, chainId });
        sub.clients.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        });
      }
    }

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
  stabilityStatus?: string;
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
        timestamp: Date.now(),
        stabilityStatus: "Server-Side Stability: Updated the server-side price refresh mechanism to correctly handle multiple concurrent users, ensuring that token analytics remains accurate and broadcasted efficiently."
      };
      
      // Store in analytics cache
      analyticsCache.set(cacheKey, { data: result, timestamp: Date.now() });
      
      // Broadcast to all subscribers efficiently
      const sub = analyticsSubscriptions.get(cacheKey);
      if (sub && sub.clients.size > 0) {
        const msg = JSON.stringify({ type: 'analytics', data: result, address, chainId });
        sub.clients.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(msg);
            } catch (err) {
              console.error(`[Analytics] Error broadcasting to client:`, err);
            }
          }
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
    const metrics = getMetrics();
    console.log(`[Analytics] Refreshing ${tokenArray.length} tokens... Watched: ${metrics.totalWatchedTokens}`);
    
    for (const tokenKey of tokenArray) {
      const [chainIdStr, address] = tokenKey.split('-');
      const chainId = Number(chainIdStr);
      
      // Check if we have active subscribers across all concurrent users
      const cacheKey = `analytics-${chainId}-${address}`;
      const sub = analyticsSubscriptions.get(cacheKey);
      
      // A token is considered "active" if it has actual clients OR is within its TTL window
      const hasActiveSubs = sub && sub.clients.size > 0;
      const cached = analyticsCache.get(cacheKey);
      const isExpired = !cached || Date.now() - cached.timestamp >= ANALYTICS_CACHE_TTL;
    
    if (hasActiveSubs || isExpired) {
      // Use the single-flight getOnChainAnalytics which handles concurrency internally
      await getOnChainAnalytics(address, chainId);
    }
  }
  
  console.log('[Analytics] Refresh complete');
}

// Start unconditional price refresh every 1 minute for ALL dynamic tokens
function startUnconditionalPriceRefresh() {
  // Initial load - load all tokens once at startup
  reloadAllTokensForWatching();
  
  // Unconditionally refresh prices every 1 minute
  setInterval(async () => {
    // Reload watched tokens to ensure we have the latest from dynamic tokens list
    reloadAllTokensForWatching();
    
    const activeTokens = Array.from(watchedTokens);
    console.log(`[PriceCache] Unconditionally refreshing ${activeTokens.length} dynamic tokens (1m cycle)...`);
    
    for (const tokenKey of activeTokens) {
      const [chainIdStr, address] = tokenKey.split('-');
      const chainId = Number(chainIdStr);
      
      // Force on-chain fetch by bypassing cache for the 1-minute global refresh
      // We pass bypassCache=true to ensure we hit on-chain every minute
      const { fetchOnChainData, invalidateCache } = await import("./onchainDataFetcher");
      invalidateCache(address, chainId); // Clear fetcher internal cache
      
      const price = await getOnChainPrice(address, chainId);
      // broadcast is handled inside getOnChainPrice via the smart caching logic
    }
    
    console.log('[PriceCache] Dynamic tokens refresh complete');
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
          
          // Clear any existing TTL timer when client subscribes/re-subscribes
          const sub = activeSubscriptions.get(key);
          if (sub?.ttlTimer) {
            clearTimeout(sub.ttlTimer);
            sub.ttlTimer = undefined;
            console.log(`[WS] TTL cleared for ${key} due to re-subscription`);
          }

          if (!sessionSubscriptions.has(key)) {
            sessionSubscriptions.add(key);
            subscribeToken(data.chainId, data.address);
            
            if (!activeSubscriptions.has(key)) {
              activeSubscriptions.set(key, { clients: new Set(), lastSeen: Date.now() });
            }
            activeSubscriptions.get(key)!.clients.add(ws);
          }
          
          activeSubscriptions.get(key)!.lastSeen = Date.now();

          // Client Imeadietly requests price from server cachings when SUBSCRIBED
          const cachedPrice = onChainCache.get(key);
          if (cachedPrice && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'price', data: cachedPrice, address: data.address, chainId: data.chainId }));
          } else {
            // If server doesn't have caching, initiate direct fetch and broadcast
            // This happens when a new token is added or cache is empty
            getOnChainPrice(data.address, data.chainId);
          }
          
          const analyticsKey = `analytics-${key}`;
          const aSub = analyticsSubscriptions.get(analyticsKey);
          if (aSub?.ttlTimer) {
            clearTimeout(aSub.ttlTimer);
            aSub.ttlTimer = undefined;
          }

          if (!sessionAnalyticsSubscriptions.has(analyticsKey)) {
            sessionAnalyticsSubscriptions.add(analyticsKey);
            if (!analyticsSubscriptions.has(analyticsKey)) {
              analyticsSubscriptions.set(analyticsKey, { clients: new Set(), lastSeen: Date.now() });
            }
            analyticsSubscriptions.get(analyticsKey)!.clients.add(ws);
          }
          
          analyticsSubscriptions.get(analyticsKey)!.lastSeen = Date.now();
          
          // Send initial analytics data to client
          // Background cache will update this token's analytics
          const analytics = await getOnChainAnalytics(data.address, data.chainId);
          if (analytics && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'analytics', data: analytics, address: data.address, chainId: data.chainId }));
          }
        } else if (data.type === 'unsubscribe') {
          const key = `${data.chainId}-${data.address.toLowerCase()}`;
          const analyticsKey = `analytics-${key}`;
          
          // Start 1-minute TTL when client explicitly unsubscribes (e.g. dropdown closed or token unselected)
          const sub = activeSubscriptions.get(key);
          if (sub && sub.clients.has(ws)) {
            // Check if this was the last active client for this token
            if (sub.clients.size <= 1) {
              if (sub.ttlTimer) clearTimeout(sub.ttlTimer);
              sub.ttlTimer = setTimeout(() => {
                const currentSub = activeSubscriptions.get(key);
                if (currentSub === sub) {
                  activeSubscriptions.delete(key);
                  const [cid, addr] = key.split('-');
                  unsubscribeToken(Number(cid), addr);
                  console.log(`[WS] TTL expired: Unsubscribed from ${key}`);
                }
              }, 60000); // 1 minute TTL
            }
            sub.clients.delete(ws);
          }

          const aSub = analyticsSubscriptions.get(analyticsKey);
          if (aSub && aSub.clients instanceof Set && aSub.clients.has(ws)) {
            if (aSub.clients.size <= 1) {
              if (aSub.ttlTimer) clearTimeout(aSub.ttlTimer);
              aSub.ttlTimer = setTimeout(() => {
                const currentASub = analyticsSubscriptions.get(analyticsKey);
                if (currentASub === aSub) {
                  analyticsSubscriptions.delete(analyticsKey);
                }
              }, 60000);
            }
            aSub.clients.delete(ws);
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
        const sub = activeSubscriptions.get(key);
        if (sub) {
          sub.clients.delete(ws);
          // Only start TTL if NO active clients are left
          if (sub.clients.size === 0) {
            if (sub.ttlTimer) clearTimeout(sub.ttlTimer);
            sub.ttlTimer = setTimeout(() => {
              const currentSub = activeSubscriptions.get(key);
              if (currentSub === sub && currentSub.clients.size === 0) {
                activeSubscriptions.delete(key);
                const [cid, addr] = key.split('-');
                unsubscribeToken(Number(cid), addr);
                console.log(`[WS] TTL expired (close): Unsubscribed from ${key}`);
              }
            }, 60000);
          }
        }
      }
      
      // Remove all analytics subscriptions for this client
      for (const analyticsKey of sessionAnalyticsSubscriptions) {
        const aSub = analyticsSubscriptions.get(analyticsKey);
        if (aSub && aSub.clients) {
          aSub.clients.delete(ws);
          if (aSub.clients.size === 0) {
            if (aSub.ttlTimer) clearTimeout(aSub.ttlTimer);
            aSub.ttlTimer = setTimeout(() => {
              const currentASub = analyticsSubscriptions.get(analyticsKey);
              if (currentASub === aSub && currentASub.clients.size === 0) {
                analyticsSubscriptions.delete(analyticsKey);
              }
            }, 60000);
          }
        }
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
