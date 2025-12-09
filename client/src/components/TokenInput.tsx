
import { useState, useEffect, useRef, useCallback } from 'react';
import { Token, TokenStats, searchTokens, getTopTokens, getPlaceholderImage, getCgStatsMap } from '@/lib/tokenService';
import { formatUSD, low, isAddress } from '@/lib/config';

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
      
      // Map with fresh stats
      const withPrices = results.map((token) => {
        const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name)) || null;
        const price = stats?.price ?? null;
        const marketCap = stats?.price && stats?.volume24h ? (stats.price * stats.volume24h * 1000) : 0;
        return { token, stats, price, marketCap };
      });
      
      // Sort by market cap (top 7) then by remaining
      withPrices.sort((a, b) => b.marketCap - a.marketCap);
      
      setSuggestions(withPrices.slice(0, 15));
      setShowSuggestions(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const [placeholderText, setPlaceholderText] = useState('');
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    // Show placeholder of what was removed
    if (selectedToken && value.length < selectedToken.symbol.length) {
      setPlaceholderText(selectedToken.symbol.slice(value.length));
    } else {
      setPlaceholderText('');
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Clear typing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new typing timeout for normalization
    typingTimeoutRef.current = setTimeout(() => {
      if (selectedToken && value.trim() === '') {
        setSearchQuery(selectedToken.symbol);
        setPlaceholderText('');
      }
    }, 2000);

    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(value.trim().toLowerCase());
    }, 150);
  };

  const handleFocus = () => {
    handleSearch(searchQuery.trim().toLowerCase());
  };

  const handleBlur = () => {
    // Normalize to selected token when user leaves input
    if (selectedToken) {
      setSearchQuery(selectedToken.symbol);
      setPlaceholderText('');
    } else {
      setSearchQuery('');
      setPlaceholderText('');
    }
    setShowSuggestions(false);
  };

  const handleSelectToken = (token: Token) => {
    onTokenSelect(token);
    setSearchQuery(token.symbol);
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  useEffect(() => {
    if (selectedToken) {
      setSearchQuery(selectedToken.symbol);
    }
  }, [selectedToken]);

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

  // Live price updates for suggestions (every 8s with smart caching)
  useEffect(() => {
    if (!showSuggestions || suggestions.length === 0) return;

    const updatePrices = () => {
      const cgStats = getCgStatsMap();
      setSuggestions((prev) =>
        prev.map((item) => {
          const stats = cgStats.get(low(item.token.symbol)) || cgStats.get(low(item.token.name)) || null;
          return {
            ...item,
            stats,
            price: stats?.price ?? null,
          };
        })
      );
    };

    const priceInterval = setInterval(updatePrices, 8000); // Every 8s
    return () => clearInterval(priceInterval);
  }, [showSuggestions, suggestions.length]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const cgStats = getCgStatsMap();
  const stats = selectedToken
    ? cgStats.get(low(selectedToken.symbol)) || cgStats.get(low(selectedToken.name))
    : null;
  const change = stats?.change;

  return (
    <div className="input-box" style={{ position: 'relative' }} ref={containerRef} data-testid={`input-box-${side}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
        <div className="token-icon" style={{ position: 'relative' }}>
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
          {selectedToken && (
            <span className="token-chip" data-testid={`chip-token-${side}`}>
              {selectedToken.symbol}
            </span>
          )}
        </div>

        {selectedToken && change !== null && change !== undefined && (
          <div
            style={{
              fontSize: '12px',
              opacity: 0.95,
              color: change >= 0 ? '#9ef39e' : '#ff9e9e',
            }}
            data-testid={`text-change-${side}`}
          >
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)}%
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%', position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search token..."
            value={searchQuery}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: '#fff',
              width: '100%',
              outline: 'none',
              fontSize: '14px',
            }}
            data-testid={`input-token-search-${side}`}
          />
          {placeholderText && (
            <span
              style={{
                position: 'absolute',
                left: `calc(10px + ${searchQuery.length * 8.4}px)`,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'rgba(255, 255, 255, 0.25)',
                pointerEvents: 'none',
                fontSize: '14px',
              }}
            >
              {placeholderText}
            </span>
          )}
        </div>

        <div style={{ marginLeft: '8px', minWidth: '120px' }}>
          <input
            type="number"
            placeholder={isEstimate ? 'Estimate' : 'Amount'}
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
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
              {formatUSD(priceUsd)} / unit
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
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>No tokens found</div>
          ) : (
            suggestions.map(({ token, stats, price }) => (
              <div
                key={token.address}
                className="suggestion-item"
                onClick={() => handleSelectToken(token)}
                data-testid={`suggestion-item-${token.symbol}`}
              >
                <div className="suggestion-left">
                  <img
                    src={token.logoURI || stats?.image || getPlaceholderImage()}
                    alt={token.symbol}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = getPlaceholderImage();
                    }}
                    style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '13px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {token.symbol}
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        opacity: 0.8,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {token.name}
                    </div>
                    {stats?.change !== null && stats?.change !== undefined && (
                      <div
                        style={{
                          fontSize: '11px',
                          marginTop: '4px',
                          opacity: 0.9,
                          color: stats.change >= 0 ? '#9ef39e' : '#ff9e9e',
                        }}
                      >
                        {stats.change >= 0 ? '+' : ''}
                        {stats.change.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>
                <div className="suggestion-price-pill">{price ? formatUSD(price) : '—'}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
