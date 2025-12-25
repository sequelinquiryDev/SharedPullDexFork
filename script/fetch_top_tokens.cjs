const axios = require('axios');
const fs = require('fs');

const CG_API_KEY = process.env.VITE_COINGECKO_API_KEY;

async function fetchTokens() {
  const tokens = {
    ethereum: [],
    polygon: []
  };

  try {
    console.log('Fetching Ethereum Top 250...');
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
      address: t.platforms?.ethereum || '',
      symbol: t.symbol.toUpperCase(),
      name: t.name,
      decimals: 18,
      logoURI: t.image
    })).filter(t => t.address);

    console.log('Fetching Polygon Top 250...');
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
      address: t.platforms?.['polygon-pos'] || '',
      symbol: t.symbol.toUpperCase(),
      name: t.name,
      decimals: 18,
      logoURI: t.image
    })).filter(t => t.address);

    const outputPath = 'client/src/lib/tokens.json';
    fs.writeFileSync(outputPath, JSON.stringify(tokens, null, 2));
    console.log(`Successfully generated ${outputPath} with ${tokens.ethereum.length} ETH tokens and ${tokens.polygon.length} POL tokens.`);
  } catch (error) {
    console.error('Error fetching tokens:', error.response?.data || error.message);
  }
}

fetchTokens();
