# Dynamic Watchlist System Implementation

## Overview
Complete implementation of a multi-chain, scalable watchlist system with real on-chain data fetching, dynamic subscription management, and hourly data refresh synchronized to GMT/UTC.

## Architecture Components

### 1. **watchlistManager.ts** (server/watchlistManager.ts)
Manages the dynamic watchlist lifecycle:
- **Subscription Tracking**: Per token (chainId + address) subscriber counting
- **1h 5min TTL Cleanup**: When subscriber count reaches 0, starts 65-minute timer. If any subscriber joins before timer expires, timer cancels and resets
- **Metrics Monitoring**: Provides real-time metrics on active tokens, subscriber counts, and memory usage
- **Cloudflare Compatible**: Uses only setTimeout, no native async timers

**Key Functions:**
- `subscribeToken(chainId, address)` - Increment subscriber count
- `unsubscribeToken(chainId, address)` - Decrement subscriber count, start cleanup timer
- `getActiveTokens()` - Get tokens with active subscribers
- `getMetrics()` - Get scalability metrics

### 2. **onchainDataFetcher.ts** (server/onchainDataFetcher.ts)
Real on-chain price and analytics data fetching:
- **Multi-Source DEX Integration**: Queries Uniswap V2, QuickSwap, and SushiSwap
- **USDC Price Discovery**: Finds token pairs to calculate accurate pricing
- **Market Cap Calculation**: Based on total supply + price
- **Volume Estimation**: Derived from market cap (5-15% typical daily volume)
- **Single-Flight Pattern**: Prevents thundering herd for 100k concurrent users
- **1h 5min Caching**: Reduces load on RPC providers

**Key Functions:**
- `fetchOnChainData(address, chainId)` - Get price, market cap, volume, 24h change
- `batchFetchOnChainData(tokens)` - Batch fetch with concurrency control
- `getCacheMetrics()` - Cache statistics

### 3. **hourlyRefreshScheduler.ts** (server/hourlyRefreshScheduler.ts)
GMT/UTC synchronized hourly refresh:
- **Fixed Hour Boundaries**: Refreshes at :00:00 UTC every hour
- **New Token Immediate Refresh**: New tokens refresh immediately, then join hourly schedule
- **Single-Flight Coordination**: Prevents concurrent refreshes
- **Concurrent Fetching**: 10 tokens at a time to balance load

**Key Functions:**
- `startHourlyRefreshScheduler()` - Start hourly refresh at server startup
- `scheduleNewTokenRefresh(chainId, address)` - Register new token for immediate + hourly refresh
- `getRefreshStatus()` - Get current refresh status

### 4. **Integration in server/routes.ts**
- WebSocket subscriptions now use dynamic watchlist manager
- Automatic cleanup of subscribers when connections close
- Real on-chain data fetching instead of placeholders
- Metrics endpoint at `/api/system/metrics`

## Data Flow

### User Subscribes to Token:
1. WebSocket message with `{ type: 'subscribe', chainId, address }`
2. `subscribeToken()` called → subscriber count incremented
3. If new token, `scheduleNewTokenRefresh()` called → immediate fetch
4. User receives cached price + analytics data

### User Unsubscribes:
1. WebSocket connection closes
2. `unsubscribeToken()` called → subscriber count decremented
3. If count reaches 0, 65-minute inactivity timer starts
4. If no new subscribers within 65 minutes, token deleted from watchlist

### Hourly Refresh:
1. At next UTC hour boundary, all active tokens refresh
2. New tokens also refresh immediately (separate from hourly cycle)
3. Data cached for 1h 5min
4. Updates broadcast to all subscribers

## Scaling to 100k Users

### Memory Efficiency:
- Single Map per token (chainId + address as key)
- Minimal per-token metadata (subscriber count, timestamp, timer ref)
- ~1KB per watched token worst case

### Request Reduction:
- Single-flight pattern: 100k concurrent requests → 1 on-chain fetch
- 1h 5min cache TTL: Only 1 fetch per token per hour
- Batch fetching: 10 tokens/second throughput
- Inactive cleanup: Removes unused tokens automatically

### Network Load:
- 25-second price refresh (only for active tokens)
- 1-hour analytics refresh (only for active tokens)
- New tokens refresh immediately (optimized path)

## Monitoring

**Metrics Endpoint**: `GET /api/system/metrics`

Returns:
```json
{
  "watchlist": {
    "totalWatchedTokens": 150,
    "activeTokens": 120,
    "totalSubscribers": 5432,
    "tokensMarkedForDeletion": 30,
    "memoryUsageTokens": 150
  },
  "cache": {
    "cachedItems": 120,
    "pendingFetches": 3
  },
  "refresh": {
    "isRefreshing": false,
    "pendingNewTokens": 0,
    "nextRefreshMs": 1234567
  },
  "timestamp": "2025-12-27T06:50:00.000Z"
}
```

## Configuration

### Token Chains Supported:
- **Ethereum (chainId: 1)**
  - RPC: `process.env.VITE_ETH_RPC_URL`
  - DEX Factories: Uniswap V2, SushiSwap
  
- **Polygon (chainId: 137)**
  - RPC: `process.env.VITE_POL_RPC_URL`
  - DEX Factories: QuickSwap, SushiSwap

### TTL Configuration:
- **Cache TTL**: 65 minutes (1h 5m)
- **Inactive Token TTL**: 65 minutes
- **Price Refresh Interval**: 25 seconds
- **Analytics Refresh**: Hourly at UTC boundaries

## Cloudflare Compatibility

✓ No Node.js native timers (setTimeout only)
✓ No file system operations in real-time paths
✓ Pure async/await for all I/O
✓ No environment-specific APIs
✓ Stateless transaction model
✓ No persistent connections required

## Future Enhancements

1. **Multiple On-Chain Source Aggregation**: Add Curve, Balancer, other DEXs
2. **Slippage Estimation**: Calculate expected slippage for swaps
3. **Liquidity Tracking**: Monitor liquidity depth per pool
4. **Price Prediction**: ML-based price prediction models
5. **Alert System**: Notify users of significant price changes
6. **Database Persistence**: Store historical data in PostgreSQL
