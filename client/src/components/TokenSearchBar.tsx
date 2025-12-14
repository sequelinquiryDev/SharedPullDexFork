
import { useState, useRef, useEffect } from 'react';
import { Token, searchTokens, getTokenMap, getCgStatsMap, getPlaceholderImage } from '@/lib/tokenService';
import { formatUSD, low, isAddress } from '@/lib/config';
import { ethers } from 'ethers';

interface TokenSearchBarProps {
  onTokenSelect: (token: Token) => void;
}

export function TokenSearchBar({ onTokenSelect }: TokenSearchBarProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Token[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setLoading(true);
    try {
      if (isAddress(searchQuery)) {
        const tokenMap = getTokenMap();
        const addr = low(searchQuery);
        let token = tokenMap.get(addr);
        
        if (!token) {
          try {
            const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
            const abi = [
              'function symbol() view returns (string)',
              'function name() view returns (string)',
              'function decimals() view returns (uint8)',
            ];
            const contract = new ethers.Contract(searchQuery, abi, provider);
            const [symbol, name, decimals] = await Promise.all([
              contract.symbol().catch(() => 'UNKNOWN'),
              contract.name().catch(() => 'Unknown Token'),
              contract.decimals().catch(() => 18),
            ]);
            
            token = {
              address: addr,
              symbol,
              name,
              decimals,
              logoURI: '',
            };
          } catch (e) {
            console.warn('Failed to fetch token info from contract', e);
          }
        }
        
        if (token) {
          setSuggestions([token]);
          setShowSuggestions(true);
        }
      } else {
        const results = await searchTokens(searchQuery);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(value.trim());
    }, 200);
  };

  const handleSelectToken = (token: Token) => {
    onTokenSelect(token);
    setQuery('');
    setSuggestions([]);
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
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const cgStats = getCgStatsMap();

  return (
    <div className="token-search-bar-container" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Search by name, symbol, or address..."
        value={query}
        onChange={handleInputChange}
        className="token-search-input"
      />
      {showSuggestions && (
        <div className="token-search-suggestions">
          {loading ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>Loading...</div>
          ) : suggestions.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7 }}>No tokens found</div>
          ) : (
            suggestions.map((token) => {
              const stats = cgStats.get(low(token.symbol)) || cgStats.get(low(token.name));
              const price = stats?.price ?? null;
              return (
                <div
                  key={token.address}
                  className="suggestion-item"
                  onClick={() => handleSelectToken(token)}
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
                      <div style={{ fontWeight: 700, fontSize: '13px' }}>{token.symbol}</div>
                      <div style={{ fontSize: '12px', opacity: 0.8 }}>{token.name}</div>
                    </div>
                  </div>
                  <div className="suggestion-price-pill">{price ? formatUSD(price) : '—'}</div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
