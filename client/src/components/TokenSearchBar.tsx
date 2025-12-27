
import { useState, useEffect, useRef, useCallback } from 'react';
import { Token, TokenStats, searchTokens, getTopTokens, getPlaceholderImage, getCgStatsMap, getTokenByAddress, getTokenLogoUrl, getIconCacheKey } from '@/lib/tokenService';
import { formatUSD, low, isAddress, type OnChainPrice } from '@/lib/config';
import { useChain } from '@/lib/chainContext';
import { useTokenSelection } from '@/lib/tokenSelectionContext';
import { useTypewriter } from '@/hooks/useTypewriter';
import { subscribeToPrice, connectPriceService } from '@/lib/priceService';

interface ExtendedToken extends Token {
  chainId?: number;
}

interface TokenSearchBarProps {
  onTokenSelect?: (token: Token) => void;
}

export function TokenSearchBar({ onTokenSelect }: TokenSearchBarProps) {
  const { chain } = useChain();
  const { selectFromToken } = useTokenSelection();
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ token: ExtendedToken & { currentPrice?: number; priceChange24h?: number }; stats: TokenStats | null; price: number | null }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unsubscribersRef = useRef<Map<string, () => void>>(new Map());
  
  const placeholderTexts = chain === 'BRG' 
    ? ['Search ETH & POL...', 'Search contract address...']
    : [`Search ${chain} tokens...`, `Search contract address...`];
  const typewriterPlaceholder = useTypewriter(placeholderTexts, 60, 30, 900);

  const [suggestionIcons, setSuggestionIcons] = useState<Map<string, string>>(new Map());

  // Fetch icons for all suggestions
  useEffect(() => {
    if (suggestions.length === 0) return;

    const newIcons = new Map(suggestionIcons);
    let changed = false;
    
    suggestions.forEach(({ token }) => {
      const tokenChainId = (token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
      const cacheKey = getIconCacheKey(token.address, tokenChainId);
      
      if (!newIcons.has(cacheKey)) {
        const iconUrl = getTokenLogoUrl(token, tokenChainId);
        newIcons.set(cacheKey, iconUrl);
        changed = true;
      }
    });
    
    if (changed) {
      setSuggestionIcons(newIcons);
    }
  }, [suggestions, chain]);

  const handleSearch = useCallback(async (query: string) => {
    // BRG mode: search both chains; otherwise single chain
    const chainIds = chain === 'BRG' ? [1, 137] : [chain === 'ETH' ? 1 : 137];
    
    if (!query) {
      const allTokens: { token: ExtendedToken & { currentPrice?: number; priceChange24h?: number }; stats: TokenStats | null; price: number | null }[] = [];
      
      for (const cid of chainIds) {
        const topTokens = getTopTokens(chain === 'BRG' ? 8 : 15, cid);
        const cgStats = getCgStatsMap(cid);
        topTokens.forEach(({ token, stats }) => {
          const tokenStats = stats || cgStats.get(low(token.symbol)) || cgStats.get(low(token.name));
          allTokens.push({
            token: {
              ...token,
              chainId: cid,
              currentPrice: tokenStats?.price ?? undefined,
              priceChange24h: tokenStats?.change ?? undefined,
            },
            stats: tokenStats || null,
            price: tokenStats?.price ?? null,
          });
        });
      }
      setSuggestions(allTokens.slice(0, 15));
      setShowSuggestions(true);
      return;
    }

    setLoading(true);
    try {
      const allResults: { token: ExtendedToken & { currentPrice?: number; priceChange24h?: number }; stats: TokenStats | null; price: number | null; marketCap: number }[] = [];
      
      for (const cid of chainIds) {
        // Check if query is a token address
        if (isAddress(query)) {
          const token = await getTokenByAddress(query, cid);
          if (token) {
            const cgStats = getCgStatsMap(cid);
            const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || null;
            allResults.push({
              token: {
                ...token,
                chainId: cid,
                currentPrice: stats?.price ?? undefined,
                priceChange24h: stats?.change ?? undefined,
              },
              stats,
              price: stats?.price ?? null,
              marketCap: stats?.marketCap || 0,
            });
          }
        } else {
          const results = await searchTokens(query, cid);
          const cgStats = getCgStatsMap(cid);

          results.forEach((token) => {
            const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || null;
            const price = stats?.price ?? null;
            const marketCap = stats?.marketCap || (stats?.price && stats?.volume24h ? (stats.price * stats.volume24h * 1000) : 0);
            allResults.push({
              token: {
                ...token,
                chainId: cid,
                currentPrice: stats?.price ?? undefined,
                priceChange24h: stats?.change ?? undefined,
              },
              stats,
              price,
              marketCap,
            });
          });
        }
      }

      // Sort: Top 5 by market cap, rest by 24h volume
      const top5 = allResults.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 5);
      const rest = allResults.slice(5).sort((a, b) => {
        const volA = (a.stats?.volume24h || 0) * (a.stats?.price || 1);
        const volB = (b.stats?.volume24h || 0) * (b.stats?.price || 1);
        return volB - volA;
      });
      setSuggestions([...top5, ...rest].slice(0, 15));
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
    selectFromToken(token);
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
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [showSuggestions]);

  useEffect(() => {
    if (!showSuggestions || suggestions.length === 0) return;

    // Connect to WebSocket and subscribe to prices
    connectPriceService();
    
    // Subscribe to prices for all suggestions
    unsubscribersRef.current.forEach(unsub => unsub());
    unsubscribersRef.current.clear();

    // Fetch server cached prices immediately for all suggestions
    suggestions.forEach(({ token }) => {
      const tokenChainId = (token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
      const subKey = `${tokenChainId}-${token.address.toLowerCase()}`;
      
      // Fetch cached price immediately and display it
      fetch(`/api/prices/onchain?address=${token.address}&chainId=${tokenChainId}`)
        .then(res => res.json())
        .then((priceData: OnChainPrice) => {
          setSuggestions((prev) =>
            prev.map((item) => {
              if (item.token.address.toLowerCase() === token.address.toLowerCase() && 
                  (item.token as ExtendedToken).chainId === tokenChainId) {
                return {
                  ...item,
                  token: {
                    ...item.token,
                    currentPrice: priceData.price,
                  },
                  price: priceData.price,
                };
              }
              return item;
            })
          );
        })
        .catch(() => {});

      // Subscribe to live price updates via WebSocket
      const unsubscribe = subscribeToPrice(token.address, tokenChainId, (priceData: OnChainPrice) => {
        setSuggestions((prev) =>
          prev.map((item) => {
            if (item.token.address.toLowerCase() === token.address.toLowerCase() && 
                (item.token as ExtendedToken).chainId === tokenChainId) {
              return {
                ...item,
                token: {
                  ...item.token,
                  currentPrice: priceData.price,
                },
                price: priceData.price,
              };
            }
            return item;
          })
        );
      });
      
      unsubscribersRef.current.set(subKey, unsubscribe);
    });

    return () => {
      unsubscribersRef.current.forEach(unsub => unsub());
      unsubscribersRef.current.clear();
    };
  }, [showSuggestions, suggestions.length, chain]);

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
        placeholder={typewriterPlaceholder}
        value={searchQuery}
        onChange={handleInputChange}
        onFocus={handleFocus}
        className="token-search-input"
        data-testid="input-main-search"
      />

      {showSuggestions && (
        <div ref={suggestionsRef} className="token-search-suggestions">
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px',
                    borderRadius: '6px',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.1)',
                        animation: 'pulse 2s infinite',
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          height: '12px',
                          borderRadius: '4px',
                          background: 'rgba(255,255,255,0.1)',
                          marginBottom: '4px',
                          animation: 'pulse 2s infinite',
                          width: '60px',
                        }}
                      />
                      <div
                        style={{
                          height: '10px',
                          borderRadius: '3px',
                          background: 'rgba(255,255,255,0.05)',
                          animation: 'pulse 2s infinite',
                          width: '80px',
                        }}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      height: '12px',
                      borderRadius: '4px',
                      background: 'rgba(255,255,255,0.1)',
                      animation: 'pulse 2s infinite',
                      width: '50px',
                    }}
                  />
                </div>
              ))}
            </div>
          ) : suggestions.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>No {chain === 'BRG' ? 'ETH/POL' : chain} tokens found</div>
          ) : (
            suggestions.map(({ token, stats, price }) => {
              const tokenChainId = (token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
              const cacheKey = getIconCacheKey(token.address, tokenChainId);
              const iconUrl = suggestionIcons.get(cacheKey);
              
              const chainLabel = tokenChainId === 1 ? 'ETH' : tokenChainId === 137 ? 'POL' : null;
              return (
                <div
                  key={`${token.address}-${tokenChainId || ''}`}
                  className="suggestion-item"
                  onClick={() => handleSelectToken(token)}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <div className="suggestion-left">
                    <img 
                      src={iconUrl || getPlaceholderImage()} 
                      alt={token.symbol}
                      style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = getPlaceholderImage();
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {token.symbol}
                        {chain === 'BRG' && chainLabel && (
                          <span style={{
                            fontSize: '9px',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            background: tokenChainId === 1 ? 'rgba(98, 126, 234, 0.3)' : 'rgba(130, 71, 229, 0.3)',
                            color: tokenChainId === 1 ? '#627eea' : '#8247e5',
                          }}>
                            {chainLabel}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', opacity: 0.7 }}>{token.name}</div>
                    </div>
                  </div>
                  <div className="suggestion-price-pill">
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>
                      {token.currentPrice ? formatUSD(token.currentPrice, true) : '—'}
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
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
