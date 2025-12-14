
import { useState, useEffect, useRef, useCallback } from 'react';
import { useChainId } from 'wagmi';
import { polygon, mainnet } from 'wagmi/chains';
import { Token, TokenStats, searchTokens, getTopTokens, getPlaceholderImage, getCgStatsMap } from '@/lib/tokenService';
import { formatUSD, low } from '@/lib/config';

interface TokenSearchBarProps {
  onTokenSelect?: (token: Token) => void;
}

export function TokenSearchBar({ onTokenSelect }: TokenSearchBarProps) {
  const chainId = useChainId();
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ token: Token; stats: TokenStats | null; price: number | null }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearch = useCallback(async (query: string) => {
    if (!query) {
      const topTokens = getTopTokens(15);
      const withPrices = topTokens.map(({ token, stats }) => ({
        token,
        stats,
        price: stats?.price ?? null,
      }));
      setSuggestions(withPrices);
      setShowSuggestions(true);
      return;
    }

    setLoading(true);
    try {
      const results = await searchTokens(query);
      const cgStats = getCgStatsMap();

      const withPrices = results.map((token) => {
        const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || null;
        const price = stats?.price ?? null;
        const marketCap = stats?.price && stats?.volume24h ? (stats.price * stats.volume24h * 1000) : 0;
        return { token, stats, price, marketCap };
      });

      withPrices.sort((a, b) => b.marketCap - a.marketCap);
      setSuggestions(withPrices.slice(0, 15));
      setShowSuggestions(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(value.trim().toLowerCase());
    }, 150);
  };

  const handleFocus = () => {
    handleSearch(searchQuery.trim().toLowerCase());
  };

  const handleSelectToken = (token: Token) => {
    if (onTokenSelect) {
      onTokenSelect(token);
    }
    setSearchQuery('');
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSuggestions]);

  useEffect(() => {
    if (!showSuggestions || suggestions.length === 0) return;

    const updatePrices = () => {
      const cgStats = getCgStatsMap();
      setSuggestions((prev) =>
        prev.map((item) => {
          const stats = cgStats.get(low(item.token.symbol)) || cgStats.get(low(item.token.name)) || item.stats;
          return {
            ...item,
            stats,
            price: stats?.price ?? item.price,
          };
        })
      );
    };

    updatePrices();
    const priceInterval = setInterval(updatePrices, 8000);
    return () => clearInterval(priceInterval);
  }, [showSuggestions]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const currentChain = chainId === mainnet.id ? 'ETH' : 'POL';

  return (
    <div className="token-search-bar-container" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder={`Search ${currentChain} tokens...`}
        value={searchQuery}
        onChange={handleInputChange}
        onFocus={handleFocus}
        className="token-search-input"
      />

      {showSuggestions && (
        <div ref={suggestionsRef} className="token-search-suggestions">
          {loading ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>Loading...</div>
          ) : suggestions.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>No tokens found</div>
          ) : (
            suggestions.map(({ token, stats, price }) => (
              <div
                key={token.address}
                className="suggestion-item"
                onClick={() => handleSelectToken(token)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <div className="suggestion-left">
                  {token.logoURI && <img src={token.logoURI} alt={token.symbol} />}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px' }}>{token.symbol}</div>
                    <div style={{ fontSize: '11px', opacity: 0.7 }}>{token.name}</div>
                  </div>
                </div>
                <div className="suggestion-price-pill">
                  <div style={{ fontSize: '12px', fontWeight: 700 }}>
                    {price ? formatUSD(price) : '—'}
                  </div>
                  {stats?.change !== null && stats?.change !== undefined && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: stats.change >= 0 ? '#9ef39e' : '#ff9e9e',
                      }}
                    >
                      {stats.change >= 0 ? '+' : ''}
                      {stats.change.toFixed(2)}%
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
