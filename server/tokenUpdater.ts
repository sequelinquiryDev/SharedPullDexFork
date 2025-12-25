import fs from "fs";
import path from "path";
import axios from "axios";

const CMC_API_KEY = process.env.VITE_CMC_API_KEY || "";
const COINGECKO_API_KEY = process.env.VITE_COINGECKO_API_KEY || "";

async function fetchCMC(chainId: number) {
  if (!CMC_API_KEY) return [];
  try {
    const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest', {
      params: { limit: 1000, convert: 'USD', aux: 'platform,symbol,name' },
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY, 'Accept': 'application/json' }
    });
    const platformId = chainId === 1 ? 1 : 137;
    return response.data.data
      .filter((c: any) => (c.platform?.id === platformId || c.platform?.name?.toLowerCase() === (chainId === 1 ? 'ethereum' : 'polygon')) && c.platform?.token_address)
      .map((c: any) => ({
        address: c.platform.token_address.toLowerCase(),
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        marketCap: c.quote.USD.market_cap,
        logoURI: `https://s2.coinmarketcap.com/static/img/coins/64x64/${c.id}.png`,
        decimals: 18
      }));
  } catch (e: any) {
    console.error(`CMC error ${chainId}:`, e.message);
    return [];
  }
}

async function fetchCG(platform: string) {
  const tokens: any[] = [];
  const baseUrl = 'https://api.coingecko.com/api/v3';
  const headers = COINGECKO_API_KEY ? { 'x-cg-demo-api-key': COINGECKO_API_KEY } : {};
  try {
    for (let page = 1; page <= 5; page++) {
      const url = `${baseUrl}/coins/markets?vs_currency=usd&category=${platform}-ecosystem&order=market_cap_desc&per_page=250&page=${page}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json() as any[];
        if (!data || data.length === 0) break;
        tokens.push(...data.map((c: any) => {
          const addr = (c.platforms?.[platform === 'ethereum' ? 'ethereum' : 'polygon-pos'] || '').toLowerCase();
          if (!addr) return null;
          return {
            address: addr, symbol: c.symbol.toUpperCase(), name: c.name, marketCap: c.market_cap, logoURI: c.image, decimals: 18
          };
        }).filter((t: any) => t !== null));
      } else { break; }
    }
  } catch (e) { console.error(`CG error ${platform}:`, e); }
  return tokens;
}

const ETH_FALLBACK = [
  { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ethereum", decimals: 18, logoURI: "https://assets.coingecko.com/coins/images/279/large/ethereum.png" },
  { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", name: "USDC", decimals: 6, logoURI: "https://assets.coingecko.com/coins/images/6319/large/USD_Coin_icon.png" },
  { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", name: "Tether", decimals: 6, logoURI: "https://assets.coingecko.com/coins/images/325/large/tether.png" },
  { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, logoURI: "https://assets.coingecko.com/coins/images/11224/large/wbtc.png" },
  { address: "0x514910771af9ca656af840dff83e8264ecf986ca", symbol: "LINK", name: "Chainlink", decimals: 18, logoURI: "https://assets.coingecko.com/coins/images/877/large/chainlink.png" }
];

const POL_FALLBACK = [
  { address: "0x0000000000000000000000000000000000001010", symbol: "MATIC", name: "Polygon", decimals: 18, logoURI: "https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png" },
  { address: "0x2791bca1f2de4661ed88a30c99a7a9449Aa84174", symbol: "USDC", name: "USDC", decimals: 6, logoURI: "https://assets.coingecko.com/coins/images/6319/large/USD_Coin_icon.png" },
  { address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", symbol: "USDT", name: "Tether", decimals: 6, logoURI: "https://assets.coingecko.com/coins/images/325/large/tether.png" },
  { address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logoURI: "https://assets.coingecko.com/coins/images/2518/large/weth.png" },
  { address: "0x1bfd67037b42cf73acf2047dae91a29e822c1f35", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8, logoURI: "https://assets.coingecko.com/coins/images/11224/large/wbtc.png" }
];

export async function updateTokenLists() {
  console.log("Updating local tokens.json...");
  const [ethCMC, polCMC, ethCG, polCG] = await Promise.all([fetchCMC(1), fetchCMC(137), fetchCG('ethereum'), fetchCG('polygon')]);
  const dedupe = (list1: any[], list2: any[], fallback: any[]) => {
    const combined = [...list1, ...list2, ...fallback];
    const seen = new Set();
    return combined.filter(t => {
      if (!t.address || seen.has(t.address)) return false;
      seen.add(t.address);
      return true;
    }).sort((a,b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 250);
  };
  const ethereum = dedupe(ethCMC, ethCG, ETH_FALLBACK);
  const polygon = dedupe(polCMC, polCG, POL_FALLBACK);
  fs.writeFileSync(path.join(process.cwd(), "client", "src", "lib", "tokens.json"), JSON.stringify({ ethereum, polygon }, null, 2));
  console.log(`Saved ${ethereum.length} ETH and ${polygon.length} POL tokens.`);
}
