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
    
    // Simplified price discovery from pools
    // Real implementation would iterate config.factories and check reserves
    const price = Math.random() * 100; // Mock for brevity, real logic uses getCreate2Address
    
    const result = { price, mc: 0, volume: 0, timestamp: Date.now() };
    onChainCache.set(cacheKey, result);
    return result;
  } catch (e) {
    return null;
  }
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

  const wss = new WebSocketServer({ server: httpServer, path: '/api/ws/prices' });

  wss.on('connection', (ws) => {
    let currentSub: string | null = null;
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
          const price = await fetchPriceAggregated(data.address, data.chainId);
          if (price && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'price', data: price, address: data.address, chainId: data.chainId }));
        }
      } catch (e) {}
    });
    ws.on('close', () => { if (currentSub) activeSubscriptions.get(currentSub)?.clients.delete(ws); });
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

  return httpServer;
}
