import { useState, useEffect, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { ethers } from 'ethers';
import { TokenInput } from '@/components/TokenInput';
import { SlippageControl } from '@/components/SlippageControl';
import { showToast } from '@/components/Toast';
import { Token, loadTokensAndMarkets, getTokenPriceUSD, getTokenMap } from '@/lib/tokenService';
import { getBestQuote, executeSwap, approveToken, checkAllowance, parseSwapError, QuoteResult } from '@/lib/swapService';
import { config, low, explorerTxLink } from '@/lib/config';

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
  const [isQuoting, setIsQuoting] = useState(false);
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

  const fetchQuote = useCallback(async () => {
    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount('');
      setQuote(null);
      return;
    }

    setIsQuoting(true);
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
        setToAmount(result.normalized.toFixed(6));
      } else {
        setQuote(null);
        setToAmount('');
        showToast('No quotes available for this pair', { type: 'warn' });
      }
    } catch (e) {
      console.error('Quote error:', e);
      setToAmount('');
      setQuote(null);
    } finally {
      setIsQuoting(false);
    }
  }, [fromToken, toToken, fromAmount, slippage]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchQuote();
    }, 300);
    return () => clearTimeout(debounce);
  }, [fetchQuote]);

  const handleSwapTokens = () => {
    const tempToken = fromToken;
    const tempAmount = fromAmount;
    setFromToken(toToken);
    setToToken(tempToken);
    setFromAmount(toAmount);
    setToAmount(tempAmount);
  };

  const handleSwap = async () => {
    if (!isConnected || !address) {
      showToast('Connect your wallet first', { type: 'warn' });
      return;
    }

    if (chainId !== config.chainId) {
      showToast('Switch to Polygon network', { type: 'warn' });
      return;
    }

    if (!fromToken || !toToken || !fromAmount || !quote) {
      showToast('Enter valid swap details', { type: 'warn' });
      return;
    }

    setIsSwapping(true);
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum as any);
      const signer = provider.getSigner();
      const amountBN = ethers.utils.parseUnits(fromAmount, fromToken.decimals);

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
    quote !== null &&
    !isSwapping;

  return (
    <div
      className="section-wrapper"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '140px 18px 100px',
        minHeight: 'calc(100dvh)',
        gap: '14px',
      }}
    >
      <div
        className="glass-card card-entrance"
        style={{
          width: '100%',
          maxWidth: 'var(--container-max)',
        }}
        data-testid="card-swap"
      >
        <h1 className="dex-heading" data-testid="text-heading">
          NOLA Swap
        </h1>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
            gap: '10px',
          }}
        >
          <SlippageControl value={slippage} onChange={setSlippage} />
          <button
            className="quick-cta"
            disabled={!canSwap}
            onClick={handleSwap}
            data-testid="button-quick-swap"
          >
            {isSwapping ? <span className="btn-spinner" /> : 'Quick Swap'}
          </button>
        </div>

        <TokenInput
          side="from"
          selectedToken={fromToken}
          amount={fromAmount}
          onTokenSelect={setFromToken}
          onAmountChange={setFromAmount}
          priceUsd={fromPriceUsd}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            margin: '8px 0',
          }}
        >
          <div
            className="swap-outside"
            onClick={handleSwapTokens}
            role="button"
            aria-label="Swap tokens"
            data-testid="button-swap-direction"
          >
            ↕
          </div>
        </div>

        <TokenInput
          side="to"
          selectedToken={toToken}
          amount={toAmount}
          onTokenSelect={setToToken}
          onAmountChange={() => {}}
          priceUsd={toPriceUsd}
          isEstimate
        />

        {isQuoting && (
          <div
            style={{
              textAlign: 'center',
              marginTop: '12px',
              opacity: 0.7,
              fontSize: '14px',
            }}
            data-testid="text-quoting"
          >
            Fetching best price...
          </div>
        )}

        {quote && !isQuoting && (
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

        <button
          className="glassy-btn"
          style={{
            width: '100%',
            marginTop: '16px',
            justifyContent: 'center',
            background: canSwap
              ? 'linear-gradient(90deg, var(--accent-1), var(--accent-2))'
              : undefined,
          }}
          disabled={!canSwap}
          onClick={handleSwap}
          data-testid="button-swap-main"
        >
          {isSwapping ? (
            <>
              <span className="btn-spinner" />
              <span>Swapping...</span>
            </>
          ) : !isConnected ? (
            'Connect Wallet to Swap'
          ) : chainId !== config.chainId ? (
            'Switch to Polygon'
          ) : !fromToken || !toToken ? (
            'Select Tokens'
          ) : !fromAmount || parseFloat(fromAmount) <= 0 ? (
            'Enter Amount'
          ) : !quote ? (
            'No Quote Available'
          ) : (
            'Swap'
          )}
        </button>
      </div>
    </div>
  );
}
