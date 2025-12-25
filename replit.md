# Token Price Aggregation System - Professional Enhancement

## PROJECT OVERVIEW
- **Type**: Full-stack token search & swap DEX aggregator
- **Chains**: Ethereum (1) & Polygon (137)
- **Current Status**: Order 2 IN PROGRESS - External fallbacks removed, on-chain pricing ready for Order 3
- **Target Scale**: Support 1000+ users searching for different tokens simultaneously

## CRITICAL ORDERS (Execute One by One with User Confirmation)

### ORDER 1: ✅ COMPLETED
**Get Full Understanding & Prepare**
- Analyzed entire codebase
- Identified current implementation structure
- Created comprehensive memory document

### ORDER 2: ✅ COMPLETED (90%)
**Remove External Price Fallbacks & Consolidate Token Lists**

**COMPLETED:**
- ✅ Removed fetchCMCMarketData() from client
- ✅ Removed fetchCoinGeckoMarketData() from client
- ✅ Removed getEnhancedTokenStats() cascade with all fallbacks (DexScreener, GeckoTerminal)
- ✅ Removed fetch0xPrice(), fetch1InchQuotePrice() functions
- ✅ Removed fetchCoingeckoSimple(), fetchDexscreenerPrice(), fetchGeckoTerminalPrice()
- ✅ Removed all external API proxies from server (CoinGecko, CMC, listings, etc)
- ✅ Removed client-side price caching (priceCache Map)
- ✅ Removed server-side general API caching (getCached, setCache functions)
- ✅ Removed source rotation logic (2-minute alternation)
- ✅ Removed background price fetching
- ✅ Updated loadTokensForChain() to ONLY use self-hosted JSON
- ✅ Created polygon-tokens.json with basic structure
- ✅ Updated refreshMarketData() to use WebSocket only

**REMAINING FOR ORDER 2:**
- ⏳ Download top 500 tokens by MC from CoinGecko for Polygon (need API access)
- ⏳ Download top 500 tokens by MC from CoinGecko for Ethereum (enhance eth-tokens.json)
- ⏳ Merge into single consolidated JSON if needed

**NOTE:** Token API rate limiting prevented live download. User should:
1. Run: `curl -s "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=500&page=1&chain_id=polygon-pos" | python3 -m json.tool > polygon-tokens-500.json`
2. Run: `curl -s "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=500&page=1&chain_id=ethereum" | python3 -m json.tool > eth-tokens-500.json`
3. Format and merge into token lists with proper field mapping

### ORDER 3: PENDING
**Create Professional On-Chain Price Fetcher**
- Use Uniswap V2, Sushi, QuickSwap pools
- Handle real token decimals (no assumptions)
- Support both chains (Polygon & Ethereum)
- Handle flexible pool token ordering
- Fetch from ALL pools simultaneously
- Cache best price, MC, volume for 20 seconds
- Remove old cached prices to prevent contamination
- Professional algo: 500 tokens in 10 sec, 500 in 10 sec = 1K in 20 sec

### ORDER 4: PENDING
**Implement WebSocket Price Streaming**
- Token search → immediate price request when shown in suggestions
- One request per token (shared via WebSocket with other users)
- Dropdown shows cached price/MC/volume from server
- Users subscribe when token appears in suggestions
- Price updates every 8 seconds for subscribed users
- Auto-unsubscribe on token change or 5+ minute absence
- Defaults: Polygon+USDT, Ethereum+USDT

## CODE CHANGES MADE

### client/src/lib/tokenService.ts
- Removed all external data sources (CMC, CoinGecko, DexScreener, GeckoTerminal)
- Removed priceCache Map and related logic
- Removed fetchCMCMarketData, fetchCoinGeckoMarketData, fetchMarketData functions
- Removed loadTokensFromExternalAPIs function
- Removed getEnhancedTokenStats with cascade fallbacks
- Updated getTokenPriceUSD to ONLY call /api/prices/onchain
- Updated loadTokensForChain to ONLY load from self-hosted JSON
- Updated refreshMarketData to reference WebSocket
- Removed historical price fetching from external API

### server/routes.ts
- Removed /api/prices/tokens endpoint
- Removed /api/prices/coingecko/* proxy
- Removed /api/prices/cmc/* proxy
- Removed /api/cmc/listings endpoint
- Removed backgroundPriceCache Map and fetchBackgroundSecondaryPrices()
- Removed source rotation logic
- Removed general API cache (getCached, setCache)

### Token Files
- Created polygon-tokens.json with basic MATIC, USDC, USDT structure
- eth-tokens.json: Preserved (contains ~3500 tokens)

## KEY CONSTRAINTS (All Active)
✅ Backend/WebSocket deploy to Cloudflare  
✅ Deal by: Contract Address + Real Decimals + Chain ID  
✅ NO external API fallbacks  
✅ NO open-source price fallbacks (DexScreener, GeckoTerminal, etc.)  
✅ Use only user's secrets/APIs  
✅ 100% on-chain pricing accuracy & speed  
✅ Keep swap/bridging intact  
✅ Keep icon fallback intact  

## NEXT STEPS

**Immediate:**
1. User downloads top 500 tokens from CoinGecko for Polygon & Ethereum
2. Format and populate polygon-tokens.json and update eth-tokens.json
3. Confirm Order 2 completion

**Then:**
4. Implement Order 3: On-chain price fetcher (Uniswap V2/Sushi/QuickSwap)
5. Implement Order 4: WebSocket price streaming with auto-unsubscribe
