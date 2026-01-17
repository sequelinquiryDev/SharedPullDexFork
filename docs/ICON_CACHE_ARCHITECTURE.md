# Icon Caching System - Architecture Diagrams

## System Architecture Overview

```
╔════════════════════════════════════════════════════════════════════════════╗
║                     TOKEN ICON CACHING SYSTEM                              ║
║                    Two-Tier Shared Cache Architecture                      ║
╚════════════════════════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────────────────────┐
│                         CLIENT TIER (Browser)                             │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  React Components                                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐         │  │
│  │  │TokenInput.tsx│  │TokenSearchBar│  │TokenInfoSidebar │         │  │
│  │  │              │  │    .tsx      │  │    .tsx         │         │  │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘         │  │
│  │         │                 │                     │                   │  │
│  │         └─────────────────┴─────────────────────┘                   │  │
│  │                            │                                         │  │
│  │                            ▼                                         │  │
│  │  ┌────────────────────────────────────────────────────────────┐    │  │
│  │  │  tokenService.ts                                            │    │  │
│  │  │  - getTokenLogoUrl(token, chainId)                         │    │  │
│  │  │  - fetchTokenIcon(token, chainId)                          │    │  │
│  │  └──────────────────────────┬──────────────────────────────────┘    │  │
│  │                            │                                         │  │
│  │                            ▼                                         │  │
│  │  ┌────────────────────────────────────────────────────────────┐    │  │
│  │  │  IconCacheManager (iconCache.ts) - SINGLETON               │    │  │
│  │  │  ┌──────────────────────────────────────────────────────┐ │    │  │
│  │  │  │  In-Memory Cache (Map)                               │ │    │  │
│  │  │  │  Key: "1-0xc02aa..." → Value: {                      │ │    │  │
│  │  │  │    url: "blob:http://localhost:5000/abc123",         │ │    │  │
│  │  │  │    version: 42,                                      │ │    │  │
│  │  │  │    expires: 1737724800000                            │ │    │  │
│  │  │  │  }                                                    │ │    │  │
│  │  │  │  TTL: 7 days                                          │ │    │  │
│  │  │  └──────────────────────────────────────────────────────┘ │    │  │
│  │  │  ┌──────────────────────────────────────────────────────┐ │    │  │
│  │  │  │  Pending Requests (Map)                              │ │    │  │
│  │  │  │  Deduplicates simultaneous fetches                   │ │    │  │
│  │  │  │  Provides AbortController for cancellation          │ │    │  │
│  │  │  └──────────────────────────────────────────────────────┘ │    │  │
│  │  │  ┌──────────────────────────────────────────────────────┐ │    │  │
│  │  │  │  Request Versioning                                  │ │    │  │
│  │  │  │  Prevents race conditions                            │ │    │  │
│  │  │  │  Version increments: 1, 2, 3, 4...                  │ │    │  │
│  │  │  └──────────────────────────────────────────────────────┘ │    │  │
│  │  └────────────────────────────────────────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │
                             │ HTTP GET /api/icon?address=...&chainId=...&v=...
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         SERVER TIER (Node.js)                             │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  routes.ts                                                          │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │  GET /api/icon Handler                                        │ │  │
│  │  │  1. Extract address, chainId from query params               │ │  │
│  │  │  2. Call fetchAndBase64Icon(address, chainId)                │ │  │
│  │  │  3. Parse base64 → binary                                    │ │  │
│  │  │  4. Set Cache-Control: max-age=604800 (7 days)              │ │  │
│  │  │  5. Return binary image                                       │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │  Server Icon Cache (Map) - SHARED ACROSS ALL CLIENTS        │ │  │
│  │  │  Key: "1-0xc02aa..." → Value: {                             │ │  │
│  │  │    url: "data:image/png;base64,iVBORw0KGgoAAAA...",         │ │  │
│  │  │    expires: 1737724800000,                                   │ │  │
│  │  │    sourceUrl: "https://trustwallet.com/..."                 │ │  │
│  │  │  }                                                            │ │  │
│  │  │  TTL: 7 days                                                  │ │  │
│  │  │  Benefit: ONE fetch serves ALL users                         │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │  fetchAndBase64Icon(address, chainId)                        │ │  │
│  │  │  1. Check server cache (if hit, return immediately)          │ │  │
│  │  │  2. Single-flight pattern (dedupe concurrent fetches)        │ │  │
│  │  │  3. Try 7 external sources in priority order                 │ │  │
│  │  │  4. Convert response to base64 data URI                      │ │  │
│  │  │  5. Store in server cache                                     │ │  │
│  │  │  6. Return base64 string                                      │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  │                                                                     │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │  startBackgroundIconCacher()                                  │ │  │
│  │  │  - Runs on server startup                                     │ │  │
│  │  │  - Reads all tokens from tokens.json                         │ │  │
│  │  │  - Pre-fetches icons for all tokens                          │ │  │
│  │  │  - Batch size: 10 tokens                                      │ │  │
│  │  │  - Repeats every hour                                          │ │  │
│  │  │  Result: First user gets instant icons!                       │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │
                             │ HTTP requests with 5-second timeout
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL ICON SOURCES (Priority Order)                │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  1. tokens.json logoURI (if available)                             │ │
│  │     ✓ Highest priority, custom URLs                                │ │
│  │                                                                      │ │
│  │  2. Native Token Fallbacks                                          │ │
│  │     - CoinGecko ETH icon                                            │ │
│  │     - CoinGecko MATIC icon                                          │ │
│  │                                                                      │ │
│  │  3. TrustWallet GitHub                                              │ │
│  │     https://raw.githubusercontent.com/trustwallet/assets/...       │ │
│  │     ✓ Most comprehensive, but can be slow                          │ │
│  │                                                                      │ │
│  │  4. TrustWallet CDN                                                 │ │
│  │     https://assets-cdn.trustwallet.com/blockchains/...             │ │
│  │     ✓ Faster than GitHub                                           │ │
│  │                                                                      │ │
│  │  5. PancakeSwap Token List                                          │ │
│  │     https://raw.githubusercontent.com/pancakeswap/token-list/...   │ │
│  │                                                                      │ │
│  │  6. Uniswap Assets                                                  │ │
│  │     https://raw.githubusercontent.com/uniswap/assets/...           │ │
│  │                                                                      │ │
│  │  7. CoinGecko API (last resort)                                     │ │
│  │     https://api.coingecko.com/api/v3/coins/.../contract/...       │ │
│  │     ✓ Requires JSON parsing, then fetch icon URL                   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## Request Flow Sequence Diagram

### Scenario 1: First Time User (Cold Cache)

```
Client Browser          Client Cache         Server            Server Cache        External APIs
     │                       │                   │                    │                    │
     │ User opens dropdown   │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │                   │                    │                    │
     │ getIconSync(WETH, 1)  │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │ Check cache       │                    │                    │
     │                       │ ❌ Not found      │                    │                    │
     │<──────────────────────│                   │                    │                    │
     │ Return placeholder    │                   │                    │                    │
     │                       │                   │                    │                    │
     │ (UI shows "?")        │                   │                    │                    │
     │                       │                   │                    │                    │
     │ Background fetch      │                   │                    │                    │
     │ triggered             │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │ GET /api/icon?... │                    │                    │
     │                       │──────────────────>│                    │                    │
     │                       │                   │ Check server cache │                    │
     │                       │                   │───────────────────>│                    │
     │                       │                   │                    │ ✅ Found (pre-cache)│
     │                       │                   │<───────────────────│                    │
     │                       │                   │ Return base64      │                    │
     │                       │<──────────────────│                    │                    │
     │                       │ Convert to blob   │                    │                    │
     │                       │ Store in cache    │                    │                    │
     │<──────────────────────│                   │                    │                    │
     │ Re-render triggered   │                   │                    │                    │
     │                       │                   │                    │                    │
     │ getIconSync(WETH, 1)  │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │ ✅ Cache hit!     │                    │                    │
     │<──────────────────────│                   │                    │                    │
     │ Return blob URL       │                   │                    │                    │
     │                       │                   │                    │                    │
     │ (UI shows WETH icon)  │                   │                    │                    │
     │                       │                   │                    │                    │

Time: 0ms────────────100ms──────────────────────────────────────────200ms
      Placeholder           Network request                          Real icon
```

### Scenario 2: Second User (Warm Server Cache)

```
Client Browser          Client Cache         Server            Server Cache        External APIs
     │                       │                   │                    │                    │
     │ User opens dropdown   │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │                   │                    │                    │
     │ getIconSync(WETH, 1)  │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │ ❌ Not in client  │                    │                    │
     │<──────────────────────│    cache yet      │                    │                    │
     │ Return placeholder    │                   │                    │                    │
     │                       │                   │                    │                    │
     │ Background fetch      │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │ GET /api/icon?... │                    │                    │
     │                       │──────────────────>│                    │                    │
     │                       │                   │ Check server cache │                    │
     │                       │                   │───────────────────>│                    │
     │                       │                   │                    │ ✅ Found (from User1)│
     │                       │                   │<───────────────────│                    │
     │                       │                   │ Return immediately │                    │
     │                       │<──────────────────│ (10-20ms!)         │ ⚠️  NO REQUEST!   │
     │                       │ Store in cache    │                    │                    │
     │<──────────────────────│                   │                    │                    │
     │ Re-render             │                   │                    │                    │
     │                       │                   │                    │                    │
     │ (UI shows WETH icon)  │                   │                    │                    │
     │                       │                   │                    │                    │

Time: 0ms────────50ms────────────────────────────
      Placeholder        Real icon (no external call!)
```

### Scenario 3: Same User, Second Dropdown Open

```
Client Browser          Client Cache         Server            Server Cache        External APIs
     │                       │                   │                    │                    │
     │ User opens dropdown   │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │                   │                    │                    │
     │ getIconSync(WETH, 1)  │                   │                    │                    │
     │──────────────────────>│                   │                    │                    │
     │                       │ ✅ Cache hit!     │                    │                    │
     │<──────────────────────│ (instant!)        │ ⚠️  NO REQUEST!   │                    │
     │ Return blob URL       │                   │                    │                    │
     │                       │                   │                    │                    │
     │ (UI shows WETH icon)  │                   │                    │                    │
     │ IMMEDIATELY!          │                   │                    │                    │
     │                       │                   │                    │                    │

Time: 0ms─────────────────
      Real icon (instant, 0 network requests!)
```

## Race Condition Prevention

### Problem: Rapid Searching Without Protection

```
Timeline of User Typing "UNI" Fast:

t=0ms:   User types "U"
         ├─ Search returns: USDC, USDT, UNI
         ├─ Fetch USDC icon (Request #1, version: undefined)
         ├─ Fetch USDT icon (Request #2, version: undefined)
         └─ Fetch UNI icon  (Request #3, version: undefined)

t=50ms:  User types "N" (before requests complete)
         ├─ Search returns: UNI, UNIC
         ├─ Fetch UNI icon  (Request #4, version: undefined) ← DUPLICATE!
         └─ Fetch UNIC icon (Request #5, version: undefined)

t=100ms: User types "I"
         └─ Search returns: UNI only
             └─ Fetch UNI icon (Request #6, version: undefined) ← DUPLICATE!

t=200ms: Request #1 (USDC) completes
         └─ Cache stores USDC icon
             └─ UI shows USDC icon for "UNI" search ❌ WRONG!

t=250ms: Request #6 (UNI latest) completes
         └─ Cache overwrites with UNI icon
             └─ UI shows UNI icon ✓ Correct, but flickered!

Result: User sees USDC icon briefly, then UNI icon (flicker)
```

### Solution: Request Versioning

```
Timeline of User Typing "UNI" Fast WITH Protection:

t=0ms:   User types "U"
         ├─ requestVersion++  (now = 1)
         ├─ Fetch USDC icon (Request #1, version: 1)
         ├─ requestVersion++  (now = 2)
         ├─ Fetch USDT icon (Request #2, version: 2)
         ├─ requestVersion++  (now = 3)
         └─ Fetch UNI icon  (Request #3, version: 3)

t=50ms:  User types "N"
         ├─ pendingRequests.has("UNI") = true
         │   └─ SKIP fetch, reuse existing promise ✓
         ├─ requestVersion++  (now = 4)
         └─ Fetch UNIC icon (Request #4, version: 4)

t=100ms: User types "I"
         └─ pendingRequests.has("UNI") = true
             └─ SKIP fetch, reuse existing promise ✓

t=200ms: Request #1 (USDC, version: 1) completes
         ├─ Check: Is version 1 > current cached version?
         ├─ No cached version yet, so store it
         ├─ But UNI is not in the current search results
         └─ No re-render triggered for USDC ✓

t=250ms: Request #3 (UNI, version: 3) completes
         ├─ Check: Is version 3 > current cached version?
         ├─ Yes! Store UNI icon with version: 3
         ├─ UNI is in current search results
         └─ Re-render triggered, shows UNI icon ✓

Result: User sees placeholder → UNI icon (no flicker!)
```

## Request Deduplication Flow

```
┌──────────────────────────────────────────────────────────────────┐
│  PROBLEM: Multiple Components Request Same Icon Simultaneously   │
└──────────────────────────────────────────────────────────────────┘

WITHOUT Deduplication:
────────────────────────────────────────────────────────────────

Component A (TokenInput)        Component B (TokenSearchBar)       Component C (PriceTicker)
     │                                  │                                  │
     │ getIcon(WETH, 1)                │ getIcon(WETH, 1)                │ getIcon(WETH, 1)
     │                                  │                                  │
     ├─ fetch(/api/icon?...)           ├─ fetch(/api/icon?...)           ├─ fetch(/api/icon?...)
     │  Request #1 (50ms)               │  Request #2 (60ms)               │  Request #3 (55ms)
     │                                  │                                  │
     └─> Server load: 3 requests for same icon ❌


WITH Deduplication (Current System):
────────────────────────────────────────────────────────────────

Component A (TokenInput)        Component B (TokenSearchBar)       Component C (PriceTicker)
     │                                  │                                  │
     │ getIcon(WETH, 1)                │ getIcon(WETH, 1)                │ getIcon(WETH, 1)
     │                                  │                                  │
     ├─ pendingRequests.get(key)       ├─ pendingRequests.get(key)       ├─ pendingRequests.get(key)
     │  ❌ Not found                    │  ✅ FOUND (from A!)              │  ✅ FOUND (from A!)
     │                                  │                                  │
     ├─ Create new fetch                │  Return existing promise         │  Return existing promise
     │  Store in pendingRequests        │                                  │
     │                                  │                                  │
     ├─ fetch(/api/icon?...)           │                                  │
     │  Request #1 (50ms)               │  (wait for Request #1)           │  (wait for Request #1)
     │  │                                │  │                                │  │
     │  └─> Response received           │  │                                │  │
     │      ├─ Convert to blob          │  │                                │  │
     │      ├─ Store in cache           │  │                                │  │
     │      └─> pendingRequests.delete  │  │                                │  │
     │                                  │  │                                │  │
     └──────────┬─────────────────────────┴─────────────────────────────────┴──
                │
                └─> ALL THREE COMPONENTS GET SAME RESULT ✓
                    Server load: 1 request instead of 3 ✓
```

## Cache Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ICON CACHE LIFECYCLE                              │
└─────────────────────────────────────────────────────────────────────────┘

Day 0: Server Startup
──────────────────────────────────────────────────────────────────
┌─────────────────────────────────────┐
│  Server starts                       │
│  startBackgroundIconCacher() runs    │
│  ├─ Read tokens.json (250 tokens)   │
│  ├─ Batch fetch: 10 at a time        │
│  ├─ Try 7 sources per token          │
│  ├─ Store in server cache            │
│  └─ Log: "Successfully cached..."    │
└─────────────────────────────────────┘
         │
         └─> Server Cache: 250 icons, TTL: 7 days
         
Hour 1: First Users
──────────────────────────────────────────────────────────────────
┌─────────────────────────────────────┐
│  User A opens dropdown               │
│  ├─ 50 icons needed                  │
│  ├─ Client cache: empty              │
│  ├─ Fetch from server                │
│  ├─ Server cache: HIT (pre-cached!)  │
│  ├─ Client cache: store 50 icons     │
│  └─ Display: <100ms per icon         │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  User B opens dropdown               │
│  ├─ 50 icons needed                  │
│  ├─ Client cache: empty              │
│  ├─ Fetch from server                │
│  ├─ Server cache: HIT (shared!)      │
│  ├─ Client cache: store 50 icons     │
│  └─ Display: <100ms per icon         │
└─────────────────────────────────────┘

Hour 2: Repeat Users
──────────────────────────────────────────────────────────────────
┌─────────────────────────────────────┐
│  User A refreshes page               │
│  ├─ Client cache: expired (memory)   │
│  ├─ Browser disk cache: HIT!         │
│  │   (HTTP 304 Not Modified)         │
│  └─ Display: <5ms per icon ⚡        │
└─────────────────────────────────────┘

Day 1: Cache Still Fresh
──────────────────────────────────────────────────────────────────
┌─────────────────────────────────────┐
│  Cache version changes (daily)       │
│  ├─ v=19376 → v=19377                │
│  ├─ Browser re-fetches icons         │
│  ├─ Server cache: still valid        │
│  └─ Fast response (server cache hit) │
└─────────────────────────────────────┘

Day 7: Cache Expiry
──────────────────────────────────────────────────────────────────
┌─────────────────────────────────────┐
│  Server cache expires                │
│  ├─ Next request: cache miss         │
│  ├─ Fetch from external sources      │
│  ├─ Update server cache (new 7 days) │
│  └─ Continue serving                 │
└─────────────────────────────────────┘

Hourly: Background Refresh
──────────────────────────────────────────────────────────────────
┌─────────────────────────────────────┐
│  Every 60 minutes                    │
│  ├─ Check all tokens in tokens.json  │
│  ├─ Refresh icons older than 6 days  │
│  ├─ Proactive external fetch         │
│  └─ Update server cache              │
└─────────────────────────────────────┘

Hourly: Client Cleanup
──────────────────────────────────────────────────────────────────
┌─────────────────────────────────────┐
│  Every 60 minutes (client-side)     │
│  ├─ iconCache.cleanup() runs         │
│  ├─ Remove expired entries           │
│  ├─ Revoke old blob URLs             │
│  └─ Free memory                      │
└─────────────────────────────────────┘
```

## Memory and Network Analysis

```
┌────────────────────────────────────────────────────────────────┐
│               RESOURCE USAGE COMPARISON                         │
└────────────────────────────────────────────────────────────────┘

Scenario: 100 Users, 250 Tokens Available, Users View 50 Each
───────────────────────────────────────────────────────────────────

OLD SYSTEM (No Shared Cache):
═══════════════════════════════════════════════════════════════════
Network Requests:
  - External API calls: 100 users × 50 tokens = 5,000 requests
  - Server requests: 5,000 requests
  - Total bandwidth: ~250 MB (50 KB × 5,000)
  
Response Times:
  - External fetch: 500-2000ms per icon
  - User experience: Slow, inconsistent
  
Server Memory:
  - No caching: 0 MB
  
Client Memory:
  - Per user: ~2.5 MB (50 icons × 50 KB)
  - Total: 250 MB across 100 users


NEW SYSTEM (Shared Cache):
═══════════════════════════════════════════════════════════════════
Network Requests (First Hour):
  - External API calls: 250 requests (pre-cache) + ~0 for users
  - Server requests: 100 users × 50 tokens = 5,000 requests (internal)
  - External bandwidth: ~12.5 MB (250 icons × 50 KB)
  - Internal bandwidth: ~250 MB (served from server cache)
  - REDUCTION: 98% fewer external API calls
  
Network Requests (Subsequent Hours):
  - External API calls: ~0 (cache valid for 7 days)
  - Server requests: 5,000 (but served from memory)
  - Browser requests: ~0 (browser disk cache hits)
  - REDUCTION: 99.9% fewer requests
  
Response Times:
  - Server cache hit: 10-20ms per icon ⚡
  - Browser cache hit: <1ms per icon ⚡⚡
  - User experience: Instant, consistent
  
Server Memory:
  - Icon cache: ~12.5 MB (250 icons × 50 KB)
  - Acceptable: Yes (minimal)
  
Client Memory:
  - Per user: ~2.5 MB (50 icons × 50 KB)
  - Total: 250 MB across 100 users (same as old)


BENEFITS:
═══════════════════════════════════════════════════════════════════
✓ 98% reduction in external API calls
✓ 99% reduction in external bandwidth
✓ 50-200x faster icon loading (20ms vs 1000ms)
✓ Consistent performance across all users
✓ No rate limiting issues
✓ Minimal server memory overhead (12.5 MB)
```

---

**System Architect**: Dr. Ahmed Mohamed  
**Documentation**: Icon Caching System Architecture  
**Purpose**: Visual reference for understanding system design  
