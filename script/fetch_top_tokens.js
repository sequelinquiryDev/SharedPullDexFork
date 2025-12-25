const axios = require('axios');
const fs = require('fs');

const CG_API_KEY = process.env.VITE_COINGECKO_API_KEY;
const CMC_API_KEY = process.env.VITE_CMC_API_KEY;

async function fetchTokens() {
  const tokens = {
    ethereum: [],
    polygon: []
  };

  try {
    // Fetch Ethereum Top 250 from CoinGecko
    const ethResponse = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        category: 'ethereum-ecosystem',
        order: 'market_cap_desc',
        per_page: 250,
        page: 1,
        sparkline: false,
        x_cg_pro_api_key: CG_API_KEY
      }
    });
    tokens.ethereum = ethResponse.data.map(t => ({
      symbol: t.symbol.toUpperCase(),
      name: t.name,
      address: t.platforms?.ethereum || '',
      decimals: 18, // Default, would need contract call for accuracy but CG provides basic info
      logoURI: t.image
    })).filter(t => t.address);

    // Fetch Polygon Top 250 from CoinGecko
    const polyResponse = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        category: 'polygon-ecosystem',
        order: 'market_cap_desc',
        per_page: 250,
        page: 1,
        sparkline: false,
        x_cg_pro_api_key: CG_API_KEY
      }
    });
    tokens.polygon = polyResponse.data.map(t => ({
      symbol: t.symbol.toUpperCase(),
      name: t.name,
      address: t.platforms?.['polygon-pos'] || '',
      decimals: 18,
      logoURI: t.image
    })).filter(t => t.address);

    fs.writeFileSync('client/src/lib/tokens.json', JSON.stringify(tokens, null, 2));
    console.log('Successfully generated client/src/lib/tokens.json');
  } catch (error) {
    console.error('Error fetching tokens:', error.message);
  }
}

fetchTokens();
