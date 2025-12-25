import fs from "fs";
import path from "path";

const COINGECKO_API_KEY = process.env.VITE_COINGECKO_API_KEY || "";

async function fetchCG(platform: string, pages: number) {
    const tokens = [];
    const auth = COINGECKO_API_KEY ? `&x_cg_demo_api_key=${COINGECKO_API_KEY}` : "";
    for (let i = 1; i <= pages; i++) {
        try {
            const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${i}${auth}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
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
            }
        } catch (e) {
            console.error(`CG fetch error page ${i}:`, e);
        }
    }
    return tokens;
}

export async function updateTokenLists() {
    console.log("Updating 900 tokens (450 ETH, 450 POL) with multi-source metadata...");
    
    const [ethCG, polCG] = await Promise.all([
        fetchCG('ethereum', 2),
        fetchCG('polygon-pos', 2)
    ]);

    const dedupe = (list: any[]) => {
        const seen = new Set();
        return list.filter(t => {
            if (seen.has(t.address)) return false;
            seen.add(t.address);
            return true;
        }).sort((a,b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 450);
    };

    const eth = dedupe(ethCG);
    const pol = dedupe(polCG);

    // Save to server side (filesystem)
    fs.writeFileSync("eth-tokens.json", JSON.stringify(eth, null, 2));
    fs.writeFileSync("polygon-tokens.json", JSON.stringify(pol, null, 2));

    // Save to client src for direct import (to avoid Vite "Assets in public directory" warning)
    const clientSrcDir = path.join(process.cwd(), "client", "src", "assets", "tokens");
    if (!fs.existsSync(clientSrcDir)) fs.mkdirSync(clientSrcDir, { recursive: true });

    fs.writeFileSync(path.join(clientSrcDir, "eth-tokens.json"), JSON.stringify(eth, null, 2));
    fs.writeFileSync(path.join(clientSrcDir, "polygon-tokens.json"), JSON.stringify(pol, null, 2));
    
    // Also save to public for general URL access
    const publicDir = path.join(process.cwd(), "client", "public");
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, "eth-tokens.json"), JSON.stringify(eth, null, 2));
    fs.writeFileSync(path.join(publicDir, "polygon-tokens.json"), JSON.stringify(pol, null, 2));

    console.log(`Token list sync complete. Saved ${eth.length} ETH and ${pol.length} POL tokens.`);
}
