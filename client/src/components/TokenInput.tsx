import { useState, useEffect, useRef, useCallback } from 'react';
import { Token, TokenStats, searchTokens, getTopTokens, getPlaceholderImage, getCgStatsMap, getTokenByAddress, loadTokensForChain } from '@/lib/tokenService';
import { formatUSD, low, isAddress } from '@/lib/config';
import { useChain } from '@/lib/chainContext';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSelectedAddressRef = useRef<string>('');
  const firstClickRef = useRef<boolean>(true);

  // Filter out FAKE/SCAM tokens by detecting suspicious characteristics
  const isLikelyScam = (token: ExtendedToken & { currentPrice?: number; priceChange24h?: number; marketCap?: number }, allTokensInResults?: any[]) => {
    const symbol = token.symbol.toUpperCase();
    const name = token.name.toUpperCase();
    
    // Obvious scam patterns
    const scamPatterns = [
      /fake\s+/i,
      /clone\s+/i,
      /scam\s+/i,
      /rug\s+/i,
      /pump\s+/i,
      /test\s+/i,
      /token\s+\d+/i,
      /\s+v\d+$/i, // "ETH v2", "USDT v3" etc - likely clones
    ];
    
    if (scamPatterns.some(p => p.test(name) || p.test(symbol))) {
      return true;
    }
    
    // Suspiciously low market cap for major symbols
    const majorSymbols = ['ETH', 'BTC', 'USDT', 'USDC', 'BNB', 'POL', 'SOL'];
    if (majorSymbols.includes(symbol)) {
      const marketCap = token.marketCap || 0;
      // If claiming to be a major coin but market cap < $1M, likely fake
      if (marketCap < 1000000) return true;
    }
    
    // If there are multiple tokens with same symbol, filter lower market cap ones (likely fakes)
    if (allTokensInResults) {
      const sameSymbolTokens = allTokensInResults.filter(t => t.token?.symbol?.toUpperCase() === symbol);
      if (sameSymbolTokens.length > 1) {
        const maxMarketCap = Math.max(...sameSymbolTokens.map(t => t.marketCap || 0));
        // If this token has much lower market cap than others with same symbol, it's likely fake
        if ((token.marketCap || 0) < maxMarketCap * 0.1) {
          return true;
        }
      }
    }
    
    return false;
  };

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
      const filtered = allTokens.filter(item => !isLikelyScam(item.token, allTokens));
      setSuggestions(filtered.slice(0, 15));
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

      // Sort by market cap first, then by 24h volume
      allResults.sort((a, b) => {
        const capA = b.marketCap || 0;
        const capB = a.marketCap || 0;
        if (capA !== capB) return capA - capB;
        
        // Secondary sort: 24h volume (descending)
        const volA = (a.stats?.volume24h || 0) * (a.stats?.price || 1);
        const volB = (b.stats?.volume24h || 0) * (b.stats?.price || 1);
        return volB - volA;
      });
      
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
      
      // Apply scam filter
      const filtered = deduplicated.filter(item => !isLikelyScam(item.token, deduplicated));
      
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

    const updatePrices = () => {
      setSuggestions((prev) =>
        prev.map((item) => {
          const tokenChainId = (item.token as ExtendedToken).chainId || (chain === 'ETH' ? 1 : 137);
          const cgStats = getCgStatsMap(tokenChainId);
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

    // Update prices immediately when showing suggestions or chain changes
    updatePrices();
    const priceInterval = setInterval(updatePrices, 5000);
    return () => clearInterval(priceInterval);
  }, [showSuggestions, suggestions.length, chain]);

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
    <div className="input-box" style={{ position: 'relative' }} ref={containerRef} data-testid={`input-box-${side}`}>
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
            {selectedToken?.logoURI ? (
              <img
                src={selectedToken.logoURI}
                alt={selectedToken.symbol}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = getPlaceholderImage();
                }}
                data-testid={`img-token-${side}`}
              />
            ) : (
              <img src={getPlaceholderImage()} alt="Select token" />
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
            onBlur={handleBlur}
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
        >
          {loading ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>Loading...</div>
          ) : suggestions.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>No {chain === 'BRG' ? 'ETH/POL' : chain} tokens found</div>
          ) : (
            suggestions.map(({ token, stats, price }) => {
              const tokenChainId = (token as ExtendedToken).chainId;
              const chainLabel = tokenChainId === 1 ? 'ETH' : tokenChainId === 137 ? 'POL' : null;
              return (
                <div
                  key={`${token.address}-${tokenChainId || ''}`}
                  className="suggestion-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectToken(token);
                  }}
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
