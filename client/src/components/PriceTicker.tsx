import { useState, useEffect } from 'react';
import { getTopTokens, getCgStatsMap } from '@/lib/tokenService';
import { formatUSD, low } from '@/lib/config';

interface TickerToken {
  symbol: string;
  price: number;
  change: number;
  logoURI: string;
  marketCap: number;
  address: string; // Added address to TickerToken interface
}

// Mocking functions that are likely used in the provided changes snippet
// In a real scenario, these would be imported and correctly implemented.
const loadTokensAndMarkets = async (): Promise<Map<string, any>> => {
  // This is a placeholder. Replace with actual implementation.
  console.log('loadTokensAndMarkets called');
  return new Map();
};

// Mock state setter for demonstration purposes
const setTickerTokens = (tokens: TickerToken[]) => {
  console.log('setTickerTokens called with:', tokens.length, 'tokens');
};


export function PriceTicker() {
  const [tokens, setTokens] = useState<TickerToken[]>([]);

  useEffect(() => {
    const fetchTickerData = async () => {
      try {
        // Assuming loadTokensAndMarkets returns a Map where keys are addresses and values are token objects
        // Each token object is assumed to have properties like: address, marketCap, priceChange24h
        const tokensMap = await loadTokensAndMarkets();
        const tokenArray = Array.from(tokensMap.values());

        // Get top 7 by market cap
        const topByMcap = tokenArray
          .filter(t => t.marketCap && t.marketCap > 0)
          .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
          .slice(0, 7);

        // Get top 8 by 24h change (absolute value)
        const topByChange = tokenArray
          .filter(t => typeof t.priceChange24h === 'number' && Math.abs(t.priceChange24h) > 0.1)
          .sort((a, b) => Math.abs(b.priceChange24h || 0) - Math.abs(a.priceChange24h || 0))
          .slice(0, 8);

        // Combine using Set to avoid duplicates
        const addressSet = new Set<string>();
        const uniqueTokens: typeof tokenArray = [];

        [...topByMcap, ...topByChange].forEach(token => {
          const addr = token.address.toLowerCase();
          if (!addressSet.has(addr)) {
            addressSet.add(addr);
            uniqueTokens.push(token);
          }
        });

        console.log('Ticker loaded unique tokens:', uniqueTokens.length);
        // Ensure the state is updated with the correct TickerToken interface
        setTokens(uniqueTokens.map(t => ({
          symbol: t.symbol,
          price: t.price,
          change: t.priceChange24h, // Assuming priceChange24h is what's used for 'change'
          logoURI: t.logoURI || '', // Assuming logoURI is available
          marketCap: t.marketCap,
          address: t.address,
        })));
      } catch (error) {
        console.error('Failed to load ticker data:', error);
      }
    };

    fetchTickerData();
    const interval = setInterval(fetchTickerData, 15000); // Real-time refresh every 15 seconds
    return () => clearInterval(interval);
  }, []);


  if (tokens.length === 0) return null;

  // Duplicate tokens for a continuous scrolling effect
  const displayTokens = [...tokens, ...tokens, ...tokens];

  return (
    <div className="price-ticker-container">
      <div className="price-ticker-track">
        {displayTokens.map((token, idx) => (
          <div key={`${token.symbol}-${idx}`} className="ticker-item">
            {token.logoURI && (
              <img
                src={token.logoURI}
                alt={token.symbol}
                className="ticker-logo"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <span className="ticker-symbol">{token.symbol}</span>
            <span className="ticker-price">{formatUSD(token.price)}</span>
            <span
              className="ticker-change"
              style={{
                color: token.change >= 0 ? '#9ef39e' : '#ff9e9e',
              }}
            >
              {token.change >= 0 ? '+' : ''}
              {token.change.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}