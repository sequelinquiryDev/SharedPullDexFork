import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useChainId, useBalance } from 'wagmi';
import { ethers } from 'ethers';
import { useLocation } from 'wouter';
import { TokenInput } from '@/components/TokenInput';
import { SlippageControl } from '@/components/SlippageControl';
import { showToast } from '@/components/Toast';
import { Token, loadTokensAndMarkets, loadTokensForChain, getTokenPriceUSD, getTokenMap, getTokenByAddress } from '@/lib/tokenService';
import { getBestQuote, executeSwap, approveToken, checkAllowance, parseSwapError, QuoteResult } from '@/lib/swapService';
import { config, ethereumConfig, low, isAddress } from '@/lib/config';
import { useChain, ChainType, chainConfigs } from '@/lib/chainContext';

// ETH chain: ETH (native) -> USDT
const ETHEREUM_DEFAULTS = {
  fromToken: '0x0000000000000000000000000000000000000000', // ETH (native)
  toToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
};

// POL chain: USDC -> WETH
const POLYGON_DEFAULTS = {
  fromToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
  toToken: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
};

// Fee configuration
const FEE_CONFIG = {
  ETH: { feeUsd: 1.2, feeToken: 'ETH' },
  POL: { feePercent: 0.00001, feeToken: 'MATIC' },
};

export default function Home() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { chain, chainConfig, setChain, onChainChange } = useChain();
  const [location] = useLocation();

  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [toToken, setToToken] = useState<Token | null>(null);
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
  const previousChainRef = useRef<ChainType>(chain);

  // Get user balance for from token
  const { data: nativeBalance } = useBalance({
    address: address,
    chainId: chain === 'ETH' ? 1 : 137,
  });

  const { data: tokenBalance } = useBalance({
    address: address,
    token: fromToken && fromToken.address !== '0x0000000000000000000000000000000000000000' 
      ? fromToken.address as `0x${string}` 
      : undefined,
    chainId: chain === 'ETH' ? 1 : 137,
  });

  // Check balance and set insufficient funds state
  useEffect(() => {
    if (!fromToken || !fromAmount || !address) {
      setInsufficientFunds(false);
      setUserBalance(null);
      return;
    }

    const isNative = fromToken.address === '0x0000000000000000000000000000000000000000' ||
      fromToken.address === config.maticAddr;

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
    const currentChainId = chain === 'ETH' ? 1 : 137;
    
    if (fromToken) {
      try {
        const price = await getTokenPriceUSD(fromToken.address, fromToken.decimals, currentChainId);
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
        const price = await getTokenPriceUSD(toToken.address, toToken.decimals, currentChainId);
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
    
    // Native ETH for Ethereum chain
    if (chainType === 'ETH' && !newFromToken) {
      newFromToken = {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      };
    }
    
    // USDT fallback for ETH
    if (chainType === 'ETH' && !newToToken) {
      newToToken = {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
      };
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
        previousChainRef.current = newChain;
        
        setFromAmount('');
        setToAmount('');
        setQuote(null);
        setFromPriceUsd(null);
        setToPriceUsd(null);
        setInsufficientFunds(false);
        
        setDefaultTokensForChain(newChain);
      }
    });
    
    return unsubscribe;
  }, [onChainChange, setDefaultTokensForChain]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

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

  // Fetch real quote
  useEffect(() => {
    const fetchQuote = async () => {
      if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
        setQuote(null);
        return;
      }

      try {
        const amountBN = ethers.utils.parseUnits(fromAmount, fromToken.decimals);
        const result = await getBestQuote(
          fromToken.address,
          toToken.address,
          amountBN.toString(),
          fromToken.decimals,
          toToken.decimals,
          slippage,
          chain
        );

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
    const nativeAddr = chain === 'ETH' ? '0x0000000000000000000000000000000000000000' : config.maticAddr;

    try {
      const amountWei = ethers.utils.parseUnits(fromAmount, fromToken.decimals);

      setSwapStep('Finding best price via 0x...');
      showToast('Finding best swap route...', { type: 'info', ttl: 2000 });
      
      const bestQuote = await getBestQuote(
        fromToken.address,
        toToken.address,
        amountWei.toString(),
        fromToken.decimals,
        toToken.decimals,
        slippage,
        chain
      );

      if (!bestQuote) {
        showToast('No liquidity available for this pair. Try a different token or smaller amount.', { type: 'error', ttl: 5000 });
        return;
      }

      setQuote(bestQuote);

      const provider = new ethers.providers.Web3Provider(window.ethereum as any);
      const signer = provider.getSigner();

      // Check if token needs approval (not native token)
      if (fromToken.address !== nativeAddr && fromToken.address !== '0x0000000000000000000000000000000000000000') {
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
    if (!isConnected) return 'Connect Wallet';
    if (!fromToken || !toToken) return 'Select Tokens';
    if (!fromAmount || parseFloat(fromAmount) <= 0) return 'Enter Amount';
    if (insufficientFunds) return `Insufficient ${fromToken?.symbol || ''} Balance`;
    if (isSwapping) return swapStep || 'Swapping...';
    if (!quote) return 'Fetching Price...';
    return 'Swap';
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
              background: canSwap
                ? 'linear-gradient(90deg, var(--accent-1), var(--accent-2))'
                : insufficientFunds
                ? 'linear-gradient(90deg, #ff4444, #cc3333)'
                : undefined,
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
            Best price via {quote.source === '0x' ? '0x Protocol' : '1inch'} on {chain}
          </div>
        )}

        {chain === 'ETH' && (
          <div
            style={{
              textAlign: 'center',
              marginTop: '8px',
              fontSize: '11px',
              opacity: 0.6,
            }}
          >
            Fee: ~$1.20 (paid in ETH)
          </div>
        )}
      </div>
    </div>
  );
}
