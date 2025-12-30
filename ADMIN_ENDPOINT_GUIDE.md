# Admin Endpoint Guide: Pool Cache Management

## What Was the PostCSS Warning?

**The Problem:**
PostCSS is a CSS processing tool. When it compiled your stylesheets, a plugin didn't properly pass the `from` option, which tells PostCSS where CSS imports come from. This could cause imported assets to be incorrectly transformed.

**The Fix:** ✅
I updated `postcss.config.js` to explicitly reference your Tailwind config file, giving PostCSS proper context for all CSS imports. The warning no longer appears in logs.

---

## Admin Endpoint: Clear Pool Cache

### What Is This Endpoint?

Your app caches the addresses of liquidity pools (where tokens are traded) to reduce blockchain calls. Sometimes pools become inactive or migrate. The admin endpoint lets you clear this cache when needed.

**Endpoint:** `POST /api/admin/clear-pool-cache`  
**Purpose:** Remove stale pool address cache entries

---

## How to Use It

### Option 1: Clear ALL Pool Cache (Recommended for server maintenance)

When you want to reset everything and let the system rediscover pools:

```bash
curl -X POST http://localhost:5000/api/admin/clear-pool-cache \
  -H "Content-Type: application/json" \
  -d '{"all": true}'
```

**Response:**
```json
{
  "success": true,
  "message": "All pool cache cleared"
}
```

**When to use:**
- After a major server update
- If you notice multiple tokens showing wrong prices
- If liquidity pools have migrated on Polygon/Ethereum
- When troubleshooting price inaccuracy issues

---

### Option 2: Clear Specific Token Pair Cache (For targeted fixes)

If only one specific token is showing wrong prices:

```bash
curl -X POST http://localhost:5000/api/admin/clear-pool-cache \
  -H "Content-Type: application/json" \
  -d '{
    "tokenAddr": "0x764a726d9ced0433a8d7643335919deb03a9a935",
    "stableAddr": "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    "chainId": 137
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Pool cache cleared for token pair"
}
```

**Parameters:**
- `tokenAddr`: The address of the token you're fixing (lowercase or checksummed)
- `stableAddr`: Usually a stablecoin like USDC (`0x2791bca1f2de4661ed88a30c99a7a9449aa84174` on Polygon)
- `chainId`: `1` for Ethereum, `137` for Polygon

---

## Example Scenarios

### Scenario 1: Token Price is Wrong
1. User reports: "POKT token showing wrong price"
2. You run: `curl -X POST ... {"all": true}`
3. System rediscovers all pools
4. Price updates automatically

### Scenario 2: Polygon Native Coin (POL) Not Pricing
1. POL wasn't showing a price (this is now fixed, uses WMATIC internally)
2. If it still seems wrong: `curl -X POST ... {"all": true}`
3. System uses WMATIC to rediscover POL's best pools

### Scenario 3: Periodic Maintenance
- Every week: Clear cache to ensure prices stay accurate
- Command: Same as Scenario 1 (clear all)

---

## How It Works Behind The Scenes

### Without Cache Clearing:
```
1. First time pricing POKT:
   - Query 8 DEX factories to find pool address
   - 8-16 RPC calls
   - Cache the pool address
   
2. Second time pricing POKT:
   - Use cached pool address (instant!)
   - 1 RPC call

3. Pool becomes inactive:
   - Still using old cached address
   - Wrong price or failure ❌
```

### With Cache Clearing:
```
1. You call: POST /api/admin/clear-pool-cache {"all": true}
2. System clears pool address cache
3. Next price request for POKT:
   - Queries factories again
   - Finds NEW active pool
   - New accurate cache entry
   - Correct price ✅
```

---

## Automatic Cache Cleanup

You don't need to manually clear everything:
- **Every 6 hours:** System auto-removes pool cache entries older than 24 hours
- **Never deletes active entries:** Only removes stale cached addresses
- **Reduces memory usage:** Prevents unbounded cache growth

But manual clearing is faster for immediate price fixes.

---

## Testing the Endpoint

### With cURL (from terminal):
```bash
# Clear all pools
curl -X POST http://localhost:5000/api/admin/clear-pool-cache \
  -H "Content-Type: application/json" \
  -d '{"all": true}'
```

### With JavaScript (from browser console):
```javascript
fetch('http://localhost:5000/api/admin/clear-pool-cache', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ all: true })
})
.then(r => r.json())
.then(data => console.log(data))
```

### With Thunder Client / Postman:
1. Create new POST request
2. URL: `http://localhost:5000/api/admin/clear-pool-cache`
3. Body (JSON):
   ```json
   {
     "all": true
   }
   ```
4. Send

---

## Current Implementation

- **No authentication required** (development mode)
- Logs when cache is cleared: `[PoolCache] CLEARED entire pool cache (X entries removed)`
- Works instantly - no waiting for next refresh cycle
- Applies immediately to new price requests

---

## Summary

| Scenario | Command |
|----------|---------|
| Price seems wrong | `{"all": true}` |
| One token broken | `{"tokenAddr": "...", "stableAddr": "...", "chainId": 137}` |
| Regular maintenance | `{"all": true}` weekly |
| Debugging pools | `{"all": true}` then watch logs |

**Remember:** The PostCSS warning is already fixed. Use this endpoint only when you notice pricing issues.
