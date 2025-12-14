
import { useState, useEffect, useRef, useCallback } from 'react';
import { Token, TokenStats, searchTokens, getTopTokens, getPlaceholderImage, getCgStatsMap, getTokenByAddress } from '@/lib/tokenService';
import { formatUSD, low, isAddress } from '@/lib/config';
import { useChain } from '@/lib/chainContext';

interface TokenSearchBarProps {
  onTokenSelect?: (token: Token) => void;
}

export function TokenSearchBar({ onTokenSelect }: TokenSearchBarProps) {
  const { chain } = useChain();
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ token: Token & { currentPrice?: number; priceChange24h?: number }; stats: TokenStats | null; price: number | null }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearch = useCallback(async (query: string) => {
    const currentChainId = chain === 'ETH' ? 1 : 137;
    
    if (!query) {
      const topTokens = getTopTokens(15, currentChainId);
      const cgStats = getCgStatsMap(currentChainId);
      const withPrices = topTokens.map(({ token, stats }) => {
        const tokenStats = stats || cgStats.get(low(token.symbol)) || cgStats.get(low(token.name));
        return {
          token: {
            ...token,
            currentPrice: tokenStats?.price ?? undefined,
            priceChange24h: tokenStats?.change ?? undefined,
          },
          stats: tokenStats || null,
          price: tokenStats?.price ?? null,
        };
      });
      setSuggestions(withPrices);
      setShowSuggestions(true);
      return;
    }

    setLoading(true);
    try {
      // Check if query is a token address
      if (isAddress(query)) {
        const token = await getTokenByAddress(query, currentChainId);
        if (token) {
          const cgStats = getCgStatsMap(currentChainId);
          const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || null;
          setSuggestions([{
            token: {
              ...token,
              currentPrice: stats?.price ?? undefined,
              priceChange24h: stats?.change ?? undefined,
            },
            stats,
            price: stats?.price ?? null,
          }]);
          setShowSuggestions(true);
          return;
        }
      }

      const results = await searchTokens(query, currentChainId);
      const cgStats = getCgStatsMap(currentChainId);

      const withPrices = results.map((token) => {
        const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || null;
        const price = stats?.price ?? null;
        const marketCap = stats?.price && stats?.volume24h ? (stats.price * stats.volume24h * 1000) : 0;
        return {
          token: {
            ...token,
            currentPrice: stats?.price ?? undefined,
            priceChange24h: stats?.change ?? undefined,
          },
          stats,
          price,
          marketCap,
        };
      });

      withPrices.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
      setSuggestions(withPrices.slice(0, 15));
      setShowSuggestions(true);
    } finally {
      setLoading(false);
    }
  }, [chain]);

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
      const currentChainId = chain === 'ETH' ? 1 : 137;
      const cgStats = getCgStatsMap(currentChainId);
      setSuggestions((prev) =>
        prev.map((item) => {
          const stats = cgStats.get(low(item.token.symbol)) || cgStats.get(low(item.token.name)) || item.stats;
          return {
            ...item,
            token: {
              ...item.token,
              currentPrice: stats?.price ?? item.token.currentPrice,
              priceChange24h: stats?.change ?? item.token.priceChange24h,
            },
            stats,
            price: stats?.price ?? item.price,
          };
        })
      );
    };

    updatePrices();
    const priceInterval = setInterval(updatePrices, 8000);
    return () => clearInterval(priceInterval);
  }, [showSuggestions, chain]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="token-search-bar-container" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder={`Search ${chain} tokens...`}
        value={searchQuery}
        onChange={handleInputChange}
        onFocus={handleFocus}
        className="token-search-input"
        data-testid="input-main-search"
      />

      {showSuggestions && (
        <div ref={suggestionsRef} className="token-search-suggestions">
          {loading ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>Loading...</div>
          ) : suggestions.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>No {chain} tokens found</div>
          ) : (
            suggestions.map(({ token, stats, price }) => (
              <div
                key={token.address}
                className="suggestion-item"
                onClick={() => handleSelectToken(token)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <div className="suggestion-left">
                  {token.logoURI && (
                    <img 
                      src={token.logoURI} 
                      alt={token.symbol}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = getPlaceholderImage();
                      }}
                    />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px' }}>{token.symbol}</div>
                    <div style={{ fontSize: '11px', opacity: 0.7 }}>{token.name}</div>
                  </div>
                </div>
                <div className="suggestion-price-pill">
                  <div style={{ fontSize: '12px', fontWeight: 700 }}>
                    {token.currentPrice ? formatUSD(token.currentPrice) : '—'}
                  </div>
                  {typeof token.priceChange24h === 'number' && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: token.priceChange24h >= 0 ? '#9ef39e' : '#ff9e9e',
                      }}
                    >
                      {token.priceChange24h >= 0 ? '+' : ''}
                      {token.priceChange24h.toFixed(2)}%
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
