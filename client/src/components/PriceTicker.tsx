
import { useState, useEffect, useRef } from 'react';
import { getTopTokens, getCgStatsMap } from '@/lib/tokenService';
import { formatUSD, low } from '@/lib/config';

interface TickerToken {
  symbol: string;
  price: number;
  change: number;
  logoURI: string;
  lastShown: number;
  marketCap: number;
  volume: number;
}

export function PriceTicker() {
  const [tokens, setTokens] = useState<TickerToken[]>([]);
  const tokenPoolRef = useRef<Map<string, TickerToken>>(new Map());
  const lastRotationRef = useRef<number>(Date.now());

  useEffect(() => {
    const loadTickerTokens = () => {
      const topTokens = getTopTokens(50);
      const cgStats = getCgStatsMap();
      
      const withStats = topTokens
        .map(({ token, stats }) => {
          const freshStats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || stats;
          const price = freshStats?.price ?? 0;
          const change = freshStats?.change ?? 0;
          const volume = freshStats?.volume24h ?? 0;
          const marketCap = price && volume ? price * volume * 1000 : 0;
          
          return {
            symbol: token.symbol,
            price,
            change,
            logoURI: token.logoURI || freshStats?.image || '',
            marketCap,
            volume,
            lastShown: tokenPoolRef.current.get(token.symbol)?.lastShown || 0,
          };
        })
        .filter((t) => t.price > 0 && t.change !== null);

      // Update pool
      withStats.forEach(t => tokenPoolRef.current.set(t.symbol, t));

      // Evaluate rotation every 10 minutes
      const now = Date.now();
      if (now - lastRotationRef.current > 600000) {
        lastRotationRef.current = now;
        
        // Re-evaluate tokens for next show
        const eligible = Array.from(tokenPoolRef.current.values()).map(t => ({
          ...t,
          score: (t.marketCap * 0.5) + (Math.abs(t.change) * t.volume * 100),
        }));
        
        eligible.sort((a, b) => b.score - a.score);
        eligible.slice(0, 15).forEach(t => {
          t.lastShown = now;
          tokenPoolRef.current.set(t.symbol, t);
        });
      }

      // Top 7 by market cap
      const topByMarketCap = [...withStats]
        .sort((a, b) => b.marketCap - a.marketCap)
        .slice(0, 7);

      // Top 8 by absolute 24h move %
      const topByMove = [...withStats]
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 8);

      const combined = [...topByMarketCap];
      const seenSymbols = new Set(combined.map((t) => t.symbol));
      
      topByMove.forEach((t) => {
        if (!seenSymbols.has(t.symbol)) {
          combined.push(t);
          seenSymbols.add(t.symbol);
        }
      });

      setTokens(combined);
    };

    loadTickerTokens();
    const priceInterval = setInterval(loadTickerTokens, 8000); // Update prices every 8s

    return () => clearInterval(priceInterval);
  }, []);

  if (tokens.length === 0) return null;

  // Triple tokens for seamless infinite loop
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
