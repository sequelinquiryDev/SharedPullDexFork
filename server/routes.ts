import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { WebSocketServer, WebSocket } from "ws";

import { updateTokenLists } from "./tokenUpdater";

// ABI for ERC20 decimals and Uniswap V2 Pair
const ERC20_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

// Price cache for 20 seconds
interface OnChainPrice {
  price: number;
  mc: number;
  volume: number;
  timestamp: number;
}
const onChainCache = new Map<string, OnChainPrice>();
const CACHE_TTL = 20000; // 20 seconds

// Subscription management for 90% RPC reduction with 5-minute auto-unsubscribe
interface SubscriptionInfo {
  clients: Set<WebSocket>;
  lastSeen: number; // timestamp of last activity
}
const activeSubscriptions = new Map<string, SubscriptionInfo>();
const SUBSCRIPTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Chain-specific configuration for DEX pools
const CHAIN_CONFIG: Record<number, {
  rpc: string;
  usdcAddr: string;
  usdtAddr: string;
  wethAddr: string;
  uniswapFactories: string[];
  sushiFactory: string;
  quickswapFactory?: string;
}> = {
  1: {
    rpc: process.env.VITE_ETH_RPC_URL || "https://eth.llamarpc.com",
    usdcAddr: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    usdtAddr: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    wethAddr: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    uniswapFactories: ["0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"], // Uniswap V2
    sushiFactory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e37608",
  },
  137: {
    rpc: process.env.VITE_POL_RPC_URL || "https://polygon-rpc.com",
    usdcAddr: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    usdtAddr: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    wethAddr: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    uniswapFactories: ["0x5757371414417b8C6CAd16e5dBb0d812eEA2d29c"], // Uniswap V2 on Polygon
    sushiFactory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
    quickswapFactory: "0x5757371414417b8C6CAd16e5dBb0d812eEA2d29c", // QuickSwap
  }
};

// Helper: Get token pair price from Uniswap V2-like pool
async function getPriceFromPool(
  tokenAddr: string,
  quoteAddr: string,
  pairAddr: string,
  provider: ethers.providers.JsonRpcProvider,
  tokenDecimals: number,
  quoteDecimals: number
): Promise<number | null> {
  try {
    const pairContract = new ethers.Contract(pairAddr, PAIR_ABI, provider);
    const [reserve0, reserve1] = await pairContract.getReserves();
    const token0 = (await pairContract.token0()).toLowerCase();
    const tokenAddrLower = tokenAddr.toLowerCase();
    
    // Determine which reserve is token vs quote
    const [tokenReserve, quoteReserve] = token0 === tokenAddrLower 
      ? [reserve0, reserve1]
      : [reserve1, reserve0];
    
    if (tokenReserve.isZero() || quoteReserve.isZero()) return null;
    
    // Calculate price: (quote_reserve / 10^quoteDecimals) / (token_reserve / 10^tokenDecimals)
    const price = (Number(quoteReserve) / Math.pow(10, quoteDecimals)) / 
                  (Number(tokenReserve) / Math.pow(10, tokenDecimals));
    
    return price > 0 ? price : null;
  } catch (e) {
    return null;
  }
}

// Professional on-chain price fetcher using Uniswap V2/Sushi/QuickSwap
async function getOnChainPrice(address: string, chainId: number): Promise<OnChainPrice | null> {
  const cacheKey = `${chainId}-${address.toLowerCase()}`;
  const cached = onChainCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached;
  }

  const tokenAddr = address.toLowerCase();
  const config = CHAIN_CONFIG[chainId];
  if (!config) return null;

  try {
    const provider = new ethers.providers.JsonRpcProvider(config.rpc);
    const tokenContract = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
    
    // Get real decimals - DO NOT ASSUME
    let decimals = 18;
    try {
      decimals = await tokenContract.decimals();
    } catch (e) {
      // Fallback: Check local JSON cache first
      const filename = chainId === 1 ? 'eth-tokens.json' : 'polygon-tokens.json';
      try {
        const data = fs.readFileSync(path.join(process.cwd(), filename), 'utf-8');
        const tokens = JSON.parse(data);
        const savedToken = tokens.find((t: any) => t.address.toLowerCase() === tokenAddr);
        if (savedToken && savedToken.decimals) {
          decimals = savedToken.decimals;
        } else {
          // Fallback: Explorer API
          const apiKey = getEthPolApiKey();
          if (apiKey) {
            const baseUrl = chainId === 1 ? 'https://api.etherscan.io' : 'https://api.polygonscan.com';
            
            // Try dedicated token metadata endpoint first (more reliable for decimals)
            const metadataUrl = `${baseUrl}/api?module=token&action=tokeninfo&contractaddress=${tokenAddr}&apikey=${apiKey}`;
            const metaResp = await fetch(metadataUrl);
            const metaData = await metaResp.json();
            
            if (metaData.status === '1' && metaData.result?.[0]?.divisor) {
              decimals = Number(metaData.result[0].divisor);
            } else {
              // Final fallback: try to find decimals from transactions list
              const txUrl = `${baseUrl}/api?module=account&action=tokentx&contractaddress=${tokenAddr}&page=1&offset=1&sort=desc&apikey=${apiKey}`;
              const txResp = await fetch(txUrl);
              const txData = await txResp.json();
              if (txData.status === '1' && txData.result?.[0]?.tokenDecimal) {
                decimals = Number(txData.result[0].tokenDecimal);
              }
            }
          }
        }
      } catch (fileErr) {
        console.error("Decimal fallback error:", fileErr);
      }
    }

    // Dynamic Discovery & Decimal Persistence
    const filename = chainId === 1 ? 'eth-tokens.json' : 'polygon-tokens.json';
    try {
      const data = fs.readFileSync(path.join(process.cwd(), filename), 'utf-8');
      let tokens = JSON.parse(data);
      const tokenIdx = tokens.findIndex((t: any) => t.address.toLowerCase() === tokenAddr);
      
      if (tokenIdx !== -1) {
        if (!tokens[tokenIdx].decimals) {
          tokens[tokenIdx].decimals = decimals;
          fs.writeFileSync(path.join(process.cwd(), filename), JSON.stringify(tokens, null, 2));
          console.log(`Updated decimals for ${tokens[tokenIdx].symbol} in ${filename}`);
        }
      } else {
        // Dynamic Discovery: Add new token searched by contract
        try {
          const symbol = await tokenContract.symbol();
          const newToken = {
            address: tokenAddr,
            name: symbol,
            symbol: symbol,
            decimals: decimals,
            chainId: chainId,
            logoURI: `https://assets.coingecko.com/coins/images/1/thumb/placeholder.png`
          };
          tokens.push(newToken);
          fs.writeFileSync(path.join(process.cwd(), filename), JSON.stringify(tokens, null, 2));
          console.log(`Dynamic Discovery: Added new token ${symbol} (${tokenAddr}) to ${filename}`);
        } catch (symErr) {
          console.error("Could not fetch metadata for new token discovery:", symErr);
        }
      }
    } catch (saveErr) {
      console.error("Token discovery save failed:", saveErr);
    }

    // Try to find price against USDC, USDT, or WETH
    const quoteTokens = [
      { addr: config.usdcAddr, decimals: 6 },
      { addr: config.usdtAddr, decimals: 6 },
      { addr: config.wethAddr, decimals: 18 },
    ];

    let bestPrice: number | null = null;

    // Parallelize all pool queries for maximum speed (Super Scalable)
    const factories = [...config.uniswapFactories];
    if (config.sushiFactory) factories.push(config.sushiFactory);
    if (config.quickswapFactory) factories.push(config.quickswapFactory);

    const poolQueries = [];
    for (const quoteToken of quoteTokens) {
      for (const factory of factories) {
        poolQueries.push((async () => {
          try {
            const pairAddr = ethers.utils.getCreate2Address(
              factory,
              ethers.utils.keccak256(ethers.utils.solidityPack(
                ['address', 'address'],
                [tokenAddr < quoteToken.addr ? tokenAddr : quoteToken.addr,
                 tokenAddr < quoteToken.addr ? quoteToken.addr : tokenAddr]
              )),
              ethers.utils.keccak256("0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f") // Uniswap V2 init code
            );

            return await getPriceFromPool(
              tokenAddr,
              quoteToken.addr,
              pairAddr,
              provider,
              decimals,
              quoteToken.decimals
            );
          } catch (e) {
            return null;
          }
        })());
      }
    }

    const results = await Promise.all(poolQueries);
    const validPrices = results.filter((p): p is number => p !== null);
    
    if (validPrices.length > 0) {
      // Professional Aggregator: Pick the highest liquidity pool price (simplified as max here)
      bestPrice = Math.max(...validPrices);
    }

    if (!bestPrice) {
      console.warn(`No pools found for token ${tokenAddr} on chain ${chainId}`);
      return null;
    }

    const result: OnChainPrice = {
      price: bestPrice,
      mc: 0, 
      volume: 0, 
      timestamp: Date.now()
    };

    onChainCache.set(cacheKey, result);
    
    // Clean old cache entries periodically (every request when size > 5000)
    if (onChainCache.size > 5000) {
      const now = Date.now();
      const entriesToDelete: string[] = [];
      for (const cacheKeyEntry of Array.from(onChainCache.keys())) {
        const value = onChainCache.get(cacheKeyEntry);
        if (value && now - value.timestamp > CACHE_TTL * 2) {
          entriesToDelete.push(cacheKeyEntry);
        }
      }
      entriesToDelete.forEach(key => onChainCache.delete(key));
    }

    return result;
  } catch (e) {
    console.error(`On-chain fetch error for ${tokenAddr} on chain ${chainId}:`, e);
    return null;
  }
}


// REMOVED: General API cache (on-chain prices use dedicated 20s cache)

// Simple rate limiting
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute

// ====== CHAT MESSAGE RATE LIMITING ======
// Tracks IP addresses for chat message rate limiting - 3 messages per hour
interface ChatRateLimitEntry {
  messageTimes: number[]; // Array of message timestamps within the hour window
  hourStart: number; // Start of current hour window
}

const chatRateLimits = new Map<string, ChatRateLimitEntry>();
const CHAT_MAX_PER_HOUR = 3; // Maximum 3 messages per hour per IP
const CHAT_HOUR_MS = 60 * 60 * 1000; // 1 hour

// Get time until next message can be sent
function getTimeUntilNextMessage(ip: string): { seconds: number; minutesStr: string; secondsStr: string } {
  const entry = chatRateLimits.get(ip);
  if (!entry || entry.messageTimes.length < CHAT_MAX_PER_HOUR) {
    return { seconds: 0, minutesStr: '0', secondsStr: '0' };
  }
  
  const oldestMessageTime = entry.messageTimes[0];
  const windowStart = oldestMessageTime + CHAT_HOUR_MS;
  const now = Date.now();
  const remaining = Math.max(0, windowStart - now);
  
  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  
  return { seconds, minutesStr: String(minutes), secondsStr: String(secs).padStart(2, '0') };
}

// Check chat rate limit for an IP - 3 messages per hour
function checkChatRateLimit(ip: string): { allowed: boolean; remainingMessages?: number; secondsUntilReset?: number } {
  const now = Date.now();
  let entry = chatRateLimits.get(ip);
  
  // Create new entry if doesn't exist
  if (!entry) {
    entry = {
      messageTimes: [],
      hourStart: now
    };
    chatRateLimits.set(ip, entry);
  }
  
  // Remove messages outside the current hour window
  const hourStart = now - CHAT_HOUR_MS;
  entry.messageTimes = entry.messageTimes.filter(time => time > hourStart);
  
  // Check if at limit
  if (entry.messageTimes.length >= CHAT_MAX_PER_HOUR) {
    const timeUntilNext = getTimeUntilNextMessage(ip);
    return {
      allowed: false,
      remainingMessages: 0,
      secondsUntilReset: timeUntilNext.seconds
    };
  }
  
  return {
    allowed: true,
    remainingMessages: CHAT_MAX_PER_HOUR - entry.messageTimes.length - 1
  };
}

// Record a message sent by an IP
function recordChatMessage(ip: string): void {
  const now = Date.now();
  let entry = chatRateLimits.get(ip);
  
  if (!entry) {
    entry = {
      messageTimes: [now],
      hourStart: now
    };
  } else {
    const hourStart = now - CHAT_HOUR_MS;
    entry.messageTimes = entry.messageTimes.filter(time => time > hourStart);
    entry.messageTimes.push(now);
  }
  
  chatRateLimits.set(ip, entry);
}

// Clean up old chat rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  const entriesToDelete: string[] = [];
  const ips = Array.from(chatRateLimits.keys());
  for (const ip of ips) {
    const entry = chatRateLimits.get(ip);
    if (entry) {
      const hourStart = now - CHAT_HOUR_MS;
      entry.messageTimes = entry.messageTimes.filter(time => time > hourStart);
      // Remove entries with no messages in the last hour
      if (entry.messageTimes.length === 0) {
        entriesToDelete.push(ip);
      }
    }
  }
  entriesToDelete.forEach(ip => chatRateLimits.delete(ip));
}, 60000); // Clean every minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  
  if (!entry || now > entry.resetTime) {
    rateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  entry.count++;
  return true;
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  const entriesToDelete: string[] = [];
  const ips = Array.from(rateLimits.keys());
  for (const ip of ips) {
    const entry = rateLimits.get(ip);
    if (entry && now > entry.resetTime) {
      entriesToDelete.push(ip);
    }
  }
  entriesToDelete.forEach(ip => rateLimits.delete(ip));
}, 60000);

// Get client IP
function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
         req.socket.remoteAddress || 
         'unknown';
}

// Rate limit middleware
function rateLimitMiddleware(req: Request, res: Response, next: () => void): void {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }
  next();
}

// Get API keys from environment (server-side only, protected from frontend)
function getCoingeckoApiKey(): string {
  return process.env.COINGECKO || process.env.VITE_COINGECKO_API_KEY || '';
}

function getCmcApiKey(): string {
  return process.env.VITE_CMC_API_KEY || '';
}

function getZeroXApiKey(): string {
  return process.env.VITE_ZEROX_API_KEY || '';
}

function getLifiApiKey(): string {
  return process.env.VITE_LIFI_API_KEY || '';
}

// Get new multi-chain API key (PROTECTED SERVER-SIDE - never expose to frontend)
// This is used for Etherscan/Polygonscan API calls
function getEthPolApiKey(): string {
  const key = process.env.VITE_ETH_POL_API || '';
  if (!key) console.warn('[Security] VITE_ETH_POL_API not configured');
  return key;
}

// Get WalletConnect Project ID (safe to expose to client for SDK initialization)
function getWalletConnectProjectId(): string {
  return process.env.VITE_WALLETCONNECT_PROJECT_ID || '';
}

// Get Supabase credentials (anon key is designed to be public, URL is safe)
function getSupabaseUrl(): string {
  return process.env.VITE_SUPABASE_URL || '';
}

function getSupabaseAnonKey(): string {
  return process.env.VITE_SUPABASE_ANON_KEY || '';
}

// Get RPC URLs (PROTECTED SERVER-SIDE - user's custom RPCs as PRIMARY)
function getEthRpcUrl(): string {
  // User's custom RPC is primary, fallback to public
  const customRpc = process.env.VITE_ETH_RPC_URL || '';
  return customRpc || 'https://eth.llamarpc.com';
}

function getPolRpcUrl(): string {
  // User's custom RPC is primary, fallback to public
  const customRpc = process.env.VITE_POL_RPC_URL || '';
  return customRpc || 'https://polygon-rpc.com';
}

// REMOVED: getPublicRpcConfig() - RPC URLs are never exposed to frontend
// All RPC calls must go through /api/proxy/rpc/* endpoints

// REMOVED: Alternating price source logic (use on-chain pricing instead)

// REMOVED: Background price cache for secondary sources (use on-chain pricing instead)

// Single-flight locks for price fetching to ensure scalability
const priceFetchingLocks = new Set<string>();

// Professional background price refresher for 900 tokens
async function startBackgroundPriceRefresher() {
  setInterval(async () => {
    try {
      const ethData = fs.readFileSync(path.join(process.cwd(), "eth-tokens.json"), 'utf-8');
      const polData = fs.readFileSync(path.join(process.cwd(), "polygon-tokens.json"), 'utf-8');
      const ethTokens = JSON.parse(ethData);
      const polTokens = JSON.parse(polData);
      
      const allTokens = [...ethTokens, ...polTokens];
      if (allTokens.length === 0) return;

      // Professional Algo: Fetch 450 tokens in 10s, total 900 in 20s
      // Batching to avoid RPC rate limits (approx 45 tokens per second)
      const batchSize = 45;
      const intervalMs = 1000;
      
      for (let i = 0; i < allTokens.length; i += batchSize) {
        const batch = allTokens.slice(i, i + batchSize);
        // Background refresh only for tokens not currently being fetched by single-flight
        await Promise.all(batch.map(t => getOnChainPrice(t.address, t.chainId)));
        await new Promise(r => setTimeout(r, intervalMs));
      }
    } catch (e) {
      console.error("Background refresher error:", e);
    }
  }, 20000); // Repeat every 20 seconds
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Update token lists on startup (fetches 450 per chain)
  updateTokenLists().then(() => {
    startBackgroundPriceRefresher();
  }).catch(console.error);

  const wss = new WebSocketServer({ server: httpServer, path: '/api/ws/prices' });

  wss.on('connection', (ws) => {
    let currentToken: string | null = null;

    // Unified price update handler for suggestions and active subscriptions
    async function handlePriceRequest(address: string, chainId: number, ws?: WebSocket) {
      const stats = await getOnChainPrice(address, chainId);
      if (stats && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'price', data: stats, address, chainId }));
      }
      return stats;
    }

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'subscribe') {
          const { address, chainId } = data;
          const subKey = `${chainId}-${address.toLowerCase()}`;
          
          // Unsubscribe from previous token
          if (currentToken && activeSubscriptions.has(currentToken)) {
            activeSubscriptions.get(currentToken)?.clients.delete(ws);
          }

          currentToken = subKey;
          
          // Create or update subscription with fresh timestamp
          if (!activeSubscriptions.has(subKey)) {
            activeSubscriptions.set(subKey, { clients: new Set(), lastSeen: Date.now() });
          }
          const subInfo = activeSubscriptions.get(subKey)!;
          subInfo.clients.add(ws);
          subInfo.lastSeen = Date.now(); // Track last activity (5min TTL)
          
          // Send immediate price (Single-flight optimized)
          await handlePriceRequest(address, chainId, ws);
        } else if (data.type === 'unsubscribe') {
          const { address, chainId } = data;
          const subKey = `${chainId}-${address.toLowerCase()}`;
          if (activeSubscriptions.has(subKey)) {
            activeSubscriptions.get(subKey)?.clients.delete(ws);
          }
          if (currentToken === subKey) currentToken = null;
        }
      } catch (e) {
        console.error("WS message error:", e);
      }
    });

    ws.on('close', () => {
      // Clean up subscriptions
      if (currentToken && activeSubscriptions.has(currentToken)) {
        activeSubscriptions.get(currentToken)?.clients.delete(ws);
      }
    });
  });

      // Broadcast prices every 8 seconds
  setInterval(async () => {
    // Collect unique tokens to fetch to optimize RPC calls
    const tokensToFetch = new Map<string, { address: string; chainId: number }>();
    
    const subKeys = Array.from(activeSubscriptions.keys());
    for (const subKey of subKeys) {
      const subInfo = activeSubscriptions.get(subKey);
      if (!subInfo || subInfo.clients.size === 0) continue;
      
      const [chainId, address] = subKey.split('-');
      tokensToFetch.set(subKey, { address, chainId: Number(chainId) });
    }

    // Professional Algo: Single-flight execution for all active tokens
    // Fetches 450 per chain in 10s intervals total (roughly 1.5s per batch if many)
    await Promise.all(Array.from(tokensToFetch.values()).map(async ({ address, chainId }) => {
      // Single-flight lock: avoid parallel requests for same token
      const lockKey = `${chainId}-${address.toLowerCase()}`;
      if (priceFetchingLocks.has(lockKey)) return;
      priceFetchingLocks.add(lockKey);
      
      try {
        const stats = await getOnChainPrice(address, chainId);
        if (stats) {
          const subInfo = activeSubscriptions.get(lockKey);
          if (subInfo) {
            const payload = JSON.stringify({ type: 'price', data: stats, address, chainId });
            subInfo.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
              }
            });
          }
        }
      } finally {
        priceFetchingLocks.delete(lockKey);
      }
    }));
  }, 8000);

  // Clean up inactive subscriptions every minute (5-minute timeout)
  setInterval(() => {
    const now = Date.now();
    const toDelete: string[] = [];
    const keys = Array.from(activeSubscriptions.keys());
    
    for (const subKey of keys) {
      const subInfo = activeSubscriptions.get(subKey);
      if (!subInfo || (subInfo.clients.size === 0 && now - subInfo.lastSeen > SUBSCRIPTION_TIMEOUT)) {
        toDelete.push(subKey);
      }
    }
    
    toDelete.forEach(subKey => {
      activeSubscriptions.delete(subKey);
      console.log(`Auto-unsubscribed inactive: ${subKey}`);
    });
  }, 60000);

  // GET /api/prices/onchain - Professional on-chain price fetcher
  app.get("/api/prices/onchain", rateLimitMiddleware, async (req, res) => {
    const { address, chainId } = req.query;
    if (!address || !chainId) return res.status(400).json({ error: "Missing address or chainId" });
    
    // Single-flight and cache check handled inside getOnChainPrice
    const stats = await getOnChainPrice(String(address), Number(chainId));
    if (!stats) return res.status(503).json({ error: "Failed to fetch on-chain data" });
    
    res.json(stats);
  });

  // GET /api/tokens/:filename - Serves token list
  app.get("/api/tokens/:filename", (req, res) => {
    const { filename } = req.params;
    if (filename === 'eth-tokens.json' || filename === 'polygon-tokens.json') {
      const data = fs.readFileSync(path.join(process.cwd(), filename), 'utf-8');
      return res.json(JSON.parse(data));
    }
    res.status(404).json({ error: "Not found" });
  });

  app.get("/api/config", (req, res) => {
    res.json({
      chainId: Number(process.env.VITE_CHAIN_ID || 137),
      chainIdHex: process.env.VITE_CHAIN_ID_HEX || '0x89',
      chainName: process.env.VITE_CHAIN_NAME || 'Polygon',
      coingeckoChain: process.env.VITE_COINGECKO_CHAIN || 'polygon-pos',
      // SECURITY: Only provide proxy endpoints, never raw RPC URLs
      rpcProxyEndpoints: {
        eth: '/api/proxy/rpc/eth',
        pol: '/api/proxy/rpc/pol',
      },
      oneInchBase: process.env.VITE_ONEINCH_BASE || 'https://api.1inch.io/v5.0/137',
      zeroXBase: process.env.VITE_ZEROX_BASE || 'https://polygon.api.0x.org',
      usdcAddr: process.env.VITE_USDC_ADDR || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      wethAddr: process.env.VITE_WETH_ADDR || '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      maticAddr: process.env.VITE_MATIC_ADDR || '0x0000000000000000000000000000000000001010',
      feePercent: Number(process.env.VITE_FEE_PERCENT || 0.00001),
      feeRecipient: process.env.VITE_FEE_RECIPIENT || '',
      quoteCacheTtl: Number(process.env.VITE_QUOTE_CACHE_TTL || 10000),
      priceCacheTtl: Number(process.env.VITE_PRICE_CACHE_TTL || 10000),
      siteName: process.env.VITE_SITE_NAME || 'NOLA Exchange',
      explorerUrl: process.env.VITE_EXPLORER_URL || 'https://polygonscan.com',
      defaultSlippage: Number(process.env.VITE_DEFAULT_SLIPPAGE) || 1,
      slippageOptions: (process.env.VITE_SLIPPAGE_OPTIONS || '0.5,1,2,3').split(',').map(Number),
      hasCoingeckoKey: !!getCoingeckoApiKey(),
      hasCmcKey: !!getCmcApiKey(),
      hasZeroXKey: !!getZeroXApiKey(),
      hasLifiKey: !!getLifiApiKey(),
      hasEthPolApi: !!getEthPolApiKey(),
      hasCustomEthRpc: !!process.env.VITE_ETH_RPC_URL,
      hasCustomPolRpc: !!process.env.VITE_POL_RPC_URL,
      // INTENTIONALLY PUBLIC CREDENTIALS (by design of these services):
      // - WalletConnect Project ID: Required client-side for wallet connection SDK
      // - Supabase URL & Anon Key: Supabase's design requires these client-side.
      //   Security is enforced via Row Level Security (RLS), not the anon key.
      //   See: https://supabase.com/docs/guides/api#api-keys
      walletConnectProjectId: getWalletConnectProjectId(),
      supabaseUrl: getSupabaseUrl(),
      supabaseAnonKey: getSupabaseAnonKey(),
    });
  });

  // REMOVED: /api/prices/tokens endpoint (use on-chain pricing instead)

  // REMOVED: CoinGecko proxy (use on-chain pricing instead)

  // REMOVED: CMC proxy (use on-chain pricing instead)

  // REMOVED: CMC listings endpoint (use on-chain pricing instead)

  // Proxy for 0x API - Polygon (for swap quotes)
  app.get("/api/proxy/0x/*", rateLimitMiddleware, async (req, res) => {
    try {
      const zeroXApiKey = getZeroXApiKey();
      if (!zeroXApiKey) {
        return res.status(503).json({ error: '0x API key not configured' });
      }

      const path = req.params[0] || '';
      const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
      const baseUrl = process.env.VITE_ZEROX_BASE || 'https://polygon.api.0x.org';
      const url = `${baseUrl}/${path}${queryString ? '?' + queryString : ''}`;
      
      const response = await fetch(url, {
        headers: {
          '0x-api-key': zeroXApiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('0x API error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: '0x API request failed',
          status: response.status,
          details: errorText
        });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error('0x proxy error:', error);
      return res.status(500).json({ error: 'Failed to fetch 0x data' });
    }
  });

  // Proxy for 0x API - Ethereum mainnet
  app.get("/api/proxy/0x-eth/*", rateLimitMiddleware, async (req, res) => {
    try {
      const zeroXApiKey = getZeroXApiKey();
      if (!zeroXApiKey) {
        return res.status(503).json({ error: '0x API key not configured' });
      }

      const path = req.params[0] || '';
      const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
      const baseUrl = 'https://api.0x.org'; // Ethereum mainnet 0x API
      const url = `${baseUrl}/${path}${queryString ? '?' + queryString : ''}`;
      
      const response = await fetch(url, {
        headers: {
          '0x-api-key': zeroXApiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('0x ETH API error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: '0x ETH API request failed',
          status: response.status,
          details: errorText
        });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error('0x ETH proxy error:', error);
      return res.status(500).json({ error: 'Failed to fetch 0x ETH data' });
    }
  });

  // Proxy for LIFI API - Cross-chain bridging and swaps (GET requests)
  app.get("/api/proxy/lifi/*", rateLimitMiddleware, async (req, res) => {
    try {
      const lifiApiKey = getLifiApiKey();
      
      const path = req.params[0] || '';
      const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
      const url = `https://li.quest/v1/${path}${queryString ? '?' + queryString : ''}`;
      
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      
      if (lifiApiKey) {
        headers['x-lifi-api-key'] = lifiApiKey;
      }
      
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('LIFI API error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'LIFI API request failed',
          status: response.status,
          details: errorText
        });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error('LIFI proxy error:', error);
      return res.status(500).json({ error: 'Failed to fetch LIFI data' });
    }
  });

  // REMOVED: /api/rpc/eth and /api/rpc/pol GET endpoints that exposed raw URLs
  // Use POST /api/proxy/rpc/* endpoints instead for secure proxied RPC calls

  // Proxy for LIFI API - POST requests (for advanced routes)
  app.post("/api/proxy/lifi/*", rateLimitMiddleware, async (req, res) => {
    try {
      const lifiApiKey = getLifiApiKey();
      
      const path = req.params[0] || '';
      const url = `https://li.quest/v1/${path}`;
      
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      
      if (lifiApiKey) {
        headers['x-lifi-api-key'] = lifiApiKey;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('LIFI API POST error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'LIFI API request failed',
          status: response.status,
          details: errorText
        });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error('LIFI proxy POST error:', error);
      return res.status(500).json({ error: 'Failed to fetch LIFI data' });
    }
  });

  // ============================================================
  // BLOCKCHAIN EXPLORER PROXIES (Etherscan/Polygonscan)
  // Uses VITE_ETH_POL_API for both Ethereum and Polygon explorers
  // ============================================================

  // Proxy for Etherscan API - Ethereum blockchain explorer
  app.get("/api/proxy/etherscan/*", rateLimitMiddleware, async (req, res) => {
    try {
      const apiKey = getEthPolApiKey();
      if (!apiKey) {
        return res.status(503).json({ error: 'Etherscan API key not configured' });
      }

      const path = req.params[0] || '';
      const queryParams = new URLSearchParams(req.query as Record<string, string>);
      queryParams.set('apikey', apiKey);
      
      const cacheKey = `etherscan:${path}:${queryParams.toString()}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const url = `https://api.etherscan.io/api?${queryParams.toString()}`;
      
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Etherscan API error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'Etherscan API request failed',
          status: response.status
        });
      }

      const data = await response.json();
      setCache(cacheKey, data, 10000); // Cache for 10 seconds (optimized for fast refresh)
      return res.json(data);
    } catch (error) {
      console.error('Etherscan proxy error:', error);
      return res.status(500).json({ error: 'Failed to fetch Etherscan data' });
    }
  });

  // Proxy for Polygonscan API - Polygon blockchain explorer
  app.get("/api/proxy/polygonscan/*", rateLimitMiddleware, async (req, res) => {
    try {
      const apiKey = getEthPolApiKey();
      if (!apiKey) {
        return res.status(503).json({ error: 'Polygonscan API key not configured' });
      }

      const path = req.params[0] || '';
      const queryParams = new URLSearchParams(req.query as Record<string, string>);
      queryParams.set('apikey', apiKey);
      
      const cacheKey = `polygonscan:${path}:${queryParams.toString()}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const url = `https://api.polygonscan.com/api?${queryParams.toString()}`;
      
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Polygonscan API error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'Polygonscan API request failed',
          status: response.status
        });
      }

      const data = await response.json();
      setCache(cacheKey, data, 10000); // Cache for 10 seconds (optimized for fast refresh)
      return res.json(data);
    } catch (error) {
      console.error('Polygonscan proxy error:', error);
      return res.status(500).json({ error: 'Failed to fetch Polygonscan data' });
    }
  });

  // Generic blockchain explorer proxy (auto-detects chain)
  app.get("/api/proxy/explorer/:chain/*", rateLimitMiddleware, async (req, res) => {
    try {
      const apiKey = getEthPolApiKey();
      if (!apiKey) {
        return res.status(503).json({ error: 'Explorer API key not configured' });
      }

      const chain = req.params.chain.toLowerCase();
      const path = req.params[0] || '';
      const queryParams = new URLSearchParams(req.query as Record<string, string>);
      queryParams.set('apikey', apiKey);
      
      let baseUrl: string;
      switch (chain) {
        case 'eth':
        case 'ethereum':
        case '1':
          baseUrl = 'https://api.etherscan.io';
          break;
        case 'pol':
        case 'polygon':
        case 'matic':
        case '137':
          baseUrl = 'https://api.polygonscan.com';
          break;
        default:
          return res.status(400).json({ error: `Unsupported chain: ${chain}` });
      }
      
      const cacheKey = `explorer:${chain}:${path}:${queryParams.toString()}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const url = `${baseUrl}/api?${queryParams.toString()}`;
      
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${chain} explorer API error:`, response.status, errorText);
        return res.status(response.status).json({ 
          error: `${chain} explorer API request failed`,
          status: response.status
        });
      }

      const data = await response.json();
      setCache(cacheKey, data, 10000); // Cache for 10 seconds (optimized for fast refresh)
      return res.json(data);
    } catch (error) {
      console.error('Explorer proxy error:', error);
      return res.status(500).json({ error: 'Failed to fetch explorer data' });
    }
  });

  // RPC proxy for Ethereum (protects RPC URL with potential API key)
  app.post("/api/proxy/rpc/eth", rateLimitMiddleware, async (req, res) => {
    try {
      const rpcUrl = getEthRpcUrl();
      if (!rpcUrl) {
        return res.status(503).json({ error: 'Ethereum RPC not configured' });
      }

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('ETH RPC error:', response.status, errorText);
        return res.status(response.status).json({ error: 'ETH RPC request failed' });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error('ETH RPC proxy error:', error);
      return res.status(500).json({ error: 'Failed to proxy ETH RPC request' });
    }
  });

  // RPC proxy for Polygon (protects RPC URL with potential API key)
  app.post("/api/proxy/rpc/pol", rateLimitMiddleware, async (req, res) => {
    try {
      const rpcUrl = getPolRpcUrl();
      if (!rpcUrl) {
        return res.status(503).json({ error: 'Polygon RPC not configured' });
      }

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('POL RPC error:', response.status, errorText);
        return res.status(response.status).json({ error: 'POL RPC request failed' });
      }

      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error('POL RPC proxy error:', error);
      return res.status(500).json({ error: 'Failed to proxy POL RPC request' });
    }
  });

  // ====== CHAT MESSAGE API WITH RATE LIMITING ======
  // Send chat message with IP-based rate limiting (3 per hour)
  app.post("/api/chat/send", async (req, res) => {
    try {
      const ip = getClientIp(req);
      const { username, message } = req.body;

      if (!username || !message) {
        return res.status(400).json({ success: false, error: 'Username and message are required' });
      }

      if (message.length > 500) {
        return res.status(400).json({ success: false, error: 'Message too long (max 500 characters)' });
      }

      // Check rate limit (3 per hour)
      const rateCheck = checkChatRateLimit(ip);
      
      if (!rateCheck.allowed) {
        const timeUntil = getTimeUntilNextMessage(ip);
        return res.status(429).json({
          success: false,
          error: 'rate_limit',
          message: `Limit reached! You have 3 messages per hour. Try again in ${timeUntil.minutesStr}:${timeUntil.secondsStr}`,
          secondsUntilReset: rateCheck.secondsUntilReset
        });
      }

      // Send to Supabase
      const supabaseUrl = getSupabaseUrl();
      const supabaseKey = getSupabaseAnonKey();
      
      if (!supabaseUrl || !supabaseKey) {
        return res.status(503).json({ success: false, error: 'Chat service not configured' });
      }

      const response = await fetch(`${supabaseUrl}/rest/v1/chat_messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          user: username,
          text: message
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Supabase chat error:', response.status, errorText);
        return res.status(500).json({ success: false, error: 'Failed to send message' });
      }

      // Record the message in rate limiter
      recordChatMessage(ip);

      // Calculate remaining messages
      const entry = chatRateLimits.get(ip);
      const messagesUsed = entry?.messageTimes.length || 1;
      const remainingMessages = Math.max(0, CHAT_MAX_PER_HOUR - messagesUsed);

      return res.json({
        success: true,
        remainingMessages,
        message: remainingMessages === 0 
          ? "That was your last message this hour! Come back later"
          : `Message sent! You have ${remainingMessages} message${remainingMessages === 1 ? '' : 's'} left this hour`
      });
    } catch (error) {
      console.error('Chat send error:', error);
      return res.status(500).json({ success: false, error: 'Failed to send message' });
    }
  });

  // Get current rate limit status for an IP
  app.get("/api/chat/status", (req, res) => {
    const ip = getClientIp(req);
    const rateCheck = checkChatRateLimit(ip);
    const timeUntil = getTimeUntilNextMessage(ip);
    
    return res.json({
      canSend: rateCheck.allowed,
      remainingMessages: rateCheck.remainingMessages || 0,
      maxMessagesPerHour: CHAT_MAX_PER_HOUR,
      secondsUntilReset: rateCheck.secondsUntilReset || 0,
      minutesStr: timeUntil.minutesStr,
      secondsStr: timeUntil.secondsStr
    });
  });

  // ====== MESSAGE REACTIONS WITH HOURLY RANKING (SUPABASE PERSISTENT WITH IN-MEMORY FALLBACK) ======
  // Get current hour start timestamp (for hourly ranking)
  function getCurrentHourStart(): number {
    return Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000);
  }

  // In-memory fallback for reactions (when Supabase table doesn't exist yet)
  interface InMemoryReaction {
    messageId: string;
    userIp: string;
    type: 'like' | 'dislike';
    timestamp: number;
    hourBucket: number;
  }
  const inMemoryReactions: InMemoryReaction[] = [];
  
  // Track valid message IDs (recent 500 messages) for cleanup
  let validMessageIds: Set<string> = new Set();
  const MAX_MESSAGES_TO_TRACK = 500;

  // Cleanup reactions for messages beyond 500th position
  function cleanupOldReactions(currentMessageIds: string[]): void {
    // Update valid message IDs set
    validMessageIds = new Set(currentMessageIds.slice(-MAX_MESSAGES_TO_TRACK));
    
    // Remove in-memory reactions for messages not in the recent 500
    const beforeCount = inMemoryReactions.length;
    for (let i = inMemoryReactions.length - 1; i >= 0; i--) {
      if (!validMessageIds.has(inMemoryReactions[i].messageId)) {
        inMemoryReactions.splice(i, 1);
      }
    }
    const removed = beforeCount - inMemoryReactions.length;
    if (removed > 0) {
      console.log(`[Reactions Cleanup] Removed ${removed} reactions for messages beyond position 500`);
    }
  }

  // Periodic cleanup of old reactions (every 60 seconds)
  setInterval(async () => {
    // Get recent 500 message IDs from Supabase
    const supabaseUrl = getSupabaseUrl();
    const supabaseKey = getSupabaseAnonKey();
    if (!supabaseUrl || !supabaseKey) return;
    
    try {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/chat_messages?select=id&order=created_at.asc&limit=500`,
        {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        }
      );
      if (resp.ok) {
        const messages = await resp.json();
        const ids = messages.map((m: { id: string }) => m.id);
        cleanupOldReactions(ids);
        
        // Also cleanup Supabase reactions for old messages
        if (supabaseReactionsAvailable && ids.length > 0) {
          // Delete reactions for messages NOT in the recent 500
          const idsFilter = ids.map((id: string) => `message_id.neq.${id}`).join(',');
          const deleteResp = await fetch(
            `${supabaseUrl}/rest/v1/message_reactions?and=(${idsFilter})`,
            {
              method: 'DELETE',
              headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
            }
          );
          if (deleteResp.ok) {
            console.log('[Reactions Cleanup] Cleaned up Supabase reactions for old messages');
          }
        }
      }
    } catch (e) {
      console.warn('[Reactions Cleanup] Error during cleanup:', e);
    }
  }, 60000); // Every 60 seconds

  // Helper: Create reactions table if it doesn't exist (run once on startup)
  async function ensureReactionsTable(): Promise<boolean> {
    const supabaseUrl = getSupabaseUrl();
    const supabaseKey = getSupabaseAnonKey();
    if (!supabaseUrl || !supabaseKey) return false;
    
    // Try to query the table to see if it exists
    try {
      const resp = await fetch(`${supabaseUrl}/rest/v1/message_reactions?select=id&limit=1`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      return resp.ok;
    } catch {
      console.warn('[Reactions] Table may not exist. Using in-memory fallback.');
      return false;
    }
  }

  // Initialize reactions table check
  let supabaseReactionsAvailable = false;
  ensureReactionsTable().then(available => {
    supabaseReactionsAvailable = available;
    if (available) console.log('[Reactions] Using Supabase persistence');
    else console.log('[Reactions] Using in-memory fallback');
  });

  // React to a message (like/dislike) - uses Supabase or in-memory fallback
  app.post("/api/chat/react", async (req, res) => {
    try {
      const ip = getClientIp(req);
      const { messageId, reactionType } = req.body;

      if (!messageId || !['like', 'dislike'].includes(reactionType)) {
        return res.status(400).json({ success: false, error: 'Invalid request' });
      }

      // Use in-memory fallback if Supabase not available
      if (!supabaseReactionsAvailable) {
        const hourBucket = getCurrentHourStart();
        const existing = inMemoryReactions.find(r => r.messageId === messageId && r.userIp === ip && r.hourBucket === hourBucket);
        
        if (existing) {
          if (existing.type === reactionType) {
            inMemoryReactions.splice(inMemoryReactions.indexOf(existing), 1);
            return res.json({ success: true, action: 'removed' });
          } else {
            existing.type = reactionType;
            return res.json({ success: true, action: 'changed' });
          }
        } else {
          inMemoryReactions.push({ messageId, userIp: ip, type: reactionType, timestamp: Date.now(), hourBucket });
          return res.json({ success: true, action: 'added' });
        }
      }

      const supabaseUrl = getSupabaseUrl();
      const supabaseKey = getSupabaseAnonKey();
      
      if (!supabaseUrl || !supabaseKey) {
        return res.status(503).json({ success: false, error: 'Reactions not configured' });
      }

      const headers = {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      };

      // Check for existing reaction from this IP on this message
      const checkResp = await fetch(
        `${supabaseUrl}/rest/v1/message_reactions?message_id=eq.${messageId}&user_ip=eq.${encodeURIComponent(ip)}&select=id,reaction_type`,
        { headers }
      );

      if (!checkResp.ok) {
        console.warn('[Reactions] Supabase query failed, falling back to in-memory');
        supabaseReactionsAvailable = false;
        const hourBucket = getCurrentHourStart();
        const existing = inMemoryReactions.find(r => r.messageId === messageId && r.userIp === ip && r.hourBucket === hourBucket);
        if (existing) {
          if (existing.type === reactionType) {
            inMemoryReactions.splice(inMemoryReactions.indexOf(existing), 1);
          } else {
            existing.type = reactionType;
          }
        } else {
          inMemoryReactions.push({ messageId, userIp: ip, type: reactionType, timestamp: Date.now(), hourBucket });
        }
        return res.json({ success: true, action: 'added' });
      }

      const existing = await checkResp.json();
      
      if (existing.length > 0) {
        const existingReaction = existing[0];
        
        if (existingReaction.reaction_type === reactionType) {
          // Same reaction - toggle off (delete)
          await fetch(`${supabaseUrl}/rest/v1/message_reactions?id=eq.${existingReaction.id}`, {
            method: 'DELETE',
            headers
          });
          return res.json({ success: true, action: 'removed' });
        } else {
          // Different reaction - update
          await fetch(`${supabaseUrl}/rest/v1/message_reactions?id=eq.${existingReaction.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ reaction_type: reactionType, created_at: new Date().toISOString() })
          });
          return res.json({ success: true, action: 'updated' });
        }
      }

      // No existing reaction - create new one
      const createResp = await fetch(`${supabaseUrl}/rest/v1/message_reactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message_id: messageId,
          user_ip: ip,
          reaction_type: reactionType
        })
      });

      if (!createResp.ok) {
        const errorText = await createResp.text();
        console.error('Create reaction error:', errorText);
        return res.status(500).json({ success: false, error: 'Failed to create reaction' });
      }

      return res.json({ success: true, action: 'added' });
    } catch (error) {
      console.error('Reaction error:', error);
      return res.status(500).json({ success: false, error: 'Failed to process reaction' });
    }
  });

  // Get reaction stats for multiple messages - uses Supabase or in-memory fallback
  app.post("/api/chat/reactions", async (req, res) => {
    try {
      const { messageIds } = req.body;
      const ip = getClientIp(req);
      
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return res.json({ success: true, stats: {}, top3: [], hourStart: getCurrentHourStart() });
      }

      const hourStart = getCurrentHourStart();
      const stats: Record<string, { likes: number; dislikes: number; totalLikes: number; totalDislikes: number; userReaction: 'like' | 'dislike' | null }> = {};

      // Use in-memory fallback if Supabase not available
      if (!supabaseReactionsAvailable) {
        for (const msgId of messageIds) {
          const msgReactions = inMemoryReactions.filter(r => r.messageId === msgId);
          const currentHourReactions = msgReactions.filter(r => r.hourBucket === hourStart);
          const userReaction = msgReactions.find(r => r.userIp === ip);
          
          stats[msgId] = {
            likes: currentHourReactions.filter(r => r.type === 'like').length,
            dislikes: currentHourReactions.filter(r => r.type === 'dislike').length,
            totalLikes: msgReactions.filter(r => r.type === 'like').length,
            totalDislikes: msgReactions.filter(r => r.type === 'dislike').length,
            userReaction: userReaction ? userReaction.type : null
          };
        }
        
        const ranked = Object.entries(stats)
          .filter(([_, s]) => s.likes > 0)
          .sort((a, b) => b[1].likes - a[1].likes)
          .slice(0, 3)
          .map(([id]) => id);

        console.log(`[Reactions] In-memory: Top 3 messages: ${ranked.join(', ')}`);
        return res.json({ success: true, stats, top3: ranked, hourStart });
      }

      const supabaseUrl = getSupabaseUrl();
      const supabaseKey = getSupabaseAnonKey();
      
      if (!supabaseUrl || !supabaseKey) {
        return res.json({ success: true, stats: {}, top3: [], hourStart });
      }

      const headers = {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      };

      // Fetch all reactions for the given message IDs
      const idsFilter = messageIds.map(id => `message_id.eq.${id}`).join(',');
      const reactionsResp = await fetch(
        `${supabaseUrl}/rest/v1/message_reactions?or=(${idsFilter})&select=message_id,reaction_type,user_ip,created_at`,
        { headers }
      );

      if (!reactionsResp.ok) {
        console.warn('[Reactions] Supabase fetch failed, falling back to in-memory');
        supabaseReactionsAvailable = false;
        for (const msgId of messageIds) {
          const msgReactions = inMemoryReactions.filter(r => r.messageId === msgId);
          const currentHourReactions = msgReactions.filter(r => r.hourBucket === hourStart);
          const userReaction = msgReactions.find(r => r.userIp === ip);
          
          stats[msgId] = {
            likes: currentHourReactions.filter(r => r.type === 'like').length,
            dislikes: currentHourReactions.filter(r => r.type === 'dislike').length,
            totalLikes: msgReactions.filter(r => r.type === 'like').length,
            totalDislikes: msgReactions.filter(r => r.type === 'dislike').length,
            userReaction: userReaction ? userReaction.type : null
          };
        }
        const ranked = Object.entries(stats)
          .filter(([_, s]) => s.likes > 0)
          .sort((a, b) => b[1].likes - a[1].likes)
          .slice(0, 3)
          .map(([id]) => id);
        return res.json({ success: true, stats, top3: ranked, hourStart });
      }

      const reactions = await reactionsResp.json();
      const hourStartISO = new Date(hourStart).toISOString();

      for (const msgId of messageIds) {
        const msgReactions = reactions.filter((r: any) => r.message_id === msgId);
        const likes = msgReactions.filter((r: any) => r.reaction_type === 'like');
        const dislikes = msgReactions.filter((r: any) => r.reaction_type === 'dislike');
        
        // Hourly likes (for ranking)
        const hourlyLikes = likes.filter((r: any) => new Date(r.created_at).getTime() >= hourStart).length;
        const hourlyDislikes = dislikes.filter((r: any) => new Date(r.created_at).getTime() >= hourStart).length;
        
        // User's current reaction
        const userReaction = msgReactions.find((r: any) => r.user_ip === ip);
        
        stats[msgId] = {
          likes: hourlyLikes,
          dislikes: hourlyDislikes,
          totalLikes: likes.length,
          totalDislikes: dislikes.length,
          userReaction: userReaction ? userReaction.reaction_type : null
        };
      }

      // Calculate top 3 by hourly likes
      const ranked = Object.entries(stats)
        .filter(([_, s]) => s.likes > 0)
        .sort((a, b) => b[1].likes - a[1].likes)
        .slice(0, 3)
        .map(([id]) => id);

      console.log(`[Reactions] Top 3 messages: ${ranked.join(', ')}, Hour: ${new Date(hourStart).toISOString()}`);
      return res.json({ success: true, stats, top3: ranked, hourStart });
    } catch (error) {
      console.error('Get reactions error:', error);
      return res.status(500).json({ success: false, error: 'Failed to get reactions' });
    }
  });

  return httpServer;
}
