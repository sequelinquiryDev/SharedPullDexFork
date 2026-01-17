# Icon Cache Troubleshooting Guide

## Quick Diagnostics

### Check Cache Status

**Client-Side (Browser Console)**:
```javascript
// Get cache statistics
iconCache.getStats()
// Expected output: { cacheSize: 50-200, pendingRequests: 0-5, currentVersion: 100+ }

// Manually check if an icon is cached
const wethAddr = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const chainId = 1;
const url = iconCache.getIconSync(wethAddr, chainId);
console.log(url); // Should be blob URL or placeholder
```

**Server-Side (Server Logs)**:
```bash
# Look for these log messages:
[IconCacher] Immediately checking 250 tokens for icon refresh...
[IconCacher] Successfully cached icon for WETH (0xc02aa...)
[IconCacher] Initial caching cycle complete.

# If missing, background cacher didn't run
```

---

## Common Issues

### Issue #1: Icons Show Placeholder Forever

**Symptoms**:
- All icons show gray "?" placeholder
- Icons never load even after waiting

**Diagnosis Steps**:

1. **Check Network Tab**:
   ```
   DevTools → Network → Filter: /api/icon
   - Look for 404 responses (icon not available)
   - Look for 500 responses (server error)
   - Look for timeouts (network issue)
   ```

2. **Check Server Logs**:
   ```bash
   # Look for errors:
   [IconCache] Global error for 0x...
   [IconCacher] Failed to cache icon for TOKEN after trying all sources
   ```

3. **Check External Sources**:
   ```bash
   # Test TrustWallet manually:
   curl -I https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png
   # Should return 200 OK
   
   # If 403 or 429: Rate limiting issue
   # If timeout: Network issue
   ```

**Solutions**:

**A. Add Custom logoURI** (Recommended):
```json
// In client/src/lib/tokens.json
{
  "ethereum": [
    {
      "address": "0xYOURTOKEN",
      "symbol": "TOKEN",
      "decimals": 18,
      "name": "My Token",
      "logoURI": "https://yourdomain.com/token-icon.png"  // ← Add this
    }
  ]
}
```

**B. Restart Server** (Forces fresh fetch):
```bash
npm run dev
# Wait for "Initial caching cycle complete" in logs
```

**C. Check Token Address** (Verify correct format):
```javascript
// Address must be valid ERC-20 address
const ethers = require('ethers');
const checksumAddr = ethers.utils.getAddress(address);
console.log(checksumAddr); // Must not throw error
```

---

### Issue #2: Icons Load Slowly (3-5 seconds)

**Symptoms**:
- Icons eventually load, but take a long time
- Happens for some tokens, not all

**Diagnosis Steps**:

1. **Check Server Cache**:
   ```javascript
   // Look at Network tab timing:
   // Server cache hit: 10-50ms
   // Server cache miss: 500-5000ms
   
   // If consistently slow, cache not working
   ```

2. **Check Which Source Is Used**:
   ```bash
   # Server logs show source URL:
   [IconCacher] Successfully cached icon for WETH
   # Check if it's using slow source (CoinGecko API)
   ```

3. **Test External Sources**:
   ```bash
   # Time each source:
   time curl https://raw.githubusercontent.com/trustwallet/assets/...
   time curl https://assets-cdn.trustwallet.com/...
   time curl https://api.coingecko.com/api/v3/coins/...
   
   # Identify which is slow
   ```

**Solutions**:

**A. Pre-Cache at Server Startup** (Already enabled):
```typescript
// This should already be running in server/routes.ts:
startBackgroundIconCacher();
// Check logs to confirm it completed
```

**B. Add High-Priority logoURIs**:
```json
// Use fast, reliable CDN URLs
{
  "logoURI": "https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png"
}
```

**C. Increase Timeout** (Not recommended, but possible):
```typescript
// In server/routes.ts, line 161:
const response = await fetch(source, { signal: AbortSignal.timeout(5000) });
// Change 5000 to 10000 if external sources are consistently slow
```

---

### Issue #3: Icons Flicker or Show Wrong Icon Briefly

**Symptoms**:
- Correct icon appears, but wrong icon shows first
- Icons change rapidly during search

**Diagnosis**:

This should NOT happen with current system. If it does:

1. **Check iconCache Version**:
   ```javascript
   // Client console:
   console.log(iconCache);
   // Should have requestVersion property
   ```

2. **Verify Race Condition Protection**:
   ```typescript
   // In client/src/lib/iconCache.ts
   // Line 82 should have:
   const version = ++this.requestVersion;
   
   // Line 130-142 should have version checking
   ```

**Solutions**:

**A. Update Code** (If using old version):
```bash
git pull origin main
npm install
npm run dev
```

**B. Clear Caches**:
```javascript
// Browser console:
iconCache.cancelAllRequests();
iconCache.cleanup();
// Then refresh page
```

---

### Issue #4: Icons Don't Persist Between Page Refreshes

**Symptoms**:
- Icons load fast on first page load
- Page refresh requires re-fetching (takes 100-200ms)
- Expected instant loading from browser cache

**Diagnosis**:

1. **Check Browser Cache Settings**:
   ```
   DevTools → Network → /api/icon request
   - Look at Response Headers
   - Should see: Cache-Control: public, max-age=604800
   
   - Look at Status column
   - Should see: 304 Not Modified (cached)
   - If 200 OK: Cache not working
   ```

2. **Check Private Browsing**:
   ```
   Browser in private/incognito mode?
   - Private mode doesn't persist cache to disk
   - Solution: Use normal browsing mode
   ```

3. **Check Cache Storage**:
   ```
   DevTools → Application → Storage → Cache Storage
   - Should see cached responses
   - If empty: Browser not caching
   ```

**Solutions**:

**A. Verify Cache Headers** (Server):
```typescript
// In server/routes.ts, line 855:
res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
// Verify this line exists
```

**B. Check Browser Settings**:
```
Chrome: Settings → Privacy → Clear browsing data
- Ensure "Cached images and files" is NOT auto-clearing
```

**C. Use Service Worker** (Advanced):
```typescript
// Optional: Add service worker to force cache
// Not implemented yet, but would improve persistence
```

---

### Issue #5: Memory Leak - Icons Consuming Too Much Memory

**Symptoms**:
- Browser becomes slow over time
- Memory usage increases
- Page eventually crashes

**Diagnosis**:

1. **Check Blob URL Leaks**:
   ```javascript
   // Browser console:
   iconCache.getStats()
   // If cacheSize > 1000: Likely leak
   ```

2. **Check Cleanup Runs**:
   ```javascript
   // Look for log messages every hour:
   [IconCache] Cleaned up 12 expired entries
   // If missing, cleanup not running
   ```

**Solutions**:

**A. Manual Cleanup**:
```javascript
// Browser console:
iconCache.cleanup();
iconCache.getStats(); // Verify cacheSize reduced
```

**B. Verify Cleanup Interval**:
```typescript
// In client/src/lib/iconCache.ts, line 261-267:
setInterval(() => {
  iconCache.cleanup();
}, CLEANUP_INTERVAL_MS);
// Should be running automatically
```

**C. Force Page Refresh**:
```
Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
// Clears in-memory cache
```

---

### Issue #6: Icons Work on Ethereum but Not Polygon (or vice versa)

**Symptoms**:
- Icons load fine on chainId=1 (Ethereum)
- Icons fail on chainId=137 (Polygon)
- Or the reverse

**Diagnosis**:

1. **Check Chain-Specific Config**:
   ```typescript
   // In server/routes.ts, line 122:
   const chainPath = chainId === 1 ? 'ethereum' : 'polygon';
   // Verify chainPath is correct
   ```

2. **Test External Sources**:
   ```bash
   # Ethereum icon:
   curl https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png
   
   # Polygon icon:
   curl https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270/logo.png
   
   # Check which fails
   ```

3. **Check tokens.json**:
   ```json
   {
     "ethereum": [...],  // Must have tokens
     "polygon": [...]    // Must have tokens
   }
   ```

**Solutions**:

**A. Add Chain-Specific logoURIs**:
```json
{
  "polygon": [
    {
      "address": "0x...",
      "logoURI": "https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png"
    }
  ]
}
```

**B. Verify Background Cacher Includes Both Chains**:
```typescript
// In server/routes.ts, line 63-65:
const ethereumTokens = tokens.ethereum || [];
const polygonTokens = tokens.polygon || [];
const allTokens = [...ethereumTokens, ...polygonTokens];
// Should include both
```

---

## Monitoring and Debugging Tools

### 1. Client-Side Monitoring

**Check Cache Health**:
```javascript
// Run in browser console periodically
setInterval(() => {
  const stats = iconCache.getStats();
  console.log('Cache Stats:', stats);
  
  if (stats.pendingRequests > 10) {
    console.warn('High pending requests - network may be slow');
  }
  
  if (stats.cacheSize > 500) {
    console.warn('Large cache size - consider cleanup');
    iconCache.cleanup();
  }
}, 60000); // Every minute
```

**Monitor Fetch Failures**:
```javascript
// Intercept fetch to log failures
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (args[0].includes('/api/icon') && !response.ok) {
    console.error('Icon fetch failed:', args[0], response.status);
  }
  return response;
};
```

### 2. Server-Side Monitoring

**Add Cache Metrics Endpoint**:
```typescript
// In server/routes.ts, add:
app.get('/api/cache-stats', (req, res) => {
  res.json({
    iconCacheSize: iconCache.size,
    oldestIcon: Array.from(iconCache.values())
      .sort((a, b) => a.expires - b.expires)[0]?.expires,
    newestIcon: Array.from(iconCache.values())
      .sort((a, b) => b.expires - a.expires)[0]?.expires,
  });
});
```

**Log Cache Performance**:
```typescript
// Add timing logs:
const startTime = Date.now();
const base64 = await fetchAndBase64Icon(address, chainId);
const elapsed = Date.now() - startTime;

if (elapsed > 1000) {
  console.warn(`Slow icon fetch: ${symbol} took ${elapsed}ms`);
}
```

### 3. Network Analysis

**Check Request Efficiency**:
```javascript
// Browser console:
// Count icon requests in last 5 minutes
const iconRequests = performance.getEntriesByType('resource')
  .filter(r => r.name.includes('/api/icon'))
  .filter(r => r.startTime > performance.now() - 300000);

console.log(`Icon requests: ${iconRequests.length}`);
console.log(`Unique icons: ${new Set(iconRequests.map(r => r.name)).size}`);
console.log(`Duplicates: ${iconRequests.length - new Set(iconRequests.map(r => r.name)).size}`);

// Duplicates should be 0 (deduplication working)
```

---

## Performance Benchmarks

### Expected Performance Metrics

```
Icon Load Times:
──────────────────────────────────────────────────────────
Client cache hit:         <1ms       ✓ Best case
Browser disk cache:       1-5ms      ✓ Excellent
Server cache hit:         10-50ms    ✓ Good
Server cache miss:        500-2000ms ⚠️  Rare, acceptable
Timeout/failure:          5000ms+    ❌ Error case

Cache Hit Rates:
──────────────────────────────────────────────────────────
Server cache (1st hour):  95%+       ✓ Pre-cache working
Server cache (steady):    98%+       ✓ Expected
Client cache (1st load):  0%         ✓ Normal (cold start)
Client cache (2nd load):  98%+       ✓ Expected
Browser cache (refresh):  95%+       ✓ Headers working

Network Efficiency:
──────────────────────────────────────────────────────────
External API calls:       <100/hour  ✓ Good (per 100 users)
Server requests:          5000/hour  ✓ Normal (100 users)
Bandwidth saved:          98%+       ✓ Excellent

Memory Usage:
──────────────────────────────────────────────────────────
Server icon cache:        10-50 MB   ✓ Acceptable
Client icon cache:        2-5 MB     ✓ Normal
Pending requests:         0-5        ✓ Good
```

### When to Worry

```
⚠️  Client cache hit rate < 90% after 1 hour
    → Check if cleanup is too aggressive
    → Increase CACHE_TTL if needed

⚠️  Server cache hit rate < 85% in steady state
    → Background cacher may not be running
    → Check server logs for errors

⚠️  Average icon load time > 200ms
    → Check network latency to server
    → Verify server cache is populated

❌ Memory usage > 100 MB (server)
    → Too many tokens or cache not expiring
    → Force cleanup or reduce CACHE_TTL

❌ Pending requests > 20
    → Network is extremely slow or blocked
    → Check for network issues or rate limiting
```

---

## Quick Fixes Summary

| Problem | Quick Fix | Details |
|---------|-----------|---------|
| Icons don't load | Add logoURI to tokens.json | See Issue #1 Solution A |
| Icons load slowly | Restart server, wait for pre-cache | See Issue #2 Solution A |
| Icons flicker | Update code to latest version | See Issue #3 Solution A |
| Icons re-fetch on refresh | Check browser cache settings | See Issue #4 Solution B |
| Memory leak | Run `iconCache.cleanup()` | See Issue #5 Solution A |
| Chain-specific failures | Add chain-specific logoURIs | See Issue #6 Solution A |
| High latency | Check network tab for slow requests | Use DevTools profiling |
| Server cache not working | Check logs for background cacher | Look for "Initial caching cycle complete" |

---

## Getting Help

If issues persist after trying these solutions:

1. **Collect Diagnostics**:
   ```javascript
   // Browser console:
   const diagnostics = {
     clientStats: iconCache.getStats(),
     networkRequests: performance.getEntriesByType('resource')
       .filter(r => r.name.includes('/api/icon'))
       .length,
     cacheKeys: Array.from(iconCache.cache?.keys?.() || []),
   };
   console.log(JSON.stringify(diagnostics, null, 2));
   ```

2. **Check Server Logs**:
   ```bash
   # Look for errors or warnings:
   grep -i "error\|warn" server.log | grep -i icon
   ```

3. **Test External Sources**:
   ```bash
   # Verify external APIs are accessible:
   curl -I https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png
   curl -I https://api.coingecko.com/api/v3/ping
   ```

4. **Report Issue** with:
   - Browser and version
   - Server logs (relevant excerpts)
   - Client diagnostics output
   - Steps to reproduce
   - Network conditions

---

**Last Updated**: Based on current implementation  
**Maintainer**: Dr. Ahmed Mohamed  
**Related Docs**: 
- [ICON_CACHE_SYSTEM_EXPLAINED.md](./ICON_CACHE_SYSTEM_EXPLAINED.md)
- [ICON_CACHE_ARCHITECTURE.md](./ICON_CACHE_ARCHITECTURE.md)
- [ICON_CACHE_IMPLEMENTATION.md](./ICON_CACHE_IMPLEMENTATION.md)
