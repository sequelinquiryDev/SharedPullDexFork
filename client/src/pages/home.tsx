
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

  // Fetch prices for selected tokens
  useEffect(() => {
    if (fromToken) {
      getTokenPriceUSD(fromToken.address, fromToken.decimals).then(setFromPriceUsd);
    } else {
      setFromPriceUsd(null);
    }
  }, [fromToken]);

  useEffect(() => {
    if (toToken) {
      getTokenPriceUSD(toToken.address, toToken.decimals).then(setToPriceUsd);
    } else {
      setToPriceUsd(null);
    }
  }, [toToken]);

  // Simple price-based estimate (updates immediately - NO external fetching)
  // This is pure math: (fromAmount * fromPrice) / toPrice = estimatedToAmount
  useEffect(() => {
    if (fromToken && toToken && fromAmount && fromPriceUsd && toPriceUsd) {
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

  // Refresh prices periodically (every 5 seconds for better UX)
  useEffect(() => {
    if (!fromToken && !toToken) return;

    const interval = setInterval(() => {
      if (fromToken) {
        getTokenPriceUSD(fromToken.address, fromToken.decimals).then(setFromPriceUsd);
      }
      if (toToken) {
        getTokenPriceUSD(toToken.address, toToken.decimals).then(setToPriceUsd);
      }
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [fromToken, toToken]);

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

    setIsSwapping(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum as any);
      const signer = provider.getSigner();
      const amountBN = ethers.utils.parseUnits(fromAmount, fromToken.decimals);

      // Platform fee: 0.01 MATIC to recipient
      const feeAmountBN = ethers.utils.parseEther('0.01');
      console.log('Platform Fee Details:', {
        amount: '0.01 MATIC',
        recipient: config.feeRecipient,
        amountWei: feeAmountBN.toString()
      });

      showToast('Collecting 0.01 MATIC platform fee...', { type: 'info' });
      const feeTx = await signer.sendTransaction({
        to: config.feeRecipient,
        value: feeAmountBN,
      });
      await feeTx.wait();
      console.log('Fee transaction confirmed:', feeTx.hash);
      showToast('Fee collected, proceeding with swap...', { type: 'success' });

      const isNativeToken =
        low(fromToken.address) === low(config.maticAddr) ||
        low(fromToken.address) === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

      if (!isNativeToken && quote.source === '0x' && quote.data?.allowanceTarget) {
        const allowance = await checkAllowance(
          provider,
          fromToken.address,
          address,
          quote.data.allowanceTarget
        );

        if (allowance.lt(amountBN)) {
          showToast('Approving token...', { type: 'info' });
          await approveToken(
            signer,
            fromToken.address,
            quote.data.allowanceTarget,
            ethers.constants.MaxUint256
          );
          showToast('Token approved!', { type: 'success' });
        }
      }

      showToast('Submitting swap...', { type: 'info' });
      const tx = await executeSwap(
        signer,
        quote,
        fromToken.address,
        toToken.address,
        amountBN.toString(),
        fromToken.decimals,
        slippage
      );

      if (tx) {
        showToast('Swap submitted!', { type: 'success', txHash: tx.hash, ttl: 6000 });
        await tx.wait();
        showToast('Swap confirmed!', { type: 'success', txHash: tx.hash, ttl: 8000 });
        setFromAmount('');
        setToAmount('');
        setQuote(null);
      }
    } catch (e: any) {
      console.error('Swap error:', e);
      showToast(parseSwapError(e), { type: 'error', ttl: 6000 });
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
