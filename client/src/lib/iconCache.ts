/**
 * Unified Icon Cache Manager
 * 
 * This module provides a centralized icon caching system that:
 * - Prevents race conditions with request versioning
 * - Shares cache across all components (TokenSearchBar, TokenInput, tokenService)
 * - Implements request cancellation for stale fetches
 * - Reduces cache-busting URL churn
 * - Ensures consistent fallback behavior
 */

interface IconCacheEntry {
  url: string;
  version: number;
  expires: number;
}

interface PendingRequest {
  controller: AbortController;
  promise: Promise<string>;
  version: number;
}

class IconCacheManager {
  private cache = new Map<string, IconCacheEntry>();
  private pendingRequests = new Map<string, PendingRequest>();
  private requestVersion = 0;
  private readonly CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly DAILY_MS = 24 * 60 * 60 * 1000; // 1 day in milliseconds
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour in milliseconds
  private readonly PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNCIgY3k9IjE0IiByPSIxNCIgZmlsbD0iIzJBMkEzQSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjODg4IiBmb250LXNpemU9IjEyIj4/PC90ZXh0Pjwvc3ZnPg==';

  /**
   * Get cache key for a token
   */
  private getCacheKey(address: string, chainId: number): string {
    return `${chainId}-${address.toLowerCase()}`;
  }

  /**
   * Get icon URL for a token with versioning to prevent cache-busting churn
   * Uses daily versioning (changes once per day) instead of hourly
   */
  private getIconUrl(address: string, chainId: number): string {
    // Use daily cache-busting instead of hourly to reduce churn
    const dailyVersion = Math.floor(Date.now() / this.DAILY_MS);
    return `/api/icon?address=${address.toLowerCase()}&chainId=${chainId}&v=${dailyVersion}`;
  }

  /**
   * Get placeholder image
   */
  getPlaceholder(): string {
    return this.PLACEHOLDER;
  }

  /**
   * Get icon from cache or fetch with race condition protection
   */
  async getIcon(address: string, chainId: number): Promise<string> {
    const cacheKey = this.getCacheKey(address, chainId);
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      return cached.url;
    }

    // Check if there's already a pending request
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      // Wait for the existing request instead of creating a new one
      try {
        return await pending.promise;
      } catch (e) {
        // If the pending request was cancelled or failed, continue to create a new one
      }
    }

    // Create new request with cancellation support
    const controller = new AbortController();
    const version = ++this.requestVersion;
    
    const promise = this.fetchIcon(address, chainId, controller.signal, version, cacheKey);
    
    this.pendingRequests.set(cacheKey, {
      controller,
      promise,
      version
    });

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up pending request if it's still the same version
      const currentPending = this.pendingRequests.get(cacheKey);
      if (currentPending && currentPending.version === version) {
        this.pendingRequests.delete(cacheKey);
      }
    }
  }

  /**
   * Fetch icon from server with abort signal support
   */
  private async fetchIcon(
    address: string,
    chainId: number,
    signal: AbortSignal,
    version: number,
    cacheKey: string
  ): Promise<string> {
    const startTime = Date.now();
    try {
      const iconUrl = this.getIconUrl(address, chainId);
      
      // Fetch with abort signal
      const response = await fetch(iconUrl, { signal });
      
      if (!response.ok) {
        return this.PLACEHOLDER;
      }

      // Convert to blob URL for efficient browser caching
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      // Store in cache only if this request version is newer than what's in cache
      const existing = this.cache.get(cacheKey);
      if (!existing || version > existing.version) {
        // Only cache if this version is newer than what exists
        const entry: IconCacheEntry = {
          url: blobUrl,
          version,
          expires: Date.now() + this.CACHE_TTL
        };
        this.cache.set(cacheKey, entry);
      } else {
        // This is a stale result (older version), don't cache it
        URL.revokeObjectURL(blobUrl);
        // Return the newer cached version instead
        return existing.url;
      }

      const elapsed = Date.now() - startTime;
      // Log slow icon fetches to help diagnose performance issues
      if (elapsed > 100) {
        console.warn(`[IconCache] Slow icon fetch for ${cacheKey}: ${elapsed}ms`);
      }

      return blobUrl;
    } catch (error) {
      // Check if this was an abort
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`[IconCache] Request cancelled for ${cacheKey}`);
      } else {
        console.error(`[IconCache] Error fetching icon for ${cacheKey}:`, error);
      }
      return this.PLACEHOLDER;
    }
  }

  /**
   * Get icon synchronously from cache only (doesn't trigger fetch)
   * Returns placeholder if not in cache, and triggers background fetch
   */
  getIconSync(address: string, chainId: number): string {
    const cacheKey = this.getCacheKey(address, chainId);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() < cached.expires) {
      return cached.url;
    }
    
    // Not in cache - trigger async fetch in background
    // This ensures the icon will be available on next render
    this.getIcon(address, chainId).catch((error) => {
      // Log error for debugging but don't throw - placeholder will be shown
      console.warn(`[IconCache] Background fetch failed for ${cacheKey}:`, error);
    });
    
    return this.PLACEHOLDER;
  }

  /**
   * Prefetch icons for a batch of tokens
   * Used for dropdown suggestions to warm up cache
   * 
   * Performance: Modern browsers can handle 50-100 parallel HTTP/2 requests efficiently.
   * With server-side caching, these requests complete in 10-20ms each.
   * No need to artificially limit parallelism with small batches.
   */
  async prefetchIcons(tokens: Array<{ address: string; chainId: number }>): Promise<void> {
    // Fire all requests in parallel - browser and server will handle efficiently
    // HTTP/2 multiplexing allows many concurrent requests over single connection
    await Promise.allSettled(
      tokens.map(token => this.getIcon(token.address, token.chainId))
    );
  }

  /**
   * Cancel all pending requests for a specific token
   */
  cancelRequest(address: string, chainId: number): void {
    const cacheKey = this.getCacheKey(address, chainId);
    const pending = this.pendingRequests.get(cacheKey);
    
    if (pending) {
      pending.controller.abort();
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Cancel all pending requests
   */
  cancelAllRequests(): void {
    this.pendingRequests.forEach(pending => {
      pending.controller.abort();
    });
    this.pendingRequests.clear();
  }

  /**
   * Clear expired entries from cache
   */
  cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    this.cache.forEach((entry, key) => {
      if (now >= entry.expires) {
        expiredKeys.push(key);
        // Revoke blob URL to free memory
        if (entry.url.startsWith('blob:')) {
          URL.revokeObjectURL(entry.url);
        }
      }
    });
    
    expiredKeys.forEach(key => this.cache.delete(key));
    
    if (expiredKeys.length > 0) {
      console.log(`[IconCache] Cleaned up ${expiredKeys.length} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      pendingRequests: this.pendingRequests.size,
      currentVersion: this.requestVersion
    };
  }
}

// Export singleton instance
export const iconCache = new IconCacheManager();

// Cleanup expired entries every hour and store interval ID for cleanup
// Note: This constant is intentionally separate from the class private member
// to avoid circular dependency during module initialization
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

if (typeof window !== 'undefined') {
  cleanupIntervalId = setInterval(() => {
    iconCache.cleanup();
  }, CLEANUP_INTERVAL_MS);
  
  // Cleanup on module unload if supported
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', () => {
      if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
      }
    });
  }
}

// Helper function to get icon cache key (for backwards compatibility)
export function getIconCacheKey(address: string, chainId: number): string {
  return `${chainId}-${address.toLowerCase()}`;
}
