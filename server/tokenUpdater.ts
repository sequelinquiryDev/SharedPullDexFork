import fs from "fs";
import path from "path";
import axios from "axios";

const CMC_API_KEY = process.env.VITE_CMC_API_KEY || "";
const COINGECKO_API_KEY = process.env.VITE_COINGECKO_API_KEY || "";

async function fetchCMC(chainId: number) {
  if (!CMC_API_KEY) return [];
  try {
    console.log(`Fetching top tokens for chain ${chainId} from CMC...`);
    const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest', {
      params: {
        limit: 1000, 
        convert: 'USD'
      },
      headers: {
        'X-CMC_PRO_API_KEY': CMC_API_KEY,
        'Accept': 'application/json'
      }
    });

    const cmcChainName = chainId === 1 ? 'Ethereum' : 'Polygon';
    
    return response.data.data
      .filter((c: any) => c.platform?.name === cmcChainName && c.platform?.token_address)
      .map((c: any) => ({
        address: c.platform.token_address.toLowerCase(),
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        marketCap: c.quote.USD.market_cap,
        logoURI: `https://s2.coinmarketcap.com/static/img/coins/64x64/${c.id}.png`,
        decimals: 18
      }));
  } catch (e: any) {
    console.error(`CMC fetch error for chain ${chainId}:`, e.message);
    return [];
  }
}

async function fetchCG(platform: string) {
  const tokens = [];
  const baseUrl = COINGECKO_API_KEY ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  const headers = COINGECKO_API_KEY ? (COINGECKO_API_KEY.startsWith('CG-') ? { 'x-cg-pro-api-key': COINGECKO_API_KEY } : { 'x-cg-demo-api-key': COINGECKO_API_KEY }) : {};
  
  try {
    console.log(`Fetching top tokens for ${platform} from CoinGecko...`);
    for (let page = 1; page <= 5; page++) {
      const url = `${baseUrl}/coins/markets?vs_currency=usd&category=${platform}-ecosystem&order=market_cap_desc&per_page=250&page=${page}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        if (!data || data.length === 0) break;
        tokens.push(...data.map((c: any) => {
          const addr = (c.platforms?.[platform === 'ethereum' ? 'ethereum' : 'polygon-pos'] || '').toLowerCase();
          if (!addr) return null;
          return {
            address: addr,
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            marketCap: c.market_cap,
            logoURI: c.image,
            decimals: 18
          };
        }).filter((t: any) => t !== null));
      } else {
        console.warn(`CG fetch page ${page} failed: ${res.status}`);
        break;
      }
    }
  } catch (e) {
    console.error(`CG fetch error for ${platform}:`, e);
  }
  return tokens;
}

export async function updateTokenLists() {
  console.log("Updating tokens.json with CMC and CoinGecko data...");
  
  const [ethCMC, polCMC, ethCG, polCG] = await Promise.all([
    fetchCMC(1),
    fetchCMC(137),
    fetchCG('ethereum'),
    fetchCG('polygon')
  ]);

  const dedupe = (list1: any[], list2: any[]) => {
    const combined = [...list1, ...list2];
    const seen = new Set();
    
    // Ensure native tokens and USDC are always present if not found
    const result = combined.filter(t => {
      if (!t.address || seen.has(t.address)) return false;
      seen.add(t.address);
      return true;
    }).sort((a,b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 250);

    return result;
  };

  const ethereum = dedupe(ethCMC, ethCG);
  const polygon = dedupe(polCMC, polCG);

  // Fallback to ensure we have at least defaults if API fails
  if (ethereum.length === 0) {
    ethereum.push({
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      name: "Ethereum",
      decimals: 18,
      logoURI: "https://assets.coingecko.com/coins/images/279/large/ethereum.png"
    });
  }
  if (polygon.length === 0) {
    polygon.push({
      address: "0x0000000000000000000000000000000000001010",
      symbol: "MATIC",
      name: "Polygon",
      decimals: 18,
      logoURI: "https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png"
    });
  }

  const tokensData = { ethereum, polygon };
  
  const tokensPath = path.join(process.cwd(), "client", "src", "lib", "tokens.json");
  fs.writeFileSync(tokensPath, JSON.stringify(tokensData, null, 2));

  console.log(`Token list sync complete. Saved ${ethereum.length} ETH and ${polygon.length} POL tokens to tokens.json`);
}
