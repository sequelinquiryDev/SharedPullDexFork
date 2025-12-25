import { createContext, useContext, useState, useCallback, useMemo, type ReactNode, useEffect } from 'react';
import { Token, getTokenList } from './tokenService';
import { useChain } from './chainContext';

interface TokenSelectionContextValue {
  selectedFromToken: Token | null;
  selectedToToken: Token | null;
  selectFromToken: (token: Token) => void;
  selectToToken: (token: Token) => void;
  clearSelection: () => void;
  selectionVersion: number;
}

const TokenSelectionContext = createContext<TokenSelectionContextValue | null>(null);

export function TokenSelectionProvider({ children }: { children: ReactNode }) {
  const { chainId } = useChain();
  
  const getRandomTokens = useCallback((cid: number) => {
    const list = getTokenList(cid);
    if (!list || list.length === 0) return { from: null, to: null };
    if (list.length === 1) return { from: list[0], to: null };
    
    const fromIdx = Math.floor(Math.random() * list.length);
    let toIdx = Math.floor(Math.random() * list.length);
    while (toIdx === fromIdx) {
      toIdx = Math.floor(Math.random() * list.length);
    }
    
    return { from: list[fromIdx], to: list[toIdx] };
  }, []);

  const [selectedFromToken, setSelectedFromToken] = useState<Token | null>(null);
  const [selectedToToken, setSelectedToToken] = useState<Token | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);

  useEffect(() => {
    const { from, to } = getRandomTokens(chainId);
    setSelectedFromToken(from);
    setSelectedToToken(to);
  }, [chainId, getRandomTokens]);

  const selectFromToken = useCallback((token: Token) => {
    setSelectedFromToken(token);
    setSelectionVersion(v => v + 1);
  }, []);

  const selectToToken = useCallback((token: Token) => {
    setSelectedToToken(token);
    setSelectionVersion(v => v + 1);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFromToken(null);
    setSelectedToToken(null);
  }, []);

  const value = useMemo(() => ({
    selectedFromToken,
    selectedToToken,
    selectFromToken,
    selectToToken,
    clearSelection,
    selectionVersion,
  }), [selectedFromToken, selectedToToken, selectFromToken, selectToToken, clearSelection, selectionVersion]);

  return (
    <TokenSelectionContext.Provider value={value}>
      {children}
    </TokenSelectionContext.Provider>
  );
}

export function useTokenSelection(): TokenSelectionContextValue {
  const context = useContext(TokenSelectionContext);
  if (!context) {
    throw new Error('useTokenSelection must be used within a TokenSelectionProvider');
  }
  return context;
}
