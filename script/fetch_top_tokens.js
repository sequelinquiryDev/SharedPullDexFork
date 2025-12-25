import axios from 'axios';
import fs from 'fs';

const CG_API_KEY = process.env.VITE_COINGECKO_API_KEY;

async function fetchTokens() {
  const tokens = {
    ethereum: [],
    polygon: []
  };

  try {
    const baseUrl = 'https://api.coingecko.com/api/v3';
    
    // Get top coins list with platforms - this is the only way to get addresses for all tokens
    console.log('Fetching all tokens with platforms from CoinGecko...');
    const listResponse = await axios.get(`${baseUrl}/coins/list`, {
      params: { include_platform: true, x_cg_demo_api_key: CG_API_KEY }
    });
    
    // Get market ranking to pick top 250
    console.log('Fetching market rankings...');
    const marketsResponse = await axios.get(`${baseUrl}/coins/markets`, {
      params: { vs_currency: 'usd', order: 'market_cap_desc', per_page: 250, page: 1, x_cg_demo_api_key: CG_API_KEY }
    });

    const topMarketIds = new Set(marketsResponse.data.map(m => m.id));
    const marketInfoMap = new Map(marketsResponse.data.map(m => [m.id, m]));

    for (const coin of listResponse.data) {
      if (topMarketIds.has(coin.id)) {
        const m = marketInfoMap.get(coin.id);
        if (coin.platforms?.ethereum) {
          tokens.ethereum.push({
            address: coin.platforms.ethereum.toLowerCase(),
            symbol: coin.symbol.toUpperCase(),
            name: coin.name,
            decimals: 18,
            logoURI: m.image
          });
        }
        if (coin.platforms?.['polygon-pos']) {
          tokens.polygon.push({
            address: coin.platforms['polygon-pos'].toLowerCase(),
            symbol: coin.symbol.toUpperCase(),
            name: coin.name,
            decimals: 18,
            logoURI: m.image
          });
        }
      }
    }

    // Sort by market cap rank
    tokens.ethereum.sort((a, b) => (marketInfoMap.get(a.symbol.toLowerCase())?.market_cap_rank || 999) - (marketInfoMap.get(b.symbol.toLowerCase())?.market_cap_rank || 999));
    tokens.polygon.sort((a, b) => (marketInfoMap.get(a.symbol.toLowerCase())?.market_cap_rank || 999) - (marketInfoMap.get(b.symbol.toLowerCase())?.market_cap_rank || 999));

    fs.writeFileSync('client/src/lib/tokens.json', JSON.stringify(tokens, null, 2));
    console.log(`Generated tokens.json with ${tokens.ethereum.length} ETH and ${tokens.polygon.length} POL tokens.`);
  } catch (error) {
    console.error('API Error:', error.message);
  }
}

fetchTokens();
