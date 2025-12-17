import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

// In-memory cache for API responses
interface CacheEntry {
  data: unknown;
  timestamp: number;
  ttl: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown, ttl: number): void {
  cache.set(key, { data, timestamp: Date.now(), ttl });
}

// Simple rate limiting
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute

// ====== CHAT MESSAGE RATE LIMITING ======
// Tracks IP addresses for chat message rate limiting
interface ChatRateLimitEntry {
  dailyCount: number;
  lastMessageTime: number;
  dayStartTime: number;
}

const chatRateLimits = new Map<string, ChatRateLimitEntry>();
const CHAT_MAX_PER_DAY = 3; // Maximum 3 messages per day per IP
const CHAT_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes between messages

// Get the start of the current "day" at 12:00 GMT
function getChatDayStart(): number {
  const now = new Date();
  const today12GMT = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0, 0
  ));
  
  // If current time is before 12:00 GMT today, the day started yesterday at 12:00 GMT
  if (now.getTime() < today12GMT.getTime()) {
    return today12GMT.getTime() - 24 * 60 * 60 * 1000;
  }
  return today12GMT.getTime();
}

// Get time until next 12:00 GMT reset
function getTimeUntilReset(): { hours: number; minutes: number } {
  const now = Date.now();
  const dayStart = getChatDayStart();
  const nextReset = dayStart + 24 * 60 * 60 * 1000;
  const remaining = nextReset - now;
  
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  
  return { hours, minutes };
}

// Check chat rate limit for an IP
function checkChatRateLimit(ip: string): { allowed: boolean; reason?: string; remainingMessages?: number; cooldownSeconds?: number } {
  const now = Date.now();
  const dayStart = getChatDayStart();
  
  let entry = chatRateLimits.get(ip);
  
  // If no entry or day has changed, reset the daily count
  if (!entry || entry.dayStartTime !== dayStart) {
    entry = {
      dailyCount: 0,
      lastMessageTime: 0,
      dayStartTime: dayStart
    };
    chatRateLimits.set(ip, entry);
  }
  
  // Check 3-minute cooldown
  const timeSinceLastMessage = now - entry.lastMessageTime;
  if (entry.lastMessageTime > 0 && timeSinceLastMessage < CHAT_COOLDOWN_MS) {
    const remainingCooldown = Math.ceil((CHAT_COOLDOWN_MS - timeSinceLastMessage) / 1000);
    return {
      allowed: false,
      reason: 'cooldown',
      cooldownSeconds: remainingCooldown
    };
  }
  
  // Check daily limit
  if (entry.dailyCount >= CHAT_MAX_PER_DAY) {
    const { hours, minutes } = getTimeUntilReset();
    return {
      allowed: false,
      reason: 'daily_limit',
      remainingMessages: 0
    };
  }
  
  return {
    allowed: true,
    remainingMessages: CHAT_MAX_PER_DAY - entry.dailyCount - 1
  };
}

// Record a message sent by an IP
function recordChatMessage(ip: string): void {
  const now = Date.now();
  const dayStart = getChatDayStart();
  
  let entry = chatRateLimits.get(ip);
  
  if (!entry || entry.dayStartTime !== dayStart) {
    entry = {
      dailyCount: 1,
      lastMessageTime: now,
      dayStartTime: dayStart
    };
  } else {
    entry.dailyCount++;
    entry.lastMessageTime = now;
  }
  
  chatRateLimits.set(ip, entry);
}

// Clean up old chat rate limit entries periodically
setInterval(() => {
  const dayStart = getChatDayStart();
  const entriesToDelete: string[] = [];
  for (const [ip, entry] of chatRateLimits.entries()) {
    // Remove entries from previous days
    if (entry.dayStartTime !== dayStart) {
      entriesToDelete.push(ip);
    }
  }
  entriesToDelete.forEach(ip => chatRateLimits.delete(ip));
}, 60000 * 10); // Clean every 10 minutes

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
  for (const [ip, entry] of rateLimits.entries()) {
    if (now > entry.resetTime) {
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

// Alternating source for token prices (2-minute sequence)
let lastPriceSource: 'cmc' | 'coingecko' = 'cmc';
let lastSourceSwitch = Date.now();
const SOURCE_SWITCH_INTERVAL = 2 * 60 * 1000; // 2 minutes

// Background price cache for secondary sources
interface BackgroundPrice {
  price: number;
  source: string;
  timestamp: number;
}
const backgroundPriceCache = new Map<string, BackgroundPrice>();

// Non-blocking background fetch from secondary sources
function fetchBackgroundSecondaryPrices(tokenAddresses: string[]): void {
  if (!tokenAddresses.length) return;
  
  // Fire and forget - don't block the response
  setImmediate(async () => {
    for (const addr of tokenAddresses.slice(0, 20)) { // Limit to 20 per batch
      try {
        // Try 0x (fastest for DEX prices)
        const zeroXKey = getZeroXApiKey();
        if (zeroXKey) {
          const resp = await fetch(
            `https://polygon.api.0x.org/swap/v1/price?sellToken=${addr}&buyToken=${process.env.VITE_USDC_ADDR || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'}&sellAmount=1`,
            { 
              headers: { '0x-api-key': zeroXKey },
              signal: AbortSignal.timeout(2000)
            }
          ).catch(() => null);
          
          if (resp?.ok) {
            const data = await resp.json();
            if (data.price) {
              const price = Number(data.price);
              if (price > 0) {
                backgroundPriceCache.set(`0x:${addr}`, { price, source: '0x', timestamp: Date.now() });
              }
            }
          }
        }
        
        // Try DexScreener (reliable for any token)
        const dexResp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, {
          signal: AbortSignal.timeout(2000)
        }).catch(() => null);
        
        if (dexResp?.ok) {
          const data = await dexResp.json();
          const pairs = data?.pairs || [];
          if (pairs[0]?.priceUsd) {
            const price = Number(pairs[0].priceUsd);
            if (price > 0) {
              backgroundPriceCache.set(`dex:${addr}`, { price, source: 'dexscreener', timestamp: Date.now() });
            }
          }
        }
      } catch (e) {
        // Silent fail - background operation
      }
    }
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // GET /api/config - Returns public configuration (secrets protected server-side)
  // SECURITY: No RPC URLs are exposed - all RPC calls must go through /api/proxy/rpc/*
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

  // GET /api/prices/tokens - Proxies token data with 2-min sequence alternation + background loading
  app.get("/api/prices/tokens", rateLimitMiddleware, async (req, res) => {
    try {
      const cacheKey = 'prices_tokens';
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      // 2-minute sequence alternation
      const now = Date.now();
      if (now - lastSourceSwitch >= SOURCE_SWITCH_INTERVAL) {
        lastPriceSource = lastPriceSource === 'cmc' ? 'coingecko' : 'cmc';
        lastSourceSwitch = now;
        console.log(`[2-min sequence] Switched to: ${lastPriceSource}`);
      }
      
      let data: unknown = null;
      let source = lastPriceSource;
      
      // Try primary source first
      if (source === 'cmc' && getCmcApiKey()) {
        try {
          const response = await fetch(
            'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=100&convert=USD',
            {
              headers: {
                'X-CMC_PRO_API_KEY': getCmcApiKey(),
                'Accept': 'application/json',
              },
              signal: AbortSignal.timeout(5000)
            }
          );
          if (response.ok) {
            data = await response.json();
          }
        } catch (e) {
          console.error('CMC fetch error:', e);
        }
      }
      
      // Fallback to CoinGecko if CMC fails or no key
      if (!data && getCoingeckoApiKey()) {
        try {
          const headers: Record<string, string> = { 'Accept': 'application/json' };
          const apiKey = getCoingeckoApiKey();
          if (apiKey) {
            headers['x-cg-demo-api-key'] = apiKey;
          }
          const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1`,
            { 
              headers,
              signal: AbortSignal.timeout(5000)
            }
          );
          if (response.ok) {
            data = await response.json();
            source = 'coingecko';
          }
        } catch (e) {
          console.error('CoinGecko fetch error:', e);
        }
      }
      
      // Try CMC as last resort if we tried CoinGecko first
      if (!data && source === 'coingecko' && getCmcApiKey()) {
        try {
          const response = await fetch(
            'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=100&convert=USD',
            {
              headers: {
                'X-CMC_PRO_API_KEY': getCmcApiKey(),
                'Accept': 'application/json',
              },
              signal: AbortSignal.timeout(5000)
            }
          );
          if (response.ok) {
            data = await response.json();
            source = 'cmc';
          }
        } catch (e) {
          console.error('CMC fallback fetch error:', e);
        }
      }
      
      if (!data) {
        return res.status(503).json({ error: 'Unable to fetch price data from any source' });
      }
      
      // Extract token addresses for background price loading
      const tokenAddresses = Array.isArray(data) 
        ? data.slice(0, 20).map((t: any) => t.contract_address || t.id).filter(Boolean)
        : [];
      
      // Non-blocking background fetch from secondary sources
      if (tokenAddresses.length) {
        fetchBackgroundSecondaryPrices(tokenAddresses);
      }
      
      const result = { data, source, cached: false };
      setCache(cacheKey, result, 120000); // Cache for 2 minutes (matches sequence)
      return res.json(result);
    } catch (error) {
      console.error('Price tokens error:', error);
      return res.status(500).json({ error: 'Failed to fetch token prices' });
    }
  });

  // Proxy: /api/prices/coingecko/* -> CoinGecko API
  app.get("/api/prices/coingecko/*", rateLimitMiddleware, async (req, res) => {
    try {
      const apiKey = getCoingeckoApiKey();
      if (!apiKey) {
        return res.status(503).json({ error: 'CoinGecko API key not configured' });
      }

      const path = req.params[0] || '';
      const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
      const cacheKey = `coingecko:${path}:${queryString}`;
      
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const url = `https://api.coingecko.com/api/v3/${path}${queryString ? '?' + queryString : ''}`;
      
      const response = await fetch(url, {
        headers: {
          'x-cg-demo-api-key': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('CoinGecko API error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'CoinGecko API request failed',
          status: response.status 
        });
      }

      const data = await response.json();
      setCache(cacheKey, data, 30000); // Cache for 30 seconds
      return res.json(data);
    } catch (error) {
      console.error('CoinGecko proxy error:', error);
      return res.status(500).json({ error: 'Failed to fetch CoinGecko data' });
    }
  });

  // Proxy: /api/prices/cmc/* -> CoinMarketCap API
  app.get("/api/prices/cmc/*", rateLimitMiddleware, async (req, res) => {
    try {
      const cmcApiKey = getCmcApiKey();
      if (!cmcApiKey) {
        return res.status(503).json({ error: 'CMC API key not configured' });
      }

      const path = req.params[0] || '';
      const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
      const cacheKey = `cmc:${path}:${queryString}`;
      
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const url = `https://pro-api.coinmarketcap.com/${path}${queryString ? '?' + queryString : ''}`;
      
      const response = await fetch(url, {
        headers: {
          'X-CMC_PRO_API_KEY': cmcApiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('CMC API error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'CMC API request failed',
          status: response.status 
        });
      }

      const data = await response.json();
      setCache(cacheKey, data, 30000); // Cache for 30 seconds
      return res.json(data);
    } catch (error) {
      console.error('CMC proxy error:', error);
      return res.status(500).json({ error: 'Failed to fetch CMC data' });
    }
  });

  // Keep existing CMC listings endpoint for backward compatibility
  app.get("/api/cmc/listings", rateLimitMiddleware, async (req, res) => {
    try {
      const cmcApiKey = getCmcApiKey();
      
      if (!cmcApiKey) {
        return res.status(503).json({ 
          error: "CMC API key not configured" 
        });
      }

      const cacheKey = `cmc_listings:${req.query.limit || 250}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const limit = req.query.limit || 250;
      const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=${limit}&convert=USD`;
      
      const response = await fetch(url, {
        headers: {
          'X-CMC_PRO_API_KEY': cmcApiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('CMC API error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: "CMC API request failed",
          status: response.status 
        });
      }

      const data = await response.json();
      setCache(cacheKey, data, 60000); // Cache for 1 minute
      return res.json(data);
    } catch (error) {
      console.error('CMC proxy error:', error);
      return res.status(500).json({ 
        error: "Failed to fetch CMC data" 
      });
    }
  });

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
      setCache(cacheKey, data, 30000); // Cache for 30 seconds
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
      setCache(cacheKey, data, 30000); // Cache for 30 seconds
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
      setCache(cacheKey, data, 30000); // Cache for 30 seconds
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
  // Send chat message with IP-based rate limiting
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

      // Check rate limit
      const rateCheck = checkChatRateLimit(ip);
      
      if (!rateCheck.allowed) {
        if (rateCheck.reason === 'cooldown') {
          const minutes = Math.floor((rateCheck.cooldownSeconds || 0) / 60);
          const seconds = (rateCheck.cooldownSeconds || 0) % 60;
          const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
          return res.status(429).json({
            success: false,
            error: 'rate_limit',
            reason: 'cooldown',
            message: `Take a breather! You can send another message in ${timeStr}`,
            cooldownSeconds: rateCheck.cooldownSeconds
          });
        } else {
          // Daily limit or unknown reason - block the message
          const { hours, minutes } = getTimeUntilReset();
          return res.status(429).json({
            success: false,
            error: 'rate_limit',
            reason: 'daily_limit',
            message: `You've reached your daily message limit! Come back in ${hours}h ${minutes}m when the new day starts at 12:00 GMT`,
            hoursUntilReset: hours,
            minutesUntilReset: minutes
          });
        }
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

      // Calculate remaining messages correctly (messages left AFTER this send)
      const dayStart = getChatDayStart();
      const entry = chatRateLimits.get(ip);
      const messagesUsed = entry?.dailyCount || 1;
      const remainingMessages = Math.max(0, CHAT_MAX_PER_DAY - messagesUsed);

      return res.json({
        success: true,
        remainingMessages,
        message: remainingMessages === 0 
          ? "That was your last message for today! See you tomorrow at 12:00 GMT"
          : `Message sent! You have ${remainingMessages} message${remainingMessages === 1 ? '' : 's'} left today`
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
    const { hours, minutes } = getTimeUntilReset();
    
    // Get entry directly for cooldown info
    const dayStart = getChatDayStart();
    const entry = chatRateLimits.get(ip);
    let cooldownSeconds = 0;
    
    if (entry && entry.dayStartTime === dayStart && entry.lastMessageTime > 0) {
      const timeSinceLastMessage = Date.now() - entry.lastMessageTime;
      if (timeSinceLastMessage < CHAT_COOLDOWN_MS) {
        cooldownSeconds = Math.ceil((CHAT_COOLDOWN_MS - timeSinceLastMessage) / 1000);
      }
    }
    
    return res.json({
      canSend: rateCheck.allowed,
      remainingMessages: rateCheck.allowed ? (rateCheck.remainingMessages !== undefined ? rateCheck.remainingMessages + 1 : CHAT_MAX_PER_DAY) : 0,
      maxMessagesPerDay: CHAT_MAX_PER_DAY,
      cooldownSeconds,
      cooldownMinutes: 3,
      hoursUntilReset: hours,
      minutesUntilReset: minutes,
      resetTime: '12:00 GMT'
    });
  });

  return httpServer;
}
