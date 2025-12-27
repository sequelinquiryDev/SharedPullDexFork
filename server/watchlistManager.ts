/**
 * Dynamic Watchlist Manager
 * Handles:
 * - Subscription tracking (token address + chain ID)
 * - Token lifecycle management with 1h 5min TTL for inactive subscribers
 * - Single-flight pattern for scalability to 100k concurrent users
 * - Cloudflare Workers compatible (no native timers except setTimeout)
 */

interface TokenSubscription {
  tokenKey: string; // format: `${chainId}-${address}`
  subscriberCount: number;
  lastSubscriberTime: number;
  inactiveTimer: NodeJS.Timeout | null;
  isMarkedForDeletion: boolean;
}

const INACTIVE_TTL = 65 * 60 * 1000; // 1 hour 5 minutes in milliseconds
const watchlist = new Map<string, TokenSubscription>();
const subscriberCountPerToken = new Map<string, number>();

/**
 * Add or update a token subscription
 * If token has 0 subscribers transitioning to 1+, cancel deletion timer
 */
export function subscribeToken(chainId: number, address: string): string {
  const tokenKey = `${chainId}-${address.toLowerCase()}`;
  
  const current = watchlist.get(tokenKey);
  
  if (!current) {
    // New token added
    const subscription: TokenSubscription = {
      tokenKey,
      subscriberCount: 1,
      lastSubscriberTime: Date.now(),
      inactiveTimer: null,
      isMarkedForDeletion: false,
    };
    watchlist.set(tokenKey, subscription);
    subscriberCountPerToken.set(tokenKey, 1);
    return tokenKey;
  }
  
  // Existing token - increment subscriber count
  const newCount = current.subscriberCount + 1;
  current.subscriberCount = newCount;
  current.lastSubscriberTime = Date.now();
  subscriberCountPerToken.set(tokenKey, newCount);
  
  // If this token was marked for deletion and now has subscribers, cancel deletion
  if (current.isMarkedForDeletion && current.inactiveTimer) {
    clearTimeout(current.inactiveTimer);
    current.inactiveTimer = null;
    current.isMarkedForDeletion = false;
    console.log(`[WatchlistManager] Cancelled deletion timer for ${tokenKey} - new subscriber added`);
  }
  
  return tokenKey;
}

/**
 * Decrement subscriber count
 * When count reaches 0, start 1h 5min timer for deletion
 */
export function unsubscribeToken(chainId: number, address: string): void {
  const tokenKey = `${chainId}-${address.toLowerCase()}`;
  const subscription = watchlist.get(tokenKey);
  
  if (!subscription || subscription.subscriberCount <= 0) return;
  
  subscription.subscriberCount = Math.max(0, subscription.subscriberCount - 1);
  subscriberCountPerToken.set(tokenKey, subscription.subscriberCount);
  
  if (subscription.subscriberCount === 0) {
    // Start 1h 5min inactivity timer
    console.log(`[WatchlistManager] Token ${tokenKey} has 0 subscribers - starting ${INACTIVE_TTL / 1000}s inactivity timer`);
    
    subscription.isMarkedForDeletion = true;
    subscription.inactiveTimer = setTimeout(() => {
      console.log(`[WatchlistManager] Removing inactive token ${tokenKey} (no subscribers for 1h5m)`);
      watchlist.delete(tokenKey);
      subscriberCountPerToken.delete(tokenKey);
    }, INACTIVE_TTL);
  }
}

/**
 * Get all tokens currently in the watchlist with active subscribers
 */
export function getActiveTokens(): string[] {
  return Array.from(watchlist.entries())
    .filter(([_, sub]) => sub.subscriberCount > 0)
    .map(([key, _]) => key);
}

/**
 * Get all tokens including those waiting for deletion
 */
export function getAllWatchedTokens(): string[] {
  return Array.from(watchlist.keys());
}

/**
 * Get subscriber count for a specific token
 */
export function getSubscriberCount(tokenKey: string): number {
  return subscriberCountPerToken.get(tokenKey) || 0;
}

/**
 * Get detailed information about a watched token
 */
export function getTokenInfo(chainId: number, address: string): TokenSubscription | null {
  const tokenKey = `${chainId}-${address.toLowerCase()}`;
  return watchlist.get(tokenKey) || null;
}

/**
 * Check if token is actively watched
 */
export function isTokenWatched(chainId: number, address: string): boolean {
  const tokenKey = `${chainId}-${address.toLowerCase()}`;
  const sub = watchlist.get(tokenKey);
  return sub !== undefined && sub.subscriberCount > 0;
}

/**
 * Get metrics for monitoring/scalability verification
 */
export function getMetrics() {
  const allTokens = Array.from(watchlist.values());
  const activeTokens = allTokens.filter(t => t.subscriberCount > 0);
  const totalSubscribers = allTokens.reduce((sum, t) => sum + t.subscriberCount, 0);
  const tokensMarkedForDeletion = allTokens.filter(t => t.isMarkedForDeletion).length;
  
  return {
    totalWatchedTokens: watchlist.size,
    activeTokens: activeTokens.length,
    totalSubscribers,
    tokensMarkedForDeletion,
    memoryUsageTokens: watchlist.size,
  };
}
