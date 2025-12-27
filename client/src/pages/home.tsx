import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useChainId, useBalance, useSwitchChain } from 'wagmi';
import { ethers } from 'ethers';
import { useLocation } from 'wouter';
import confetti from 'canvas-confetti';
import { TokenInput } from '@/components/TokenInput';
import { SlippageControl } from '@/components/SlippageControl';
import { TokenInfoSidebar } from '@/components/TokenInfoSidebar';
import { showToast } from '@/components/Toast';
import { Token, loadTokensAndMarkets, loadTokensForChain, getTokenPriceUSD, getTokenMap, getTokenByAddress, getCgStatsMap, getStatsByTokenAddress, getOnChainAnalytics, getTokenList, clearPriceCache, getPlaceholderImage, getTokenLogoUrl } from '@/lib/tokenService';
import { getBestQuote, getLifiBridgeQuote, executeSwap, approveToken, checkAllowance, parseSwapError, QuoteResult } from '@/lib/swapService';
import { config, ethereumConfig, low, isAddress } from '@/lib/config';
import { useChain, ChainType, chainConfigs } from '@/lib/chainContext';
import { useTokenSelection } from '@/lib/tokenSelectionContext';

interface ExtendedToken extends Token {
  chainId?: number;
}

// ETH chain: WETH -> ETH (verified contract addresses)
// WETH: https://etherscan.io/token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
// ETH: Native coin (0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee)
const ETHEREUM_DEFAULTS = {
  fromToken: '0xc02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH Ethereum (verified mainnet)
  toToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // ETH Ethereum (native coin)
};

// POL chain: USDC.e (bridged) -> WETH (verified contract addresses)
const POLYGON_DEFAULTS = {
  fromToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e (bridged - verified)
  toToken: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH (verified Polygon)
};


// Native token addresses (both zero address and 0x standard 0xEeee...)
const NATIVE_ADDRESSES = [
  '0x0000000000000000000000000000000000000000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  config.maticAddr?.toLowerCase(),
].filter(Boolean);

const isNativeToken = (address: string) => {
  if (!address) return false;
  const lowAddr = address.toLowerCase();
  return NATIVE_ADDRESSES.some(a => a?.toLowerCase() === lowAddr);
};

export default function Home() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { chain, chainConfig, setChain, onChainChange } = useChain();
  const { selectedFromToken, clearSelection, selectionVersion } = useTokenSelection();
  const [location] = useLocation();

  const [fromToken, setFromToken] = useState<ExtendedToken | null>(null);
  const [toToken, setToToken] = useState<ExtendedToken | null>(null);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState(config.defaultSlippage);

  const [fromPriceUsd, setFromPriceUsd] = useState<number | null>(null);
  const [toPriceUsd, setToPriceUsd] = useState<number | null>(null);
  const [fromChange24h, setFromChange24h] = useState<number | null>(null);
  const [toChange24h, setToChange24h] = useState<number | null>(null);
  const [fromVolume24h, setFromVolume24h] = useState<number | null>(null);
  const [toVolume24h, setToVolume24h] = useState<number | null>(null);
  const [fromMarketCap, setFromMarketCap] = useState<number | null>(null);
  const [toMarketCap, setToMarketCap] = useState<number | null>(null);
  
  const priceRequestIdRef = useRef<number>(0);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapStep, setSwapStep] = useState<string>('');
  const [tokensLoaded, setTokensLoaded] = useState(false);
  const [userBalance, setUserBalance] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [isBridgeMode, setIsBridgeMode] = useState(false);
  const [isRadarOpen, setIsRadarOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [fromPriceHistory, setFromPriceHistory] = useState<number[]>([]);
  const [toPriceHistory, setToPriceHistory] = useState<number[]>([]);
  const previousChainRef = useRef<ChainType>(chain);
  const priceHistoryRef = useRef<{ from: number[]; to: number[] }>({ from: [], to: [] });

  // Determine if this is a bridge operation (cross-chain in BRG mode)
  const getTokenChainId = (token: ExtendedToken | null): number => {
    if (!token) return chain === 'ETH' ? 1 : 137;
    if (token.chainId) return token.chainId;
    return chain === 'ETH' ? 1 : 137;
  };

  const isCrossChainBridge = (): boolean => {
    if (chain !== 'BRG') return false;
    if (!fromToken || !toToken) return false;
    const fromChainId = getTokenChainId(fromToken);
    const toChainId = getTokenChainId(toToken);
    return fromChainId !== toChainId;
  };

  // Fetch 24h onchain analytics for tokens (initial load only, server sends updates via WebSocket)
  useEffect(() => {
    const fetchAnalytics = async () => {
      if (fromToken) {
        const analytics = await getOnChainAnalytics(fromToken.address, getTokenChainId(fromToken));
        if (analytics) {
          setFromChange24h(analytics.change24h);
          setFromVolume24h(analytics.volume24h);
          setFromMarketCap(analytics.marketCap);
          setFromPriceHistory(analytics.priceHistory);
        }
      }
      if (toToken) {
        const analytics = await getOnChainAnalytics(toToken.address, getTokenChainId(toToken));
        if (analytics) {
          setToChange24h(analytics.change24h);
          setToVolume24h(analytics.volume24h);
          setToMarketCap(analytics.marketCap);
          setToPriceHistory(analytics.priceHistory);
        }
      }
    };
    fetchAnalytics();
  }, [fromToken, toToken, chain]);

  // Listen for analytics updates from server WebSocket
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'analytics') {
          const { address, chainId, data } = msg;
          if (fromToken && fromToken.address.toLowerCase() === address.toLowerCase() && getTokenChainId(fromToken) === chainId) {
            setFromChange24h(data.change24h);
            setFromVolume24h(data.volume24h);
            setFromMarketCap(data.marketCap);
            setFromPriceHistory(data.priceHistory);
          }
          if (toToken && toToken.address.toLowerCase() === address.toLowerCase() && getTokenChainId(toToken) === chainId) {
            setToChange24h(data.change24h);
            setToVolume24h(data.volume24h);
            setToMarketCap(data.marketCap);
            setToPriceHistory(data.priceHistory);
          }
        }
      } catch (e) {}
    };

    const wsPriceConn = (window as any).__wsPriceConn;
    if (wsPriceConn && wsPriceConn.addEventListener) {
      wsPriceConn.addEventListener('message', handleMessage);
      return () => {
        wsPriceConn.removeEventListener('message', handleMessage);
      };
    }
  }, [fromToken, toToken]);

  // Get user balance for from token (use token's chainId in BRG mode)
  const fromTokenChainId = (() => {
    const chainIdVal = fromToken ? getTokenChainId(fromToken) : (chain === 'ETH' ? 1 : 137);
    return (chainIdVal === 1 || chainIdVal === 137) ? chainIdVal : 137;
  })();
  
  const { data: nativeBalance } = useBalance({
    address: address,
    chainId: fromTokenChainId as 1 | 137,
  });

  const { data: tokenBalance } = useBalance({
    address: address,
    token: fromToken && !isNativeToken(fromToken.address)
      ? fromToken.address as `0x${string}` 
      : undefined,
    chainId: fromTokenChainId as 1 | 137,
  });

  // Check balance and set insufficient funds state
  useEffect(() => {
    if (!fromToken || !fromAmount || !address) {
      setInsufficientFunds(false);
      setUserBalance(null);
      return;
    }

    const isNative = isNativeToken(fromToken.address);

    const balance = isNative ? nativeBalance : tokenBalance;
    
    if (balance) {
      const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance.value, fromToken.decimals));
      setUserBalance(balanceFormatted.toFixed(6));
      
      const amount = parseFloat(fromAmount);
      if (!isNaN(amount) && amount > balanceFormatted) {
        setInsufficientFunds(true);
      } else {
        setInsufficientFunds(false);
      }
    }
  }, [fromToken, fromAmount, address, nativeBalance, tokenBalance]);

  // URL-based token input: Check for token address in URL
  useEffect(() => {
    const checkUrlToken = async () => {
      const url = new URL(window.location.href);
      const pathParts = url.pathname.split('/');
      
      // Check for /0x... pattern
      const tokenAddress = pathParts.find(part => isAddress(part));
      
      if (tokenAddress) {
        // Detect chain from token - try ETH first, then POL
        let detectedChain: ChainType = 'POL';
        let token: Token | null = null;
        
        // Try Ethereum first
        token = await getTokenByAddress(tokenAddress, 1);
        if (token) {
          detectedChain = 'ETH';
        } else {
          // Try Polygon
          token = await getTokenByAddress(tokenAddress, 137);
          if (token) {
            detectedChain = 'POL';
          }
        }
        
        if (token && detectedChain !== chain) {
          setChain(detectedChain);
        }
        
        if (token) {
          setFromToken(token);
          showToast(`Loaded ${token.symbol} from URL`, { type: 'success', ttl: 3000 });
        }
      }
    };
    
    if (tokensLoaded) {
      checkUrlToken();
    }
  }, [tokensLoaded, location]);

  const fetchPrices = useCallback(async () => {
    // Increment request ID to invalidate previous requests
    const currentRequestId = ++priceRequestIdRef.current;
    
    // Use token-specific chainId in BRG mode
    const fromChainId = fromToken ? getTokenChainId(fromToken) : (chain === 'ETH' ? 1 : 137);
    const toChainId = toToken ? getTokenChainId(toToken) : (chain === 'ETH' ? 1 : 137);
    
    if (fromToken) {
      try {
        const price = await getTokenPriceUSD(fromToken.address, fromToken.decimals, fromChainId);
        // Only update if this is still the latest request
        if (currentRequestId === priceRequestIdRef.current) {
          setFromPriceUsd(price);
          // Track price history for sparklines (following 2-minute server sequence)
          if (price !== null) {
            priceHistoryRef.current.from = [...priceHistoryRef.current.from.slice(-59), price]; // Keep last 60 points (2 hours at 2-min intervals)
            setFromPriceHistory([...priceHistoryRef.current.from]);
          }
        }
      } catch (e) {
        console.error("Failed to fetch price for fromToken:", fromToken.address, e);
        // Only update if this is still the latest request
        if (currentRequestId === priceRequestIdRef.current) {
          setFromPriceUsd(null);
        }
      }
    } else {
      if (currentRequestId === priceRequestIdRef.current) {
        setFromPriceUsd(null);
        priceHistoryRef.current.from = [];
        setFromPriceHistory([]);
      }
    }

    if (toToken) {
      try {
        const price = await getTokenPriceUSD(toToken.address, toToken.decimals, toChainId);
        // Only update if this is still the latest request
        if (currentRequestId === priceRequestIdRef.current) {
          setToPriceUsd(price);
          // Track price history for sparklines (following 2-minute server sequence)
          if (price !== null) {
            priceHistoryRef.current.to = [...priceHistoryRef.current.to.slice(-59), price]; // Keep last 60 points (2 hours at 2-min intervals)
            setToPriceHistory([...priceHistoryRef.current.to]);
          }
        }
      } catch (e) {
        console.error("Failed to fetch price for toToken:", toToken.address, e);
        // Only update if this is still the latest request
        if (currentRequestId === priceRequestIdRef.current) {
          setToPriceUsd(null);
        }
      }
    } else {
      if (currentRequestId === priceRequestIdRef.current) {
        setToPriceUsd(null);
        priceHistoryRef.current.to = [];
        setToPriceHistory([]);
      }
    }
  }, [fromToken, toToken, chain]);

  const setDefaultTokensForChain = useCallback(async (chainType: ChainType) => {
    if (chainType === 'BRG') {
      // BRG mode: Set defaults from both chains (ETH -> POL)
      await loadTokensForChain(1);
      await loadTokensForChain(137);
      
      const ethTokenList = getTokenList(1);
      const polTokenList = getTokenList(137);
      const polTokenMap = getTokenMap(137);
      
      // Pick random from token from Ethereum list
      let newFromToken: ExtendedToken | null = null;
      if (ethTokenList.length > 0) {
        const randomIdx = Math.floor(Math.random() * ethTokenList.length);
        newFromToken = { ...ethTokenList[randomIdx], chainId: 1 } as ExtendedToken;
      }
      
      // Default: POL token for Polygon
      const polAddr = low('0x455e53cbb86018ac2b8092fdcd39d8444affc3f6');
      let newToToken = polTokenMap.get(polAddr);
      if (!newToToken && polTokenList.length > 0) {
        // Fallback: find USDT in polygon list
        newToToken = polTokenList.find(t => t.symbol === 'USDT');
      }
      if (newToToken) {
        newToToken = { ...newToToken, chainId: 137 } as ExtendedToken;
      }
      
      if (newFromToken) setFromToken(newFromToken);
      if (newToToken) setToToken(newToToken);
      return;
    }
    
    let targetChainId: number;
    let primaryTokenAddr: string;
    let fallbackSymbol: string;
    
    if (chainType === 'ETH') {
      targetChainId = 1;
      primaryTokenAddr = low('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'); // ETH
      fallbackSymbol = 'USDT';
    } else if (chainType === 'POL') {
      targetChainId = 137;
      primaryTokenAddr = low('0x455e53cbb86018ac2b8092fdcd39d8444affc3f6'); // POL
      fallbackSymbol = 'USDT';
    } else {
      return;
    }
    
    await loadTokensForChain(targetChainId);
    const tokenList = getTokenList(targetChainId);
    const tokenMap = getTokenMap(targetChainId);
    
    // Random token from local file for "from"
    let newFromToken: ExtendedToken | null = null;
    if (tokenList.length > 0) {
      const randomIdx = Math.floor(Math.random() * tokenList.length);
      newFromToken = { ...tokenList[randomIdx], chainId: targetChainId } as ExtendedToken;
    }
    
    // Primary token for "to", fallback to USDT
    let newToToken = tokenMap.get(primaryTokenAddr);
    if (!newToToken) {
      newToToken = tokenList.find(t => t.symbol === fallbackSymbol);
    }
    if (newToToken) {
      newToToken = { ...newToToken, chainId: targetChainId } as ExtendedToken;
    }
    
    if (newFromToken) setFromToken(newFromToken);
    if (newToToken) setToToken(newToToken);
  }, []);

  useEffect(() => {
    loadTokensAndMarkets().then(() => {
      setTokensLoaded(true);
      setDefaultTokensForChain(chain);
    });
  }, []);

  // Auto-switch wallet chain when user changes chains in UI (except BRG mode)
  useEffect(() => {
    if (isConnected && switchChain) {
      if (chain === 'ETH' && chainId !== 1) {
        console.log('[Wallet] Auto-switching wallet to Ethereum (chain 1)');
        switchChain({ chainId: 1 });
      } else if (chain === 'POL' && chainId !== 137) {
        console.log('[Wallet] Auto-switching wallet to Polygon (chain 137)');
        switchChain({ chainId: 137 });
      }
    }
  }, [chain, chainId, isConnected, switchChain]);

  useEffect(() => {
    const unsubscribe = onChainChange((newChain: ChainType) => {
      if (previousChainRef.current !== newChain) {
        const prevChain = previousChainRef.current;
        console.log(`[ChainSwitch] Switching from ${prevChain} to ${newChain}`);
        previousChainRef.current = newChain;
        
        // For BRG mode, preserve user's token selections; for other modes, reset
        const enteringBrgMode = newChain === 'BRG' && prevChain !== 'BRG';
        const leavingBrgMode = newChain !== 'BRG' && prevChain === 'BRG';
        
        if (enteringBrgMode) {
          // BRG mode: keep token selections, amounts, and quotes
          setQuote(null);
          clearPriceCache();
          console.log(`[ChainSwitch] Entered BRG mode, clearing price cache`);
        } else if (leavingBrgMode) {
          // Leaving BRG mode: reset all and load defaults for new chain
          setFromAmount('');
          setToAmount('');
          setQuote(null);
          setFromPriceUsd(null);
          setToPriceUsd(null);
          setInsufficientFunds(false);
          setUserBalance(null);
          priceHistoryRef.current = { from: [], to: [] };
          setFromPriceHistory([]);
          setToPriceHistory([]);
          setFromToken(null);
          setToToken(null);
          clearPriceCache();
          
          setDefaultTokensForChain(newChain).then(() => {
            console.log(`[ChainSwitch] Default tokens loaded for ${newChain}`);
          });
        } else {
          // Switching between non-BRG chains: reset all
          setFromAmount('');
          setToAmount('');
          setQuote(null);
          setFromPriceUsd(null);
          setToPriceUsd(null);
          setInsufficientFunds(false);
          setUserBalance(null);
          priceHistoryRef.current = { from: [], to: [] };
          setFromPriceHistory([]);
          setToPriceHistory([]);
          setFromToken(null);
          setToToken(null);
          clearPriceCache();
          
          setDefaultTokensForChain(newChain).then(() => {
            console.log(`[ChainSwitch] Default tokens loaded for ${newChain}`);
          });
        }
      }
    });
    
    return unsubscribe;
  }, [onChainChange, setDefaultTokensForChain]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices, chain]);

  // Listen for token selection from main search bar and load historical data
  useEffect(() => {
    if (selectedFromToken && selectionVersion > 0) {
      const token = selectedFromToken as ExtendedToken;
      setFromToken(token);
      showToast(`Selected ${token.symbol} as FROM token`, { type: 'success', ttl: 2000 });
      clearSelection();
      
    }
  }, [selectedFromToken, selectionVersion, clearSelection, chain]);

  // Price-based estimate
  useEffect(() => {
    if (fromToken && toToken && fromAmount && fromPriceUsd !== null && toPriceUsd !== null) {
      const amount = parseFloat(fromAmount);
      if (!isNaN(amount) && amount > 0 && fromPriceUsd > 0 && toPriceUsd > 0) {
        const fromUSD = amount * fromPriceUsd;
        const estimatedTo = fromUSD / toPriceUsd;
        setToAmount(estimatedTo.toFixed(6));
      } else {
        setToAmount('');
      }
    } else {
      setToAmount('');
    }
  }, [fromAmount, fromPriceUsd, toPriceUsd, fromToken, toToken]);

  // Fetch real quote (bridge or swap depending on chain mode)
  useEffect(() => {
    const fetchQuote = async () => {
      if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
        setQuote(null);
        setIsBridgeMode(false);
        return;
      }

      try {
        const amountBN = ethers.utils.parseUnits(fromAmount, fromToken.decimals);
        const fromChainId = getTokenChainId(fromToken);
        const toChainId = getTokenChainId(toToken);
        const isBridge = chain === 'BRG' && fromChainId !== toChainId;
        
        setIsBridgeMode(isBridge);
        
        let result: QuoteResult | null = null;
        
        if (isBridge) {
          // Cross-chain bridge via LIFI only
          console.log(`[Quote] Bridge mode: ${fromChainId} -> ${toChainId}`);
          result = await getLifiBridgeQuote(
            fromToken.address,
            toToken.address,
            amountBN.toString(),
            toToken.decimals,
            fromChainId,
            toChainId,
            address || '0x0000000000000000000000000000000000000000'
          );
        } else {
          // Same-chain swap: compare 0x + LIFI
          const effectiveChain = chain === 'BRG' 
            ? (fromChainId === 1 ? 'ETH' : 'POL') 
            : chain;
          result = await getBestQuote(
            fromToken.address,
            toToken.address,
            amountBN.toString(),
            fromToken.decimals,
            toToken.decimals,
            slippage,
            address || '0x0000000000000000000000000000000000000000',
            effectiveChain
          );
        }

        if (result) {
          setQuote(result);
        } else {
          setQuote(null);
        }
      } catch (e) {
        console.error('Quote error:', e);
        setQuote(null);
      }
    };

    const debounce = setTimeout(fetchQuote, 500);
    return () => clearTimeout(debounce);
  }, [fromToken, toToken, fromAmount, slippage, chain]);

  // Refresh prices periodically - every 2 minutes to match server sequence
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPrices();
    }, 120000); // 2 minutes - matches server's 2-minute alternating source sequence

    return () => clearInterval(interval);
  }, [fetchPrices]);

  const handleSwapTokens = () => {
    const tempToken = fromToken;
    const tempAmount = fromAmount;
    const tempPrice = fromPriceUsd;

    setFromToken(toToken);
    setToToken(tempToken);
    setFromAmount(toAmount);
    setToAmount(tempAmount);
    setFromPriceUsd(toPriceUsd);
    setToPriceUsd(tempPrice);
  };

  const handleSwapClick = () => {
    if (!isConnected || !address) {
      showToast('Please connect your wallet first to swap tokens', { type: 'warn', ttl: 4000 });
      return;
    }

    if (!fromToken || !toToken) {
      showToast('Please select both tokens to swap', { type: 'warn', ttl: 4000 });
      return;
    }

    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      showToast('Please enter an amount to swap', { type: 'warn', ttl: 4000 });
      return;
    }

    if (insufficientFunds) {
      showToast(`Insufficient ${fromToken.symbol} balance. You have ${userBalance} ${fromToken.symbol}`, { type: 'error', ttl: 5000 });
      return;
    }

    if (!quote) {
      showToast('Fetching best price... please wait', { type: 'info', ttl: 3000 });
      return;
    }

    handleSwap();
  };

  const handleSwap = async () => {
    if (!isConnected || !address) {
      showToast('Please connect your wallet first', { type: 'error', ttl: 3000 });
      return;
    }

    if (!fromToken || !toToken) {
      showToast('Please select both tokens', { type: 'error', ttl: 3000 });
      return;
    }

    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      showToast('Please enter a valid amount', { type: 'error', ttl: 3000 });
      return;
    }

    setIsSwapping(true);
    setSwapStep('Preparing transaction...');

    try {
      const amountWei = ethers.utils.parseUnits(fromAmount, fromToken.decimals);
      
      // Determine actual chain IDs from tokens
      const fromChainId = getTokenChainId(fromToken);
      const toChainId = getTokenChainId(toToken);
      const isBridge = chain === 'BRG' && fromChainId !== toChainId;
      
      // Determine effective chain for same-chain swaps
      const effectiveChain = chain === 'BRG' 
        ? (fromChainId === 1 ? 'ETH' : 'POL')
        : chain;
      
      console.log(`[Swap] Starting: ${fromAmount} ${fromToken.symbol} -> ${toToken.symbol} | Mode: ${chain} | FromChain: ${fromChainId} | ToChain: ${toChainId} | IsBridge: ${isBridge}`);

      let bestQuote: QuoteResult | null = null;

      if (isBridge) {
        // Cross-chain bridge via LIFI
        setSwapStep('Finding bridge route via LIFI...');
        showToast('Finding best bridge route...', { type: 'info', ttl: 2000 });
        console.log(`[Swap] Bridge mode: ${fromChainId} -> ${toChainId}`);
        
        bestQuote = await getLifiBridgeQuote(
          fromToken.address,
          toToken.address,
          amountWei.toString(),
          toToken.decimals,
          fromChainId,
          toChainId,
          address || '0x0000000000000000000000000000000000000000'
        );
      } else {
        // Same-chain swap: compare 0x + LIFI
        setSwapStep('Finding best price...');
        showToast('Finding best swap route...', { type: 'info', ttl: 2000 });
        console.log(`[Swap] Same-chain swap on ${effectiveChain}`);
        
        bestQuote = await getBestQuote(
          fromToken.address,
          toToken.address,
          amountWei.toString(),
          fromToken.decimals,
          toToken.decimals,
          slippage,
          address || '0x0000000000000000000000000000000000000000',
          effectiveChain
        );
      }

      if (!bestQuote) {
        showToast('No liquidity available for this pair. Try a different token or smaller amount.', { type: 'error', ttl: 5000 });
        console.warn('[Swap] No quote available');
        return;
      }

      setQuote(bestQuote);
      console.log(`[Swap] Got quote from ${bestQuote.source}`);
      
      // Show warning if using fallback quote due to slippage mismatch
      if (bestQuote.source === 'lifi' && slippage < 1) {
        showToast(`⚠️ Using alternative quote with ${slippage}% slippage. Best price may have changed. Proceed?`, { type: 'warn', ttl: 6000 });
      }

      const provider = new ethers.providers.Web3Provider(window.ethereum as any);
      const signer = provider.getSigner();

      // Check if token needs approval (not native token)
      if (!isNativeToken(fromToken.address)) {
        setSwapStep('Checking token approval...');
        const spender = bestQuote.data?.to || (effectiveChain === 'ETH' ? ethereumConfig.zeroXBase : config.zeroXBase);
        const allowance = await checkAllowance(provider, fromToken.address, address, spender);

        if (allowance.lt(amountWei)) {
          setSwapStep('Requesting token approval...');
          showToast('Approve token spending in your wallet...', { type: 'info', ttl: 5000 });
          await approveToken(signer, fromToken.address, spender, ethers.constants.MaxUint256);
          showToast('Token approved successfully!', { type: 'success', ttl: 3000 });
        }
      }

      setSwapStep(`Executing ${isBridge ? 'bridge' : 'swap'} via ${bestQuote.source}...`);
      showToast(`Confirm the ${isBridge ? 'bridge' : 'swap'} in your wallet...`, { type: 'info', ttl: 5000 });
      
      const tx = await executeSwap(
        signer,
        bestQuote,
        fromToken.address,
        toToken.address,
        amountWei.toString(),
        fromToken.decimals,
        slippage,
        effectiveChain
      );

      if (tx) {
        setSwapStep('Waiting for confirmation...');
        showToast('Transaction submitted! Waiting for confirmation...', { type: 'info', ttl: 5000 });
        
        const receipt = await tx.wait();
        
        const explorerUrl = effectiveChain === 'ETH' ? ethereumConfig.explorerUrl : config.explorerUrl;
        showToast(`${isBridge ? 'Bridge' : 'Swap'} successful! ${fromAmount} ${fromToken.symbol} → ${toToken.symbol}`, { type: 'success', ttl: 8000 });
        
        // Trigger celebration animation with mode-specific colors
        let confettiColors = ['#7013ff', '#b444ff', '#ffffff']; // Default (POL/General)
        
        if (chain === 'ETH') {
          confettiColors = ['#627EEA', '#3C3C3D', '#ffffff']; // ETH colors (Blue/Grey/White)
        } else if (chain === 'BRG') {
          confettiColors = ['#00ffcc', '#0099ff', '#ffffff']; // Bridge colors (Cyan/Azure/White)
        } else if (chain === 'POL') {
          confettiColors = ['#8247E5', '#ffffff']; // Polygon colors (Purple/White)
        }

        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: confettiColors
        });

        setFromAmount('');
        setToAmount('');
        await fetchPrices();
      }
    } catch (error: any) {
      const errorMsg = parseSwapError(error, chain);
      showToast(errorMsg, { type: 'error', ttl: 6000 });
      console.error('Swap error:', error);
    } finally {
      setIsSwapping(false);
      setSwapStep('');
    }
  };

  const canSwap =
    isConnected &&
    fromToken &&
    toToken &&
    parseFloat(fromAmount) > 0 &&
    !isSwapping &&
    !insufficientFunds;

  const getButtonText = () => {
    const action = isBridgeMode ? 'Bridge' : 'Swap';
    if (!isConnected) return `Connect Wallet to ${action}`;
    if (!fromToken || !toToken) return 'Select Tokens';
    if (!fromAmount || parseFloat(fromAmount) <= 0) return 'Enter Amount';
    if (insufficientFunds) return `Insufficient ${fromToken?.symbol || ''} Balance`;
    if (isSwapping) return swapStep || 'Processing...';
    if (!quote) return `Finding Best ${isBridgeMode ? 'Bridge' : 'Price'}...`;
    return `${action} ${fromToken?.symbol || ''} for ${toToken?.symbol || ''}`;
  };
  
  const getButtonStyle = () => {
    if (insufficientFunds) {
      return {
        background: 'linear-gradient(90deg, #ff4444, #cc3333)',
        cursor: 'not-allowed',
      };
    }
    if (!isConnected) {
      return {
        background: 'linear-gradient(90deg, rgba(180, 68, 255, 0.4), rgba(112, 19, 255, 0.3))',
      };
    }
    if (canSwap) {
      return {
        background: 'linear-gradient(90deg, var(--accent-1), var(--accent-2))',
      };
    }
    return {};
  };

  return (
    <div className="section-wrapper">
      <div
        className="glass-card card-entrance"
        style={{
          width: '90%',
          maxWidth: 'var(--container-max)',
        }}
        data-testid="card-swap"
      >
        <h1 className="dex-heading" data-testid="text-heading">
          NOLA Exchange
        </h1>

        <TokenInput
          side="from"
          selectedToken={fromToken}
          amount={fromAmount}
          onTokenSelect={setFromToken}
          onAmountChange={setFromAmount}
          priceUsd={fromPriceUsd}
        />

        {insufficientFunds && userBalance && (
          <div style={{ 
            color: '#ff9e9e', 
            fontSize: '12px', 
            marginTop: '4px',
            textAlign: 'right',
            padding: '0 8px'
          }}>
            Balance: {userBalance} {fromToken?.symbol}
          </div>
        )}

        <TokenInput
          side="to"
          selectedToken={toToken}
          amount={toAmount}
          onTokenSelect={setToToken}
          onAmountChange={() => {}}
          priceUsd={toPriceUsd}
          isEstimate
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '14px',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              className="swap-outside"
              onClick={handleSwapTokens}
              role="button"
              aria-label="Swap From ↔ To"
              data-testid="button-swap-tokens"
            >
              ⇅
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <SlippageControl value={slippage} onChange={setSlippage} />
          </div>
        </div>


        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}>
          <button
            className="glassy-btn"
            style={{
              width: '100%',
              justifyContent: 'center',
              ...getButtonStyle(),
            }}
            onClick={handleSwapClick}
            disabled={isSwapping}
            data-testid="button-swap-main"
          >
            {isSwapping ? (
              <>
                <span className="btn-spinner" />
                <span>{swapStep || 'Swapping...'}</span>
              </>
            ) : (
              <>
                <span className="icon">⇄</span>
                <span className="label">{getButtonText()}</span>
              </>
            )}
          </button>
        </div>

        {quote && !isSwapping && (
          <div
            style={{
              textAlign: 'center',
              marginTop: '12px',
              fontSize: '13px',
              opacity: 0.8,
            }}
            data-testid="text-quote-source"
          >
            {isBridgeMode 
              ? `Bridge via LIFI (${getTokenChainId(fromToken) === 1 ? 'ETH' : 'POL'} → ${getTokenChainId(toToken) === 1 ? 'ETH' : 'POL'})`
              : `Best price via ${quote.source === '0x' ? '0x Protocol' : 'LIFI'} on ${chain === 'BRG' ? (getTokenChainId(fromToken) === 1 ? 'ETH' : 'POL') : chain}`
            }
          </div>
        )}

      </div>
      <TokenInfoSidebar 
        fromToken={fromToken} 
        toToken={toToken} 
        fromPriceUsd={fromPriceUsd}
        toPriceUsd={toPriceUsd}
        fromChange24h={fromChange24h}
        toChange24h={toChange24h}
        fromVolume24h={fromVolume24h}
        toVolume24h={toVolume24h}
        fromMarketCap={fromMarketCap}
        toMarketCap={toMarketCap}
        fromPriceHistory={fromPriceHistory}
        toPriceHistory={toPriceHistory}
        isRadarOpen={isRadarOpen}
        onRadarToggle={(open) => {
          setIsRadarOpen(open);
          if (open) setIsChatOpen(false);
        }}
        isChatOpen={isChatOpen}
      />
    </div>
  );
}
