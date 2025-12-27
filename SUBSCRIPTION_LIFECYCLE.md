# Complete Subscription Lifecycle & Analytics Delivery Timing

**Date**: December 27, 2025

---

## 🔑 Key Distinction

**The 8-second new token checker monitors:**
- **DYNAMIC WATCHLIST** (from `watchlistManager.ts`)
- Only tokens with `subscriberCount > 0` (active subscribers)
- NOT the static token list from `tokens.json`

```typescript
// newTokenChecker.ts, line 46
const activeTokens = getActiveTokens();  // ← Returns ONLY tokens with subscribers
```

---

## 📊 Complete Subscription Timeline

### Timeline: User Selects Token at T=0ms

```
T=0ms    │ User sends 'subscribe' message (token: 0x123..., chainId: 1)
         │
T=1ms    │ subscribeToken(1, 0x123...) 
         │ ↓ Watchlist updated: token added with subscriberCount=1
         │
T=2ms    │ activeSubscriptions updated for PRICES
         │
T=3ms    │ analyticsSubscriptions updated for ANALYTICS
         │
T=4ms    │ fetchPriceAggregated() called
         │ ↓ Returns cached price OR fetches fresh
         │
T=5ms    │ PRICE SENT TO CLIENT ✅
         │
T=6ms    │ getOnChainAnalytics() called
         │ ↓ Returns cached analytics OR fetches fresh
         │ ↓ Broadcasts to all subscribers of this token
         │
T=7ms    │ ANALYTICS SENT TO CLIENT ✅
         │
T=8ms    │ Client receives both price + analytics
         │ ↓ Can display in mini radar button
         │
⏱️ NEXT 8-SEC CHECK (at T=8s)
         │
         │ checkForNewTokens() runs
         │ ↓ activeTokens = getActiveTokens() 
         │ ↓ Sees 0x123... in watchlist (not in seenTokens yet)
         │ ↓ Calls scheduleNewTokenRefresh(1, 0x123...)
         │
         │ "New token detected" log entry
```

---

## 🔄 Three Subscription States

### State 1: SUBSCRIBED for ANALYTICS

**When?** Immediately on `'subscribe'` message  
**How?** Added to `analyticsSubscriptions` map (line 368-372)  
**Duration?** Until WebSocket closes  
**Data Received?** 
- Initial analytics on subscription (line 380-382)
- Updates on every hourly refresh (line 157-164 in getOnChainAnalytics)
- Immediate refresh when token first detected by 8-sec checker

```typescript
// routes.ts, line 368-372: Subscribe to analytics
const analyticsKey = `analytics-${data.chainId}-${data.address.toLowerCase()}`;
if (!analyticsSubscriptions.has(analyticsKey)) {
  analyticsSubscriptions.set(analyticsKey, new Set());
}
analyticsSubscriptions.get(analyticsKey)!.add(ws);
```

### State 2: SUBSCRIBED for PRICE

**When?** Immediately on `'subscribe'` message  
**How?** Added to `activeSubscriptions` map (line 357-361)  
**Duration?** Until WebSocket closes or user unsubscribes  
**Data Received?**
- Initial price on subscription (line 374-376)
- Updates every 25 seconds from `startUnconditionalPriceRefresh()` (line 260-275)

```typescript
// routes.ts, line 353-361: Subscribe to prices
const key = `${data.chainId}-${data.address.toLowerCase()}`;
if (!activeSubscriptions.has(key)) {
  activeSubscriptions.set(key, { clients: new Set(), lastSeen: Date.now() });
}
activeSubscriptions.get(key)!.clients.add(ws);
```

### State 3: IN WATCHLIST for MONITORING

**When?** Immediately on `'subscribe'` message  
**How?** `subscribeToken()` call adds to watchlist (line 355)  
**Duration?** Until subscriber count = 0, then 1h 5min timer  
**Monitored By?** 8-second new token checker

```typescript
// routes.ts, line 355: Add to dynamic watchlist
subscribeToken(data.chainId, data.address);

// watchlistManager.ts, line 26-42: Increments subscriber count
export function subscribeToken(chainId: number, address: string): string {
  const tokenKey = `${chainId}-${address.toLowerCase()}`;
  const current = watchlist.get(tokenKey);
  
  if (!current) {
    // NEW TOKEN: Add with subscriberCount=1
    const subscription: TokenSubscription = {
      tokenKey,
      subscriberCount: 1,
      lastSubscriberTime: Date.now(),
      inactiveTimer: null,
      isMarkedForDeletion: false,
    };
    watchlist.set(tokenKey, subscription);
    return tokenKey;
  }
  
  // EXISTING TOKEN: Increment subscriber count
  const newCount = current.subscriberCount + 1;
  current.subscriberCount = newCount;
  return tokenKey;
}
```

---

## ❌ Unsubscription Flow

### When User Disconnects (WebSocket closes)

**Timing**: IMMEDIATE (no delay)

```typescript
// routes.ts, line 389-397: On WebSocket close
ws.on('close', () => {
  // 1. Unsubscribe from PRICE
  if (currentSub) {
    activeSubscriptions.get(currentSub)?.clients.delete(ws);
    const [chainId, addr] = currentSub.split('-');
    unsubscribeToken(Number(chainId), addr);  // ← Decrements subscriber count
  }
  
  // 2. Unsubscribe from ANALYTICS
  if (currentAnalyticsSub) {
    analyticsSubscriptions.get(currentAnalyticsSub)?.delete(ws);
  }
});

// watchlistManager.ts, line 66-86: Unsubscribe decrements count
export function unsubscribeToken(chainId: number, address: string): void {
  const tokenKey = `${chainId}-${address.toLowerCase()}`;
  const subscription = watchlist.get(tokenKey);
  
  if (!subscription || subscription.subscriberCount <= 0) return;
  
  subscription.subscriberCount = Math.max(0, subscription.subscriberCount - 1);
  
  if (subscription.subscriberCount === 0) {
    // ZERO SUBSCRIBERS: Start 1h 5min cleanup timer
    subscription.isMarkedForDeletion = true;
    subscription.inactiveTimer = setTimeout(() => {
      watchlist.delete(tokenKey);  // ← REMOVED from watchlist
    }, INACTIVE_TTL);  // 1h 5min
  }
}
```

---

## 🕐 Analytics Delivery Timing

### When Does User Receive Analytics If They Select Token Now?

**Scenario**: User selects token at any time

**Analytics Delivery**:

| Time | Event | Source |
|------|-------|--------|
| **T=0** | User subscribes | - |
| **T+6ms** | Analytics sent to client | Cached (if exists) OR Fresh fetch |
| **Next 8-sec** | New token detected by checker | Dynamic watchlist check |
| **Immediately** | Fresh analytics fetched | `scheduleNewTokenRefresh()` |
| **Every 25-sec** | Price updated | `startUnconditionalPriceRefresh()` |
| **Every GMT hour** | All analytics refreshed | `startHourlyRefreshScheduler()` |

### Analytics Cache Sources (in order):

1. **1-hour cache hit** (line 114-115, routes.ts)
   - If cached analytics exist and not expired: use cached data
   - Speed: instant

2. **Single-flight dedup** (line 119-120)
   - If another client is already fetching same token: wait for result
   - Speed: depends on fetch time

3. **Fresh on-chain fetch** (line 125-177)
   - Fetches price, marketcap, volume, change24h from on-chain
   - Generates 24-hour price history
   - Caches result for 1 hour
   - Speed: 500ms-2s depending on RPC

---

## 🎯 8-Second New Token Checker Behavior

### What It Monitors

```typescript
// newTokenChecker.ts, line 46
const activeTokens = getActiveTokens();  // ← ONLY tokens with subscriberCount > 0
```

**NOT monitoring**:
- ❌ Static token list from `tokens.json`
- ❌ Ethereum/Polygon token registries
- ❌ Offline data sources

**Monitoring**:
- ✅ Real-time watchlist in memory
- ✅ Only tokens actively selected by users right now
- ✅ Subscriber count must be > 0

### Pause Windows

```typescript
// newTokenChecker.ts, line 28-31
function shouldPauseCheck(): boolean {
  const minute = getCurrentGMTMinute();
  return minute === 59 || minute === 0;  // ← Pause at these times
}
```

**Pause Windows**:
- **Minute 59** (1 minute before hourly refresh)
- **Minute 0** (during hourly refresh)

**Why**?
- Prevents race conditions with hourly refresh scheduler
- Avoids duplicate analytics fetches
- Allows hourly refresh to complete without interference

**Resume**: Automatically at minute 2 of next hour

### New Token Detection

```typescript
// newTokenChecker.ts, line 49-62
for (const tokenKey of activeTokens) {
  if (!seenTokens.has(tokenKey)) {  // ← Never seen before
    seenTokens.add(tokenKey);
    scheduleNewTokenRefresh(chainId, address);  // ← Trigger immediate fetch
  }
}
```

**Logic**:
- Maintains `seenTokens` Set (tokens we've already processed)
- On each 8-second check, looks for tokens NOT in `seenTokens`
- If found, calls `scheduleNewTokenRefresh()` to fetch analytics immediately
- Marks token as "seen" to avoid re-triggering

---

## 📋 Complete Example: User Journey

### 14:30:00 GMT - User Opens App

```
14:30:00  App loads
          → 8-sec checker running (last run: 14:29:56, next: 14:30:04)
          → Price refresher running (every 25-sec)
          → Hourly refresher scheduled (next: 15:00:00)
```

### 14:30:15 GMT - User Types Token Address in Search

```
14:30:15  User types "0xaBcD..." in token search bar
          → Frontend makes /api/tokens/search request
          → Gets token info (symbol, decimals, name)
          → Displays in dropdown suggestions
```

### 14:30:22 GMT - User Clicks Token to Select

```
14:30:22  User clicks token → Sends WebSocket 'subscribe' message
          
14:30:22.1ms  subscribeToken(1, 0xaBcD...) 
              → Watchlist updated: 1-0xabcd... added
              → subscriberCount = 1
              
14:30:22.2ms  activeSubscriptions updated
              
14:30:22.3ms  analyticsSubscriptions updated
              
14:30:22.4ms  fetchPriceAggregated() called
              → Cache miss (or hit)
              → Returns price
              
14:30:22.5ms  PRICE SENT TO CLIENT ✅
              → Frontend displays price in search bar
              
14:30:22.6ms  getOnChainAnalytics() called
              → Cache miss (first time)
              → Fetches on-chain data
              → Generates 24h price history
              → Caches with 1h TTL
              → Broadcasts to all subscribers (just this one client)
              
14:30:22.8ms  ANALYTICS SENT TO CLIENT ✅
              → Frontend displays in mini radar button:
                - 24h % change
                - 24h price history (24-point array)
                - Volume
                - Market cap
```

### 14:30:24 GMT - 8-Sec Checker Runs

```
14:30:24  checkForNewTokens() executes
          → getActiveTokens() returns [1-0xabcd...]
          → 1-0xabcd... not in seenTokens
          → Add to seenTokens
          → scheduleNewTokenRefresh(1, 0xaBcD...)
          
14:30:24.1ms  Log: "[NewTokenChecker] New token detected: 1-0xabcd..."
              
14:30:24.2ms  Log: "[NewTokenChecker] Found 1 new token(s) - scheduled immediate analytics fetch"
              
Note: This is REDUNDANT with T=22ms fetch
      But ensures fresh data if cache expired
      Or catches tokens added between checker runs
```

### 14:30:50 GMT - Price Refresher Runs

```
14:30:50  startUnconditionalPriceRefresh() interval
          → getActiveTokens() returns [1-0xabcd...]
          → For each: getOnChainPrice(0xaBcD..., 1)
          → Fetches fresh price
          → Updates onChainCache
          
Note: These prices NOT broadcast here
      Only cached for /api/prices/onchain requests
      or sent when new client subscribes
```

### 14:59:00 GMT - Approaching Hourly Refresh

```
14:59:00  Minute 59 begins
          → 8-sec checker sees: shouldPauseCheck() = true
          → Next check at 14:59:08 SKIPPED
          
14:59:30  8-sec interval triggers
          → shouldPauseCheck() returns true
          → Skips check, logs: "[NewTokenChecker] PAUSED at GMT minute 59..."
```

### 15:00:00 GMT - Hourly Refresh Starts

```
15:00:00  Minute 0 begins
          → 8-sec checker sees: shouldPauseCheck() = true
          
15:00:00  hourlyRefreshScheduler runs
          → getActiveTokens() returns [1-0xabcd...]
          → batchFetchOnChainData() for all active tokens
          → Refreshes analytics for all
          → Invalidates cache (or refreshes in place)
          
15:00:00.5s  Broadcast to all analytics subscribers
             → Sends updated analytics to client
             → 24h % change, price history, volume, etc.
```

### 15:00:02 GMT - Resume Normal Operations

```
15:00:02  Minute 2 begins
          → 8-sec checker resumes normal operation
          → Next check at 15:00:08 runs normally
```

### 15:05:30 GMT - User Closes Tab / Disconnects

```
15:05:30  WebSocket closes
          
15:05:30.1ms  ws.on('close') handler fires
              → activeSubscriptions[1-0xabcd...].clients.delete(ws)
              → unsubscribeToken(1, 0xaBcD...)
              → subscriberCount decreases: 1 → 0
              → Marked for deletion: true
              → Timer started: 1h 5min countdown
              
15:05:30.2ms  analyticsSubscriptions[analytics-1-0xabcd...].delete(ws)
              
Log: "[WatchlistManager] Token 1-0xabcd... has 0 subscribers - starting 3900s inactivity timer"

15:06:30  8-sec checker runs
          → getActiveTokens() returns []
          → 1-0xabcd... NOT in active tokens (subscriberCount = 0)
          → Does NOT appear in checker (not in returned list)

16:05:30  (1 hour 5 minutes later)
          → Timer expires
          → watchlist.delete(1-0xabcd...)
          → Token completely removed from memory
          
Log: "[WatchlistManager] Removing inactive token 1-0xabcd... (no subscribers for 1h5m)"
```

---

## ✅ Verification Checklist

- ✅ When user selects token: SUBSCRIBED to both price AND analytics
- ✅ When user selects token: Receives analytics IMMEDIATELY (cached or fresh)
- ✅ When user disconnects: UNSUBSCRIBED immediately (no delay)
- ✅ 8-sec checker monitors: DYNAMIC WATCHLIST only (tokens with subscribers)
- ✅ 8-sec checker ignores: Static token list from tokens.json
- ✅ 8-sec checker pauses: Minute 59 and minute 0 GMT
- ✅ 8-sec checker resumes: Minute 2 GMT
- ✅ Cleanup timing: Session-based (WebSocket disconnect)
- ✅ Watchlist TTL: 1h 5min AFTER subscriber count = 0
- ✅ Analytics delivery: Every 25sec (price) + Every GMT hour (full analytics)

---

## 🔍 How to Debug/Verify

### Check if Token in Watchlist
```
Frontend: Send /api/watchlist-metrics request
Returns: totalWatchedTokens, activeTokens, totalSubscribers
Shows if token is being tracked
```

### Check if Token Subscribed
```
Look at browser DevTools Network tab
WebSocket messages should show:
- 'subscribe' sent when clicking token
- 'price' messages every 25-35 seconds
- 'analytics' messages on subscription + every GMT hour
```

### Check 8-Sec Checker Status
```
Frontend: Send /api/new-token-checker-status request
Returns: isRunning, isPaused, currentGMTMinute, seenTokensCount
Shows if checker is paused during hourly refresh window
```

### Check Logs
```
Search for:
[NewTokenChecker] - 8-sec checker operations
[WatchlistManager] - Token add/remove operations
[Analytics] - Analytics fetch operations
[HourlyRefresh] - Hourly refresh operations
```
