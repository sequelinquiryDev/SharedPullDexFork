/**
 * Intelligent Pool Cache Manager
 * - Caches the most reliable DEX pool for each token
 * - Reduces unnecessary pool lookups across multiple DEX factories
 * - Prioritizes Uniswap V2/V3 and SushiSwap, falls back to QuickSwap
 */

interface PoolCacheEntry {
  poolAddress: string;
  factoryIndex: number; // Index in factories array for quick reference
  dexName: string;
  fee?: number; // For V3 pools
  lastUsed: number;
  hitCount: number; // Track how many times this pool has been used
}

const poolCache = new Map<string, PoolCacheEntry>();
const POOL_CACHE_PERSISTENCE_FILE = '.pool-cache.json';

/**
 * Get cached pool for a token pair
 * Returns null if no cached pool exists
 */
export function getCachedPool(
  tokenAddr: string,
  stableAddr: string,
  chainId: number
): PoolCacheEntry | null {
  const key = `${chainId}-${tokenAddr.toLowerCase()}-${stableAddr.toLowerCase()}`;
  const cached = poolCache.get(key);
  
  if (cached) {
    // Update hit count and last used timestamp
    cached.hitCount++;
    cached.lastUsed = Date.now();
    return cached;
  }
  
  return null;
}

/**
 * Cache a discovered pool for future use
 * Returns the stored entry
 */
export function cachePool(
  tokenAddr: string,
  stableAddr: string,
  chainId: number,
  poolAddress: string,
  factoryIndex: number,
  dexName: string,
  fee?: number
): PoolCacheEntry {
  const key = `${chainId}-${tokenAddr.toLowerCase()}-${stableAddr.toLowerCase()}`;
  
  const entry: PoolCacheEntry = {
    poolAddress,
    factoryIndex,
    dexName,
    fee,
    lastUsed: Date.now(),
    hitCount: 0,
  };
  
  poolCache.set(key, entry);
  console.log(`[PoolCache] Cached pool for ${dexName}: ${key} => ${poolAddress}`);
  
  return entry;
}

/**
 * Check if a pool lookup was recently cached
 * Used to skip future factory iterations
 */
export function isPoolCacheHot(
  tokenAddr: string,
  stableAddr: string,
  chainId: number
): boolean {
  const key = `${chainId}-${tokenAddr.toLowerCase()}-${stableAddr.toLowerCase()}`;
  const cached = poolCache.get(key);
  
  if (!cached) return false;
  
  // Consider cache "hot" if it's been used in the last 5 minutes
  const hotThreshold = 5 * 60 * 1000;
  return Date.now() - cached.lastUsed < hotThreshold;
}

/**
 * Get cache statistics
 */
export function getPoolCacheStats() {
  let totalHits = 0;
  let hotEntries = 0;
  
  poolCache.forEach((entry) => {
    totalHits += entry.hitCount;
    if (Date.now() - entry.lastUsed < 5 * 60 * 1000) {
      hotEntries++;
    }
  });
  
  return {
    totalCachedPools: poolCache.size,
    totalHits,
    hotEntries,
    averageHitsPerPool: poolCache.size > 0 ? totalHits / poolCache.size : 0,
  };
}

/**
 * Clear old pool cache entries (older than 24 hours)
 */
export function cleanupOldPoolCache() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  let removed = 0;
  
  poolCache.forEach((entry, key) => {
    if (now - entry.lastUsed > maxAge) {
      poolCache.delete(key);
      removed++;
    }
  });
  
  if (removed > 0) {
    console.log(`[PoolCache] Cleaned up ${removed} old pool entries`);
  }
}

/**
 * Get factory priority for DEX selection
 * Returns indices in order of preference
 */
export function getFactoryPriority(chainId: number): {
  primary: number[];   // Uniswap V2/V3, SushiSwap
  fallback: number[];  // Other DEXes (QuickSwap, ApeSwap, etc.)
} {
  // This will be specific to each chain
  // For Ethereum: V2 (0), SushiSwap (1), then others
  // For Polygon: QuickSwap (0), SushiSwap (1), then others
  
  if (chainId === 1) {
    return {
      primary: [0, 1], // Uniswap V2 (0), SushiSwap (1)
      fallback: [2, 3, 4, 5, 6, 7], // Others
    };
  } else if (chainId === 137) {
    return {
      primary: [0, 1], // QuickSwap (0), SushiSwap (1)
      fallback: [2, 3, 4, 5, 6, 7], // Others
    };
  }
  
  return { primary: [], fallback: [] };
}

// CRITICAL FIX: Run cleanup more frequently (every 1 hour instead of 6 hours)
// This ensures stale pools are removed faster after updates
setInterval(() => {
  cleanupOldPoolCache();
}, 60 * 60 * 1000); // 1 hour

/**
 * Clear entire pool cache immediately
 * IMPORTANT: Call this when you change pool addresses or after server updates
 */
export function clearAllPoolCache() {
  const count = poolCache.size;
  poolCache.clear();
  console.log(`[PoolCache] CLEARED entire pool cache (${count} entries removed)`);
}

/**
 * Clear cache for specific token pair
 * Useful when a pool becomes inactive
 */
export function clearPoolCacheFor(tokenAddr: string, stableAddr: string, chainId: number) {
  const key = `${chainId}-${tokenAddr.toLowerCase()}-${stableAddr.toLowerCase()}`;
  if (poolCache.has(key)) {
    poolCache.delete(key);
    console.log(`[PoolCache] Cleared specific pool cache for ${key}`);
  }
}
