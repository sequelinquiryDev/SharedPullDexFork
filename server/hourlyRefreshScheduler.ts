/**
 * Hourly Refresh Scheduler
 * - Fixed GMT/UTC hourly timing
 * - Refreshes all watched tokens' on-chain data
 * - New tokens refresh immediately, then sync with next hourly refresh
 * - Cache invalidation and TTL management
 */

import { batchFetchOnChainData, invalidateCache } from "./onchainDataFetcher";
import { getActiveTokens } from "./watchlistManager";

let hourlyRefreshTimer: NodeJS.Timeout | null = null;
const newTokensToRefresh = new Set<string>();
let isRefreshing = false;

/**
 * Get milliseconds until next hour boundary (GMT/UTC)
 */
function getMillisecondsUntilNextHour(): number {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1);
  nextHour.setUTCMinutes(0);
  nextHour.setUTCSeconds(0);
  nextHour.setUTCMilliseconds(0);

  return nextHour.getTime() - now.getTime();
}

/**
 * Register a new token for immediate refresh
 * This token will be refreshed immediately, then on next hourly refresh
 */
export function scheduleNewTokenRefresh(chainId: number, address: string): void {
  const tokenKey = `${chainId}-${address.toLowerCase()}`;
  newTokensToRefresh.add(tokenKey);
  
  // Refresh immediately
  refreshNewTokens();
}

/**
 * Refresh only the newly added tokens
 */
async function refreshNewTokens(): Promise<void> {
  if (newTokensToRefresh.size === 0) return;

  const tokens = Array.from(newTokensToRefresh).map((key) => {
    const [chainId, address] = key.split("-");
    return { chainId: Number(chainId), address };
  });

  console.log(
    `[HourlyRefresh] Refreshing ${tokens.length} newly added tokens immediately...`
  );

  try {
    await batchFetchOnChainData(tokens);
    console.log(`[HourlyRefresh] New token refresh complete`);
  } catch (e) {
    console.error(`[HourlyRefresh] Error refreshing new tokens:`, e);
  }

  newTokensToRefresh.clear();
}

/**
 * Main hourly refresh function
 * Refreshes all actively watched tokens
 */
async function performHourlyRefresh(): Promise<void> {
  if (isRefreshing) {
    console.log("[HourlyRefresh] Refresh already in progress, skipping...");
    return;
  }

  isRefreshing = true;
  const startTime = Date.now();

  try {
    const activeTokens = getActiveTokens();

    if (activeTokens.length === 0) {
      console.log("[HourlyRefresh] No active tokens to refresh");
      return;
    }

    console.log(
      `[HourlyRefresh] Starting hourly refresh at ${new Date().toUTCString()} for ${activeTokens.length} tokens...`
    );

    // Convert token keys to fetch format
    const tokens = activeTokens.map((key) => {
      const [chainId, address] = key.split("-");
      return { chainId: Number(chainId), address };
    });

    // Batch fetch with concurrency control
    await batchFetchOnChainData(tokens);

    const duration = Date.now() - startTime;
    console.log(
      `[HourlyRefresh] ✓ Hourly refresh complete in ${duration}ms for ${activeTokens.length} tokens`
    );
  } catch (e) {
    console.error(`[HourlyRefresh] Error during refresh:`, e);
  } finally {
    isRefreshing = false;
  }
}

/**
 * Start the hourly refresh scheduler
 * Must be called once at server startup
 */
export function startHourlyRefreshScheduler(): void {
  console.log(
    `[HourlyRefresh] Scheduler starting - synced to GMT/UTC hour boundaries`
  );

  // Initial refresh
  performHourlyRefresh();

  // Schedule next refresh at next hour boundary
  function scheduleNextRefresh(): void {
    const delayMs = getMillisecondsUntilNextHour();
    const nextHourTime = new Date();
    nextHourTime.setUTCMilliseconds(delayMs);

    console.log(
      `[HourlyRefresh] Next refresh scheduled in ${(delayMs / 1000 / 60).toFixed(
        1
      )} minutes`
    );

    if (hourlyRefreshTimer) {
      clearTimeout(hourlyRefreshTimer);
    }

    hourlyRefreshTimer = setTimeout(() => {
      performHourlyRefresh();
      scheduleNextRefresh();
    }, delayMs);
  }

  scheduleNextRefresh();
}

/**
 * Stop the scheduler
 */
export function stopHourlyRefreshScheduler(): void {
  if (hourlyRefreshTimer) {
    clearTimeout(hourlyRefreshTimer);
    hourlyRefreshTimer = null;
    console.log("[HourlyRefresh] Scheduler stopped");
  }
}

/**
 * Get refresh status
 */
export function getRefreshStatus() {
  return {
    isRefreshing,
    pendingNewTokens: newTokensToRefresh.size,
    nextRefreshMs: hourlyRefreshTimer
      ? getMillisecondsUntilNextHour()
      : null,
  };
}
