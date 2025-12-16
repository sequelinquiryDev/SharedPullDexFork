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
function getEthPolApiKey(): string {
  const key = process.env.VITE_ETH_POL_API || '';
  if (!key) console.warn('[Security] VITE_ETH_POL_API not configured');
  return key;
}

// Get RPC URLs (PROTECTED SERVER-SIDE - never expose to frontend)
function getEthRpcUrl(): string {
  const url = process.env.VITE_ETH_RPC_URL || 'https://eth.llamarpc.com';
  return url;
}

function getPolRpcUrl(): string {
  const url = process.env.VITE_POL_RPC_URL || 'https://polygon-rpc.com';
  return url;
}

// SECURITY: Endpoint to get RPC URLs safely (never expose API keys)
function getPublicRpcConfig() {
  return {
    ethRpc: getEthRpcUrl(),
    polRpc: getPolRpcUrl(),
  };
}

// Alternating source for token prices
let lastPriceSource: 'cmc' | 'coingecko' = 'cmc';

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // GET /api/config - Returns public configuration (no secrets)
  app.get("/api/config", (req, res) => {
    res.json({
      chainId: Number(process.env.VITE_CHAIN_ID || 137),
      chainIdHex: process.env.VITE_CHAIN_ID_HEX || '0x89',
      chainName: process.env.VITE_CHAIN_NAME || 'Polygon',
      coingeckoChain: process.env.VITE_COINGECKO_CHAIN || 'polygon-pos',
      rpcUrls: [
        process.env.VITE_RPC_URL_1 || 'https://polygon-rpc.com',
        process.env.VITE_RPC_URL_2 || 'https://rpc-mainnet.maticvigil.com',
      ],
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
      rpcConfig: getPublicRpcConfig(),
    });
  });

  // GET /api/prices/tokens - Proxies token data with alternating sources
  app.get("/api/prices/tokens", rateLimitMiddleware, async (req, res) => {
    try {
      const cacheKey = 'prices_tokens';
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      // Alternate between CMC and CoinGecko
      lastPriceSource = lastPriceSource === 'cmc' ? 'coingecko' : 'cmc';
      
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
            { headers }
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
      
      const result = { data, source };
      setCache(cacheKey, result, 30000); // Cache for 30 seconds
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

  // GET /api/rpc/eth - Protected server-side RPC endpoint for Ethereum
  app.get("/api/rpc/eth", rateLimitMiddleware, (req, res) => {
    const rpcUrl = getEthRpcUrl();
    if (!rpcUrl) {
      return res.status(503).json({ error: 'Ethereum RPC not configured' });
    }
    res.json({ rpcUrl });
  });

  // GET /api/rpc/pol - Protected server-side RPC endpoint for Polygon
  app.get("/api/rpc/pol", rateLimitMiddleware, (req, res) => {
    const rpcUrl = getPolRpcUrl();
    if (!rpcUrl) {
      return res.status(503).json({ error: 'Polygon RPC not configured' });
    }
    res.json({ rpcUrl });
  });

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

  return httpServer;
}
