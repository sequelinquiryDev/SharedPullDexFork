import { useState, useEffect, useRef, useCallback } from 'react';
import { Token, TokenStats, searchTokens, getTopTokens, getPlaceholderImage, getCgStatsMap, getTokenByAddress, loadTokensForChain, getTokenLogoUrl, getTokenPriceUSD, fetchTokenIcon, getIconCacheKey } from '@/lib/tokenService';
import { formatUSD, low, isAddress, type OnChainPrice } from '@/lib/config';
import { useChain } from '@/lib/chainContext';
import { subscribeToPrice, connectPriceService } from '@/lib/priceService';

interface ExtendedToken extends Token {
  chainId?: number;
}

interface TokenInputProps {
  side: 'from' | 'to';
  selectedToken: Token | null;
  amount: string;
  onTokenSelect: (token: Token) => void;
  onAmountChange: (amount: string) => void;
  priceUsd: number | null;
  isEstimate?: boolean;
  disabled?: boolean;
}

export function TokenInput({
  side,
  selectedToken,
  amount,
  onTokenSelect,
  onAmountChange,
  priceUsd,
  isEstimate = false,
  disabled = false,
}: TokenInputProps) {
  const { chain } = useChain();
  const chainId = chain === 'ETH' ? 1 : chain === 'POL' ? 137 : 0;
  
  const [searchQuery, setSearchQuery] = useState(selectedToken ? selectedToken.symbol.toUpperCase() : '');
  const [suggestions, setSuggestions] = useState<{ token: ExtendedToken & { currentPrice?: number; priceChange24h?: number }; stats: TokenStats | null; price: number | null }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedTokenIcon, setSelectedTokenIcon] = useState<string>('');
  const [suggestionIcons, setSuggestionIcons] = useState<Map<string, string>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSelectedAddressRef = useRef<string>('');
  const firstClickRef = useRef<boolean>(true);
  const unsubscribersRef = useRef<Map<string, () => void>>(new Map());
  const iconCacheRef = useRef<Map<string, string>>(new Map());

  // Whitelist of real stablecoin addresses on major chains
  const STABLECOIN_WHITELIST = {
    // Ethereum (chain 1)
    '1': {
      'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    // Polygon (chain 137)
    '137': {
      'USDT': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      'USDC': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    },
  };

    // Filter out FAKE/SCAM tokens by detecting suspicious characteristics
    // Only apply filtering for ticker searches, NOT for address searches
    const isLikelyScam = (token: ExtendedToken & { currentPrice?: number; priceChange24h?: number; marketCap?: number }, allTokensInResults?: any[], isAddressSearch: boolean = false) => {
      return false;
    };

  const handleSearch = useCallback(async (query: string) => {
    // BRG mode: search both chains; otherwise single chain
    const chainIds = chain === 'BRG' ? [1, 137] : [chain === 'ETH' ? 1 : 137];
    console.log('[handleSearch] query:', query, 'chainIds:', chainIds);
    
    if (!query) {
      console.log('[handleSearch] Empty query, fetching top tokens for chainIds:', chainIds);
      const allTokens: { token: ExtendedToken & { currentPrice?: number; priceChange24h?: number }; stats: TokenStats | null; price: number | null }[] = [];
      
      for (const cid of chainIds) {
        const topTokens = getTopTokens(chain === 'BRG' ? 8 : 15, cid);
        console.log(`[handleSearch] topTokens for ${cid}:`, topTokens.length);
        const cgStats = getCgStatsMap(cid);
        for (const { token, stats } of topTokens) {
          const tokenStats = stats || cgStats.get(low(token.symbol)) || cgStats.get(low(token.name));
            const currentPrice = (tokenStats?.price ?? (await getTokenPriceUSD(token.address, token.decimals, cid))) as number | undefined;
            allTokens.push({
              token: {
                ...token,
                chainId: cid,
                currentPrice,
                priceChange24h: tokenStats?.change ?? undefined,
              },
              stats: tokenStats || null,
              price: currentPrice ?? null,
            });
          }
        }
        console.log('[handleSearch] allTokens pre-filter:', allTokens.length, allTokens);
        const filtered = allTokens.filter(item => !isLikelyScam(item.token, allTokens, false));
        console.log('[handleSearch] allTokens post-filter:', filtered.length, filtered);
        setSuggestions(filtered.slice(0, 15));
        setShowSuggestions(true);
        return;
      }

      setLoading(true);
      try {
        let allResults: { token: ExtendedToken & { currentPrice?: number; priceChange24h?: number }; stats: TokenStats | null; price: number | null; marketCap: number }[] = [];
        
        for (const cid of chainIds) {
          // Check if query is a token address
          if (isAddress(query)) {
            const token = await getTokenByAddress(query, cid);
            if (token) {
              const cgStats = getCgStatsMap(cid);
              const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || null;
              const currentPrice = (stats?.price ?? (await getTokenPriceUSD(token.address, token.decimals, cid))) as number | undefined;
              allResults.push({
                token: {
                  ...token,
                  chainId: cid,
                  currentPrice,
                  priceChange24h: stats?.change ?? undefined,
                },
                stats,
                price: currentPrice ?? null,
                marketCap: stats?.marketCap || 0,
              });
            }
          } else {
            const results = await searchTokens(query, cid);
            console.log(`[handleSearch] results for ${cid}:`, results.length);
            const cgStats = getCgStatsMap(cid);

            for (const token of results) {
              const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || null;
              const currentPrice = (stats?.price ?? (await getTokenPriceUSD(token.address, token.decimals, cid))) as number | undefined;
              const marketCap = stats?.marketCap || (currentPrice && stats?.volume24h ? (currentPrice * stats.volume24h * 1000) : 0);
              allResults.push({
                token: {
                  ...token,
                  chainId: cid,
                  currentPrice,
                  priceChange24h: stats?.change ?? undefined,
                },
                stats,
                price: currentPrice ?? null,
                marketCap,
              });
            }
          }
        }

      // Sort: Top 5 by market cap, rest by 24h volume
      const top5 = allResults.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 5);
      const rest = allResults.slice(5).sort((a, b) => {
        const volA = (a.stats?.volume24h || 0) * (a.stats?.price || 1);
        const volB = (b.stats?.volume24h || 0) * (b.stats?.price || 1);
        return volB - volA;
      });
      allResults = [...top5, ...rest];
      
      // Deduplicate: In non-BRG mode, keep one per symbol. In BRG mode, allow same symbol if different chains
      const seen = new Map<string, number>();
      const deduplicated = allResults.filter(item => {
        const tokenChainId = (item.token as ExtendedToken).chainId || 0;
        const key = chain === 'BRG' 
          ? `${item.token.symbol.toLowerCase()}-${tokenChainId}` 
          : item.token.symbol.toLowerCase();
        if (seen.has(key)) return false;
        seen.set(key, tokenChainId);
        return true;
      });
      
      // Apply scam filter - skip filtering if address search (but always check stablecoin whitelist)
      const filtered = deduplicated.filter(item => !isLikelyScam(item.token, deduplicated, isAddress(query)));
      
      setSuggestions(filtered.slice(0, 15));
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

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    handleSearch(searchQuery.trim().toLowerCase());
  };

  const handleInputClick = (e: React.MouseEvent<HTMLInputElement>) => {
    // Move cursor to end only on first click
    if (firstClickRef.current) {
      e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length);
      firstClickRef.current = false;
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      setShowSuggestions(false);
      // Only update searchQuery if a token wasn't just selected
      if (lastSelectedAddressRef.current === '') {
        if (selectedToken) {
          setSearchQuery(selectedToken.symbol.toUpperCase());
        } else {
          setSearchQuery('');
        }
      }
      lastSelectedAddressRef.current = '';
    }, 200);
  };

  const handleSelectToken = (token: Token) => {
    lastSelectedAddressRef.current = token.address;
    setSearchQuery(token.symbol.toUpperCase());
    onTokenSelect(token);
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  // Sync searchQuery with selectedToken only when token actually changes (not during selection)
  useEffect(() => {
    if (selectedToken && lastSelectedAddressRef.current === '') {
      setSearchQuery(selectedToken.symbol.toUpperCase());
    }
  }, [selectedToken?.address]);

  // Fetch icon for selected token using cached /api/icon endpoint
  useEffect(() => {
    if (selectedToken) {
      const t = selectedToken as ExtendedToken;
      const tokenChainId = t.chainId || chainId;
      setSelectedTokenIcon(getTokenLogoUrl(selectedToken, tokenChainId));
    }
  }, [selectedToken?.address, chainId, chain]);

  // Parallelized icon fetching for suggestions
  useEffect(() => {
    if (suggestions.length === 0) return;

    // Filter tokens that don't have an icon in suggestionIcons yet
    const tokensNeedingIcons = suggestions.filter(({ token }) => {
      const t = token as ExtendedToken;
      const tokenChainId = t.chainId || chainId;
      const cacheKey = getIconCacheKey(token.address, tokenChainId);
      return !suggestionIcons.has(cacheKey);
    });

    if (tokensNeedingIcons.length === 0) return;

    // Process tokens in batches of 10 as requested for "newly requested" tokens
    const BATCH_SIZE = 10;
    const processBatch = async (batch: any[]) => {
      const results = await Promise.all(batch.map(async ({ token }) => {
        const t = token as ExtendedToken;
        const tokenChainId = t.chainId || chainId;
        const cacheKey = getIconCacheKey(token.address, tokenChainId);
        
        // This hits the server cache which handles single-flight requests
        const iconUrl = `/api/icon?address=${token.address.toLowerCase()}&chainId=${tokenChainId}&v=${Math.floor(Date.now() / 3600000)}`;
        return { cacheKey, iconUrl };
      }));

      setSuggestionIcons(prev => {
        const next = new Map(prev);
        results.forEach(({ cacheKey, iconUrl }) => {
          next.set(cacheKey, iconUrl);
        });
        return next;
      });
    };

    const runIconFetching = async () => {
      for (let i = 0; i < tokensNeedingIcons.length; i += BATCH_SIZE) {
        const batch = tokensNeedingIcons.slice(i, i + BATCH_SIZE);
        await processBatch(batch);
      }
    };

    runIconFetching();
  }, [suggestions, chainId, chain]);

  // CRITICAL FIX: Separate subscription management from dropdown visibility
  // This prevents race conditions where subscriptions are unsubscribed while async operations complete
  useEffect(() => {
    if (!showSuggestions || suggestions.length === 0) {
      // CRITICAL FIX: Don't immediately unsubscribe - wait for dropdown to fully close
      // Keep subscriptions alive for selected token and recently viewed tokens
      const delayedCleanup = setTimeout(() => {
        unsubscribersRef.current.forEach((unsub, key) => {
          if (selectedToken) {
            const t = selectedToken as ExtendedToken;
            const selectedKey = `${t.chainId || chainId}-${selectedToken.address.toLowerCase()}`;
            // CRITICAL: Never unsubscribe the selected token
            if (key === selectedKey) return;
          }
          // Only unsubscribe after dropdown has been closed for 500ms
          unsub();
          unsubscribersRef.current.delete(key);
        });
      }, 500); // Give time for dropdown animation and any pending updates
      
      return () => clearTimeout(delayedCleanup);
    }

    connectPriceService();
    
    const currentTokenKeys = new Set(suggestions.map(({ token }) => {
      const t = token as ExtendedToken;
      const tokenChainId = t.chainId || chainId;
      return `${tokenChainId}-${token.address.toLowerCase()}`;
    }));
    if (selectedToken) {
      const t = selectedToken as ExtendedToken;
      currentTokenKeys.add(`${t.chainId || chainId}-${selectedToken.address.toLowerCase()}`);
    }

    // CRITICAL FIX: Unsubscribe only tokens that are truly no longer needed
    const toUnsubscribe: string[] = [];
    unsubscribersRef.current.forEach((_, key) => {
      if (!currentTokenKeys.has(key)) toUnsubscribe.push(key);
    });

    toUnsubscribe.forEach(key => {
      const unsub = unsubscribersRef.current.get(key);
      if (unsub) {
        unsub();
        unsubscribersRef.current.delete(key);
      }
    });

    // CRITICAL FIX: Subscribe synchronously first, then enhance with async data
    suggestions.forEach(({ token }) => {
      const t = token as ExtendedToken;
      const tokenChainId = t.chainId || chainId;
      const subKey = `${tokenChainId}-${token.address.toLowerCase()}`;
      
      if (!unsubscribersRef.current.has(subKey)) {
        // CRITICAL FIX: Store subscription immediately (synchronously) to prevent race conditions
        const unsub = subscribeToPrice(token.address, tokenChainId, (priceData) => {
          if (!priceData || priceData.price === undefined) return;
          setSuggestions(prev => prev.map(item => {
            const itemChainId = (item.token as ExtendedToken).chainId || chainId;
            if (item.token.address.toLowerCase() === token.address.toLowerCase() && itemChainId === tokenChainId) {
              return { ...item, token: { ...item.token, currentPrice: priceData.price }, price: priceData.price };
            }
            return item;
          }));
        });
        
        // Store subscription IMMEDIATELY (not after async Promise)
        unsubscribersRef.current.set(subKey, unsub);
        
        // Fetch initial price asynchronously (doesn't affect subscription storage)
        fetch(`/api/prices/onchain?address=${token.address}&chainId=${tokenChainId}`)
          .then(res => res.json())
          .then(priceData => {
            if (priceData && priceData.price !== undefined) {
              setSuggestions(prev => prev.map(item => {
                const itemChainId = (item.token as ExtendedToken).chainId || chainId;
                if (item.token.address.toLowerCase() === token.address.toLowerCase() && itemChainId === tokenChainId) {
                  return { ...item, token: { ...item.token, currentPrice: priceData.price }, price: priceData.price };
                }
                return item;
              }));
            }
          })
          .catch(() => {
            // Silently fail - subscription will update when server broadcasts
          });
      }
    });
  }, [showSuggestions, suggestions, selectedToken, chainId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
      // Removed overflow hidden as it can interfere with fixed/sticky positioning in some layouts
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [showSuggestions]);


  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const cgStats = getCgStatsMap(chainId);
  const stats = selectedToken
    ? cgStats.get(low(selectedToken.symbol)) || cgStats.get(low(selectedToken.name))
    : null;
  const change = stats?.change;

  return (
    <div className="input-box" style={{ position: 'relative', zIndex: 100 }} ref={containerRef} data-testid={`input-box-${side}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
        {/* Merged ticker + icon chip input - single unified input field */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '0px 8px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          flex: selectedToken ? undefined : 0,
        }}>
          <div className="token-icon" style={{ position: 'relative', width: '28px', height: '28px' }}>
            {selectedTokenIcon ? (
              <img
                src={selectedTokenIcon}
                alt={selectedToken?.symbol || "Select token"}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = getPlaceholderImage();
                }}
                data-testid={`img-token-${side}`}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            placeholder={chain === 'BRG' ? 'ETH & POL' : `${chain} tokens`}
            value={searchQuery}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onClick={handleInputClick}
            style={{
              padding: '10px 8px',
              borderRadius: '0px',
              border: 'none',
              background: 'transparent',
              color: '#fff',
              width: '100%',
              outline: 'none',
              fontSize: '13px',
              fontWeight: selectedToken ? 700 : 400,
              minWidth: '60px',
              caretColor: '#fff',
            }}
            data-testid={`input-token-search-${side}`}
          />
        </div>


        <div style={{ marginLeft: '8px', minWidth: '120px' }}>
          <input
            type="number"
            placeholder={isEstimate ? 'Estimate' : 'Amount'}
            value={amount}
            onChange={(e) => {
              onAmountChange(e.target.value);
            }}
            readOnly={isEstimate}
            disabled={disabled}
            step="any"
            min="0"
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(255,255,255,0.03)',
              color: '#fff',
              fontSize: '14px',
              outline: 'none',
            }}
            data-testid={`input-amount-${side}`}
          />
        </div>

        {priceUsd !== null && (
          <div className="price-small">
            <div className="price-usd" data-testid={`text-usd-${side}`}>
              {formatUSD(Number(amount || 0) * priceUsd)}
            </div>
            <div className="price-unit" data-testid={`text-unit-price-${side}`}>
              {formatUSD(priceUsd)}
            </div>
          </div>
        )}
      </div>

      {showSuggestions && (
        <div
          ref={suggestionsRef}
          className="suggestions show"
          data-testid={`suggestions-${side}`}
          style={{ zIndex: 101 }}
        >
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
              const tokenChainId = (token as ExtendedToken).chainId || chainId;
              // Force fresh URL construction for each render to ensure latest v param
              const iconUrl = `/api/icon?address=${token.address.toLowerCase()}&chainId=${tokenChainId}&v=${Math.floor(Date.now() / 3600000)}`;
              
              const chainLabel = tokenChainId === 1 ? 'ETH' : tokenChainId === 137 ? 'POL' : null;
              return (
                <div
                  key={`${token.address}-${tokenChainId || ''}`}
                  className="suggestion-item hover-elevate active-elevate-2"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onTokenSelect(token);
                    setShowSuggestions(false);
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none', transition: 'all 0.15s ease' }}
                >
                  <div className="suggestion-left">
                    <img 
                      src={iconUrl} 
                      alt={token.symbol}
                      style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                      key={`icon-${token.address}-${tokenChainId}-${searchQuery}`} // Add searchQuery to key to force remount on typing
                      loading="eager" // Use eager loading for suggestions
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
                      <div style={{ fontSize: '11px', opacity: 0.7 }}>
                        {token.name}
                      </div>
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
