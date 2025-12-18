# Self-Hosted Token Lists

## Overview
This document describes the self-hosted token lists that are served locally from `/public` directory. These token lists are used as the primary data source for displaying tokens in the application and work offline.

## Files
- `eth-tokens.json` - Ethereum mainnet tokens (1531 tokens)
- `polygon-tokens.json` - Polygon mainnet tokens (681 tokens)

## Source & Deduplication
All token lists have been consolidated from the following sources:

### ETH Chain
- https://raw.githubusercontent.com/viaprotocol/tokenlists/main/tokenlists/ethereum.json

### Polygon Chain
- https://raw.githubusercontent.com/viaprotocol/tokenlists/main/tokenlists/polygon.json
- https://api-polygon-tokens.polygon.technology/tokenlists/popular.tokenlist.json
- https://tokenlistooor.com/list/137.json (attempted - fell back to polygon API)

## Deduplication Logic
Tokens are deduplicated based on the combined condition of:
- **NAME** (case-insensitive, trimmed)
- **TICKER/SYMBOL** (case-insensitive, trimmed)
- **TOTAL_SUPPLY** (if available)

When a token appears in multiple sources with identical name, symbol, and total supply, only the first occurrence is kept. This ensures no duplicate fake coins are included in the self-hosted list.

## Token Data Structure
Each token contains:
```json
{
  "name": "Token Name",
  "symbol": "SYMBOL",
  "address": "0x...",
  "decimals": 18,
  "chainId": 1,
  "logoURI": "https://...",
  "coingeckoId": "coin-name-or-empty",
  "totalSupply": ""
}
```

## Usage
These token lists can be:
1. Served directly from `/public` via `GET /eth-tokens.json` and `GET /polygon-tokens.json`
2. Used as fallback sources when external APIs are unavailable
3. Used for offline functionality
4. Updated periodically by re-running the deduplication script

## How to Update
To refresh these token lists:
1. Download fresh token lists from the source URLs
2. Run the deduplication script to remove duplicates
3. Replace the JSON files in `/public`

## Integration Points
The token lists should be integrated into:
- `client/src/lib/tokenService.ts` - As primary/fallback data source
- Token search and suggestion components
- Token swap interfaces

## Generated
- **Date**: December 18, 2025
- **Deduplication**: Based on NAME + SYMBOL + TOTAL_SUPPLY combined
- **Offline Ready**: Yes
- **Self-Hosted**: Yes
