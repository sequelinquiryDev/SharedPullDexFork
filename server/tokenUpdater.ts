import fs from "fs";
import path from "path";

// Token updates are triggered only when users add new tokens
// This keeps tokens.json in sync with dynamically added tokens
export function ensureTokenListExists() {
  const tokensPath = path.join(process.cwd(), "client", "src", "lib", "tokens.json");
  
  if (!fs.existsSync(tokensPath)) {
    const defaultTokens = {
      ethereum: [
        { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ethereum", decimals: 18, logoURI: "https://assets.coingecko.com/coins/images/279/large/ethereum.png" },
        { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", name: "USDC", decimals: 6, logoURI: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" }
      ],
      polygon: [
        { address: "0x0000000000000000000000000000000000001010", symbol: "MATIC", name: "Polygon", decimals: 18, logoURI: "https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png" },
        { address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", symbol: "USDC", name: "USDC", decimals: 6, logoURI: "https://assets.coingecko.com/coins/images/6319/large/usdc.png" }
      ]
    };
    fs.writeFileSync(tokensPath, JSON.stringify(defaultTokens, null, 2));
    console.log("[TokenUpdater] Created default tokens.json");
  }
}
