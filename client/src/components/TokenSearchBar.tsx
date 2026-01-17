
import { useState, useEffect, useRef, useCallback } from 'react';
import { Token, TokenStats, searchTokens, getTopTokens, getPlaceholderImage, getCgStatsMap, getTokenByAddress, getTokenLogoUrl, getIconCacheKey, fetchTokenIcon } from '@/lib/tokenService';
import { formatUSD, low, isAddress, type OnChainPrice } from '@/lib/config';
import { useChain } from '@/lib/chainContext';
import { useTokenSelection } from '@/lib/tokenSelectionContext';
import { useTypewriter } from '@/hooks/useTypewriter';
import { subscribeToPrice, connectPriceService } from '@/lib/priceService';
import { iconCache } from '@/lib/iconCache';

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
      const results = allTokens.slice(0, 15);
      setSuggestions(results);
      setShowSuggestions(true);
      
      // Prefetch icons for suggestions in background
      iconCache.prefetchIcons(results.map(({ token }) => ({
        address: token.address,
        chainId: (token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137)
      })));
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
      const results = [...top5, ...rest].slice(0, 15);
      setSuggestions(results);
      setShowSuggestions(true);
      
      // Prefetch icons for suggestions in background
      iconCache.prefetchIcons(results.map(({ token }) => ({
        address: token.address,
        chainId: (token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137)
      })));
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
      // Removed overflow hidden as it can interfere with fixed/sticky positioning in some layouts
      // and cause layout shifts
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [showSuggestions]);

  // Watcher for dropdown tokens visibility and selection
  useEffect(() => {
    if (!showSuggestions || suggestions.length === 0) {
      // Unsubscribe all when dropdown closes
      unsubscribersRef.current.forEach(unsub => unsub());
      unsubscribersRef.current.clear();
      return;
    }

    connectPriceService();
    
    // Set of current tokens in suggestions to keep track of changes
    const currentTokenKeys = new Set(suggestions.map(({ token }) => {
      const tokenChainId = (token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
      return `${tokenChainId}-${token.address.toLowerCase()}`;
    }));

    // Cleanup unsubscribers for tokens no longer in suggestions
    unsubscribersRef.current.forEach((unsub, key) => {
      if (!currentTokenKeys.has(key)) {
        unsub();
        unsubscribersRef.current.delete(key);
      }
    });

    // Subscribe to all tokens currently in suggestions
    const newSubKeys = new Set(suggestions.map(({ token }) => {
      const tokenChainId = (token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
      return `${tokenChainId}-${token.address.toLowerCase()}`;
    }));

    // Batch process new subscriptions and cleanups
    const toUnsubscribe: string[] = [];
    unsubscribersRef.current.forEach((_, key) => {
      if (!newSubKeys.has(key)) toUnsubscribe.push(key);
    });

    toUnsubscribe.forEach(key => {
      unsubscribersRef.current.get(key)?.();
      unsubscribersRef.current.delete(key);
    });

    // Parallel subscription logic
    suggestions.forEach(({ token }) => {
      const tokenChainId = (token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
      const subKey = `${tokenChainId}-${token.address.toLowerCase()}`;
      
      if (!unsubscribersRef.current.has(subKey)) {
        // Parallelize initial price fetch and socket subscription
        Promise.all([
          fetch(`/api/prices/onchain?address=${token.address}&chainId=${tokenChainId}`)
            .then(res => res.json())
            .catch(() => null),
          new Promise<() => void>((resolve) => {
            const unsub = subscribeToPrice(token.address, tokenChainId, (priceData) => {
              if (!priceData || priceData.price === undefined) return;
              setSuggestions(prev => prev.map(item => {
                const itemChainId = (item.token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
                if (item.token.address.toLowerCase() === token.address.toLowerCase() && itemChainId === tokenChainId) {
                  return { ...item, token: { ...item.token, currentPrice: priceData.price }, price: priceData.price };
                }
                return item;
              }));
            });
            resolve(unsub);
          })
        ]).then(([priceData, unsubscribe]) => {
          if (priceData && priceData.price !== undefined) {
            setSuggestions(prev => prev.map(item => {
              const itemChainId = (item.token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
              if (item.token.address.toLowerCase() === token.address.toLowerCase() && itemChainId === tokenChainId) {
                return { ...item, token: { ...item.token, currentPrice: priceData.price }, price: priceData.price };
              }
              return item;
            }));
          }
          unsubscribersRef.current.set(subKey, unsubscribe);
        });
      }
    });

    return () => {
      // Don't clear all on every dependency change, only on unmount or close handled above
    };
  }, [showSuggestions, suggestions, chain]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="token-search-bar-container" ref={containerRef} style={{ position: 'relative', zIndex: 1000 }}>
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
        <div ref={suggestionsRef} className="token-search-suggestions" style={{ zIndex: 1001 }}>
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
              const iconUrl = getTokenLogoUrl(token, tokenChainId);
              
              const chainLabel = tokenChainId === 1 ? 'ETH' : tokenChainId === 137 ? 'POL' : null;
              return (
                <div
                  key={`${token.address}-${tokenChainId || ''}`}
                  className="suggestion-item hover-elevate active-elevate-2"
                  onClick={() => handleSelectToken(token)}
                  style={{ cursor: 'pointer', userSelect: 'none', transition: 'all 0.15s ease' }}
                >
                  <div className="suggestion-left">
                    <img 
                      src={iconUrl} 
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
                  <div className="suggestion-price-pill" style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    backdropFilter: 'blur(4px)',
                    minWidth: '80px',
                    transition: 'all 0.2s ease'
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff' }}>
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
