import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { config, ethereumConfig } from './config';

export type ChainType = 'ETH' | 'POL';

export interface ChainConfig {
  chainId: number;
  chainIdHex: string;
  chainName: string;
  coingeckoChain: string;
  rpcUrls: string[];
  oneInchBase: string;
  zeroXBase: string;
  usdcAddr: string;
  wethAddr: string;
  explorerUrl: string;
  nativeSymbol: string;
  nativeAddr: string;
}

const polygonChainConfig: ChainConfig = {
  chainId: config.chainId,
  chainIdHex: config.chainIdHex,
  chainName: config.chainName,
  coingeckoChain: config.coingeckoChain,
  rpcUrls: config.rpcUrls,
  oneInchBase: config.oneInchBase,
  zeroXBase: config.zeroXBase,
  usdcAddr: config.usdcAddr,
  wethAddr: config.wethAddr,
  explorerUrl: config.explorerUrl,
  nativeSymbol: 'MATIC',
  nativeAddr: config.maticAddr,
};

const ethereumChainConfig: ChainConfig = {
  chainId: ethereumConfig.chainId,
  chainIdHex: ethereumConfig.chainIdHex,
  chainName: ethereumConfig.chainName,
  coingeckoChain: ethereumConfig.coingeckoChain,
  rpcUrls: ethereumConfig.rpcUrls,
  oneInchBase: ethereumConfig.oneInchBase,
  zeroXBase: ethereumConfig.zeroXBase,
  usdcAddr: ethereumConfig.usdcAddr,
  wethAddr: ethereumConfig.wethAddr,
  explorerUrl: ethereumConfig.explorerUrl,
  nativeSymbol: 'ETH',
  nativeAddr: '0x0000000000000000000000000000000000000000',
};

export const chainConfigs: Record<ChainType, ChainConfig> = {
  ETH: ethereumChainConfig,
  POL: polygonChainConfig,
};

type ChainChangeCallback = (chain: ChainType, config: ChainConfig) => void;

interface ChainContextValue {
  chain: ChainType;
  chainConfig: ChainConfig;
  setChain: (chain: ChainType) => void;
  onChainChange: (callback: ChainChangeCallback) => () => void;
  getChainConfig: (chain: ChainType) => ChainConfig;
}

const ChainContext = createContext<ChainContextValue | null>(null);

interface ChainProviderProps {
  children: React.ReactNode;
  defaultChain?: ChainType;
}

export function ChainProvider({ children, defaultChain = 'POL' }: ChainProviderProps) {
  const [chain, setChainState] = useState<ChainType>(defaultChain);
  const [callbacks, setCallbacks] = useState<Set<ChainChangeCallback>>(new Set());

  const chainConfig = useMemo(() => chainConfigs[chain], [chain]);

  const setChain = useCallback((newChain: ChainType) => {
    if (newChain !== chain) {
      setChainState(newChain);
      const newConfig = chainConfigs[newChain];
      callbacks.forEach((cb) => {
        try {
          cb(newChain, newConfig);
        } catch (e) {
          console.error('Chain change callback error:', e);
        }
      });
    }
  }, [chain, callbacks]);

  const onChainChange = useCallback((callback: ChainChangeCallback) => {
    setCallbacks((prev) => {
      const next = new Set(prev);
      next.add(callback);
      return next;
    });
    return () => {
      setCallbacks((prev) => {
        const next = new Set(prev);
        next.delete(callback);
        return next;
      });
    };
  }, []);

  const getChainConfig = useCallback((chainType: ChainType): ChainConfig => {
    return chainConfigs[chainType];
  }, []);

  const value = useMemo(() => ({
    chain,
    chainConfig,
    setChain,
    onChainChange,
    getChainConfig,
  }), [chain, chainConfig, setChain, onChainChange, getChainConfig]);

  return (
    <ChainContext.Provider value={value}>
      {children}
    </ChainContext.Provider>
  );
}

export function useChain(): ChainContextValue {
  const context = useContext(ChainContext);
  if (!context) {
    throw new Error('useChain must be used within a ChainProvider');
  }
  return context;
}

export function useChainConfig(): ChainConfig {
  const { chainConfig } = useChain();
  return chainConfig;
}

export function useChainType(): ChainType {
  const { chain } = useChain();
  return chain;
}
