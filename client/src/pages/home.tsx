import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useChainId, useBalance } from 'wagmi';
import { ethers } from 'ethers';
import { useLocation } from 'wouter';
import { TokenInput } from '@/components/TokenInput';
import { SlippageControl } from '@/components/SlippageControl';
import { showToast } from '@/components/Toast';
import { Token, loadTokensAndMarkets, loadTokensForChain, getTokenPriceUSD, getTokenMap, getTokenByAddress } from '@/lib/tokenService';
import { getBestQuote, getLifiBridgeQuote, executeSwap, approveToken, checkAllowance, parseSwapError, QuoteResult } from '@/lib/swapService';
import { config, ethereumConfig, low, isAddress } from '@/lib/config';
import { useChain, ChainType, chainConfigs } from '@/lib/chainContext';
import { useTokenSelection } from '@/lib/tokenSelectionContext';

interface ExtendedToken extends Token {
  chainId?: number;
}

// ETH chain: ETH (native) -> USDC (verified contract addresses)
// Verified: https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
const ETHEREUM_DEFAULTS = {
  fromToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH native (0x standard)
  toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC Ethereum (verified mainnet)
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

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapStep, setSwapStep] = useState<string>('');
  const [tokensLoaded, setTokensLoaded] = useState(false);
  const [userBalance, setUserBalance] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [isBridgeMode, setIsBridgeMode] = useState(false);
  const previousChainRef = useRef<ChainType>(chain);

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
    // Use token-specific chainId in BRG mode
    const fromChainId = fromToken ? getTokenChainId(fromToken) : (chain === 'ETH' ? 1 : 137);
    const toChainId = toToken ? getTokenChainId(toToken) : (chain === 'ETH' ? 1 : 137);
    
    if (fromToken) {
      try {
        const price = await getTokenPriceUSD(fromToken.address, fromToken.decimals, fromChainId);
        setFromPriceUsd(price);
      } catch (e) {
        console.error("Failed to fetch price for fromToken:", fromToken.address, e);
        setFromPriceUsd(null);
      }
    } else {
      setFromPriceUsd(null);
    }

    if (toToken) {
      try {
        const price = await getTokenPriceUSD(toToken.address, toToken.decimals, toChainId);
        setToPriceUsd(price);
      } catch (e) {
        console.error("Failed to fetch price for toToken:", toToken.address, e);
        setToPriceUsd(null);
      }
    } else {
      setToPriceUsd(null);
    }
  }, [fromToken, toToken, chain]);

  const setDefaultTokensForChain = useCallback(async (chainType: ChainType) => {
    const targetChainId = chainType === 'ETH' ? 1 : 137;
    const defaults = chainType === 'ETH' ? ETHEREUM_DEFAULTS : POLYGON_DEFAULTS;
    
    await loadTokensForChain(targetChainId);
    const tokenMap = getTokenMap(targetChainId);
    
    const fromTokenAddr = low(defaults.fromToken);
    const toTokenAddr = low(defaults.toToken);
    
    let newFromToken = tokenMap.get(fromTokenAddr);
    let newToToken = tokenMap.get(toTokenAddr);
    
    // Native ETH for Ethereum chain (using 0x standard address)
    if (chainType === 'ETH' && !newFromToken) {
      newFromToken = {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      };
      console.log('[ETH Defaults] Created native ETH token with 0x standard address');
    }
    
    // USDC fallback for ETH (verified contract)
    if (chainType === 'ETH' && !newToToken) {
      newToToken = {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
      };
      console.log('[ETH Defaults] Created USDC token with verified address');
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
          // BRG mode: keep token selections, just clear quotes and amounts
          setFromAmount('');
          setToAmount('');
          setQuote(null);
          console.log(`[ChainSwitch] Entered BRG mode, preserving token selections`);
        } else if (leavingBrgMode) {
          // Leaving BRG mode: reset all and load defaults for new chain
          setFromAmount('');
          setToAmount('');
          setQuote(null);
          setFromPriceUsd(null);
          setToPriceUsd(null);
          setInsufficientFunds(false);
          setUserBalance(null);
          setFromToken(null);
          setToToken(null);
          
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
          setFromToken(null);
          setToToken(null);
          
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
  }, [fetchPrices]);

  // Listen for token selection from main search bar
  useEffect(() => {
    if (selectedFromToken && selectionVersion > 0) {
      setFromToken(selectedFromToken as ExtendedToken);
      showToast(`Selected ${selectedFromToken.symbol} as FROM token`, { type: 'success', ttl: 2000 });
      clearSelection();
    }
  }, [selectedFromToken, selectionVersion, clearSelection]);

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

  // Refresh prices periodically
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPrices();
    }, 8000);

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

    const currentChainId = chain === 'ETH' ? 1 : 137;
    const currentConfig = chain === 'ETH' ? ethereumConfig : config;

    try {
      const amountWei = ethers.utils.parseUnits(fromAmount, fromToken.decimals);

      setSwapStep('Finding best price via 0x...');
      showToast('Finding best swap route...', { type: 'info', ttl: 2000 });
      
      console.log(`[Swap] Starting swap: ${fromAmount} ${fromToken.symbol} -> ${toToken.symbol} on ${chain}`);
      
      const bestQuote = await getBestQuote(
        fromToken.address,
        toToken.address,
        amountWei.toString(),
        fromToken.decimals,
        toToken.decimals,
        slippage,
        address || '0x0000000000000000000000000000000000000000',
        chain
      );

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
        const spender = bestQuote.data?.to || (chain === 'ETH' ? ethereumConfig.zeroXBase : config.zeroXBase);
        const allowance = await checkAllowance(provider, fromToken.address, address, spender);

        if (allowance.lt(amountWei)) {
          setSwapStep('Requesting token approval...');
          showToast('Approve token spending in your wallet...', { type: 'info', ttl: 5000 });
          await approveToken(signer, fromToken.address, spender, ethers.constants.MaxUint256);
          showToast('Token approved successfully!', { type: 'success', ttl: 3000 });
        }
      }

      setSwapStep(`Executing swap via ${bestQuote.source}...`);
      showToast(`Confirm the swap in your wallet...`, { type: 'info', ttl: 5000 });
      
      const tx = await executeSwap(
        signer,
        bestQuote,
        fromToken.address,
        toToken.address,
        amountWei.toString(),
        fromToken.decimals,
        slippage,
        chain
      );

      if (tx) {
        setSwapStep('Waiting for confirmation...');
        showToast('Transaction submitted! Waiting for confirmation...', { type: 'info', ttl: 5000 });
        
        const receipt = await tx.wait();
        
        const explorerUrl = chain === 'ETH' ? ethereumConfig.explorerUrl : config.explorerUrl;
        showToast(`Swap successful! ${fromAmount} ${fromToken.symbol} → ${toToken.symbol}`, { type: 'success', ttl: 8000 });
        
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
    </div>
  );
}
