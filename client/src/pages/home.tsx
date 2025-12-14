import { useState, useEffect, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { ethers } from 'ethers';
import { TokenInput } from '@/components/TokenInput';
import { SlippageControl } from '@/components/SlippageControl';
import { showToast } from '@/components/Toast';
import { Token, loadTokensAndMarkets, getTokenPriceUSD, getTokenMap } from '@/lib/tokenService';
import { getBestQuote, executeSwap, approveToken, checkAllowance, parseSwapError, QuoteResult } from '@/lib/swapService';
import { config, low } from '@/lib/config';

export default function Home() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [toToken, setToToken] = useState<Token | null>(null);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState(config.defaultSlippage);

  const [fromPriceUsd, setFromPriceUsd] = useState<number | null>(null);
  const [toPriceUsd, setToPriceUsd] = useState<number | null>(null);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [tokensLoaded, setTokensLoaded] = useState(false);

  // Function to fetch prices for selected tokens
  const fetchPrices = useCallback(async () => {
    if (fromToken) {
      try {
        const price = await getTokenPriceUSD(fromToken.address, fromToken.decimals);
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
        const price = await getTokenPriceUSD(toToken.address, toToken.decimals);
        setToPriceUsd(price);
      } catch (e) {
        console.error("Failed to fetch price for toToken:", toToken.address, e);
        setToPriceUsd(null);
      }
    } else {
      setToPriceUsd(null);
    }
  }, [fromToken, toToken]);


  useEffect(() => {
    loadTokensAndMarkets().then(() => {
      setTokensLoaded(true);
      const tokenMap = getTokenMap();
      const usdc = tokenMap.get(low(config.usdcAddr));
      const weth = tokenMap.get(low(config.wethAddr));
      if (usdc) setFromToken(usdc);
      if (weth) setToToken(weth);
    });
  }, []);

  // Fetch prices for selected tokens using the useCallback function
  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  // Simple price-based estimate (updates immediately - NO external fetching)
  // This is pure math: (fromAmount * fromPrice) / toPrice = estimatedToAmount
  useEffect(() => {
    if (fromToken && toToken && fromAmount && fromPriceUsd !== null && toPriceUsd !== null) {
      const amount = parseFloat(fromAmount);
      if (!isNaN(amount) && amount > 0 && fromPriceUsd > 0 && toPriceUsd > 0) {
        // Simple calculation: convert to USD, then to target token
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

  // Fetch real quote in background for accurate swap
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
          slippage
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
  }, [fromToken, toToken, fromAmount, slippage]);

  // Refresh prices periodically (every 8 seconds for real-time trading)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPrices();
    }, 8000); // Update every 8 seconds

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

    if (chainId !== config.chainId) {
      showToast('Please switch to Polygon network (Chain ID: 137)', { type: 'warn', ttl: 4000 });
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

    if (!quote) {
      showToast('Fetching quote... please wait', { type: 'info', ttl: 3000 });
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

    if (chainId !== config.chainId) {
      showToast('Please switch to Polygon network (Chain ID: 137)', { type: 'error', ttl: 4000 });
      return;
    }

    setIsSwapping(true);

    try {
      const amountWei = ethers.utils.parseUnits(fromAmount, fromToken.decimals);

      showToast('Fetching best quote from 0x and 1inch...', { type: 'info', ttl: 2000 });
      const bestQuote = await getBestQuote(
        fromToken.address,
        toToken.address,
        amountWei.toString(),
        fromToken.decimals,
        toToken.decimals,
        slippage
      );

      if (!bestQuote) {
        showToast('No liquidity available for this trading pair. Try a different token or amount.', { type: 'error', ttl: 5000 });
        return;
      }

      setQuote(bestQuote);

      const provider = new ethers.providers.Web3Provider(window.ethereum as any);
      const signer = provider.getSigner();

      if (fromToken.address !== config.maticAddr) {
        const spender = bestQuote.data?.to || config.zeroXBase;
        const allowance = await checkAllowance(provider, fromToken.address, address, spender);

        if (allowance.lt(amountWei)) {
          showToast('Approval required. Please approve the token in your wallet...', { type: 'info', ttl: 3000 });
          await approveToken(signer, fromToken.address, spender, ethers.constants.MaxUint256);
          showToast('Token approved successfully!', { type: 'success', ttl: 3000 });
        }
      }

      showToast(`Executing swap via ${bestQuote.source}... Please confirm in your wallet.`, { type: 'info', ttl: 3000 });
      const tx = await executeSwap(
        signer,
        bestQuote,
        fromToken.address,
        toToken.address,
        amountWei.toString(),
        fromToken.decimals,
        slippage
      );

      if (tx) {
        showToast('Swap submitted! Waiting for blockchain confirmation...', { type: 'info', ttl: 3000 });
        const receipt = await tx.wait();
        showToast(`Swap successful! ${fromAmount} ${fromToken.symbol} → ${toToken.symbol}`, { type: 'success', ttl: 6000 });
        setFromAmount('');
        setToAmount('');
        await fetchPrices();
      }
    } catch (error: any) {
      const errorMsg = parseSwapError(error);
      showToast(errorMsg, { type: 'error', ttl: 6000 });
      console.error('Swap error:', error);
    } finally {
      setIsSwapping(false);
    }
  };

  const canSwap =
    isConnected &&
    chainId === config.chainId &&
    fromToken &&
    toToken &&
    parseFloat(fromAmount) > 0 &&
    !isSwapping;

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
                : undefined,
            }}
            onClick={handleSwapClick}
            data-testid="button-swap-main"
          >
            {isSwapping ? (
              <>
                <span className="btn-spinner" />
                <span>Swapping...</span>
              </>
            ) : (
              <>
                <span className="icon">⇄</span>
                <span className="label">Swap</span>
              </>
            )}
          </button>
        </div>

        {quote && (
          <div
            style={{
              textAlign: 'center',
              marginTop: '12px',
              fontSize: '13px',
              opacity: 0.8,
            }}
            data-testid="text-quote-source"
          >
            Best price via {quote.source === '0x' ? '0x Protocol' : '1inch'}
          </div>
        )}
      </div>
    </div>
  );
}