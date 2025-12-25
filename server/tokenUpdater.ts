import fs from "fs";
import path from "path";

const COINGECKO_API_KEY = process.env.VITE_COINGECKO_API_KEY || "";

async function fetchTokens(chainId: number, platform: string, limit: number) {
  try {
    const baseUrl = "https://api.coingecko.com/api/v3";
    const authParam = COINGECKO_API_KEY ? `&x_cg_demo_api_key=${COINGECKO_API_KEY}` : "";
    
    const pages = [1, 2];
    const allTokens = [];

    for (const page of pages) {
      const url = `${baseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`;
      console.log(`Fetching page ${page} from: ${url}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        const err = await response.text();
        console.error(`Page ${page} error: ${response.status} - ${err}`);
        continue;
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        allTokens.push(...data);
      }
    }
    
    const mapped = allTokens.map((coin: any) => {
      // Try multiple platform keys for compatibility
      let address = null;
      
      // Standard CoinGecko platform names
      if (platform === "ethereum") {
        address = coin.platforms?.["ethereum"] || coin.platforms?.["ethereum-mainnet"];
      } else if (platform === "polygon-pos" || platform === "polygon") {
        address = coin.platforms?.["polygon-pos"] || coin.platforms?.["matic"] || coin.platforms?.["polygon"];
      } else {
        address = coin.platforms?.[platform];
      }
      
      if (!address || address === "") return null;
      
      return {
        address: address.toLowerCase(),
        name: coin.name,
        symbol: coin.symbol.toUpperCase(),
        decimals: 18,
        chainId,
        logoURI: coin.image
      };
    }).filter((t: any) => t !== null);

    console.log(`Mapped ${mapped.length} tokens for ${platform}`);
    return mapped.slice(0, limit);
  } catch (error) {
    console.error(`Error fetching ${platform} tokens:`, error);
    return [];
  }
}

export async function updateTokenLists() {
  console.log("Updating token lists (450 per chain)...");
  const ethTokens = await fetchTokens(1, "ethereum", 450);
  
  // Add delay to avoid rate limiting
  await new Promise(r => setTimeout(r, 2000));
  
  const polTokens = await fetchTokens(137, "polygon-pos", 450);
  
  if (ethTokens.length > 0) {
    fs.writeFileSync(path.join(process.cwd(), "eth-tokens.json"), JSON.stringify(ethTokens, null, 2));
    console.log(`Saved ${ethTokens.length} ETH tokens`);
  } else {
    console.warn("No ETH tokens fetched, keeping existing file if available");
  }
  
  if (polTokens.length > 0) {
    fs.writeFileSync(path.join(process.cwd(), "polygon-tokens.json"), JSON.stringify(polTokens, null, 2));
    console.log(`Saved ${polTokens.length} POL tokens`);
  } else {
    console.warn("No Polygon tokens fetched, keeping existing file if available");
  }
}
