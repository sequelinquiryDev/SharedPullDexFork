import { ethers } from 'ethers';
import { config, fetchWithTimeout, low } from './config';

export interface QuoteResult {
  source: '0x' | '1inch';
  toAmount: string;
  normalized: number;
  data?: any;
}

const quoteCache = new Map<string, { best: QuoteResult; ts: number }>();

function makeQuoteKey(
  fromAddr: string,
  toAddr: string,
  amountWei: string,
  slippage: number
): string {
  return `${low(fromAddr)}-${low(toAddr)}-${amountWei}-${slippage}`;
}

async function fetch0xQuote(
  fromAddr: string,
  toAddr: string,
  sellAmount: string
): Promise<QuoteResult | null> {
  try {
    const url = `${config.zeroXBase}/swap/v1/quote?sellToken=${encodeURIComponent(fromAddr)}&buyToken=${encodeURIComponent(toAddr)}&sellAmount=${sellAmount}`;
    const resp = await fetchWithTimeout(url, { headers: { '0x-api-key': config.zeroXApiKey } }, 5000);
    if (!resp.ok) return null;
    const j = await resp.json();
    if (!j || !j.buyAmount) return null;
    const normalized = Number(ethers.utils.formatUnits(j.buyAmount, j.buyTokenDecimals || 18));
    return {
      source: '0x',
      toAmount: j.buyAmount,
      normalized,
      data: j,
    };
  } catch (e) {
    return null;
  }
}

async function fetch1InchQuote(
  fromAddr: string,
  toAddr: string,
  amount: string,
  fromDecimals: number,
  toDecimals: number,
  slippage: number
): Promise<QuoteResult | null> {
  try {
    const url = `${config.oneInchBase}/quote?fromTokenAddress=${fromAddr}&toTokenAddress=${toAddr}&amount=${amount}`;
    const resp = await fetchWithTimeout(url, {}, 5000);
    if (!resp.ok) return null;
    const j = await resp.json();
    if (!j || !j.toTokenAmount) return null;
    const normalized = Number(ethers.utils.formatUnits(j.toTokenAmount, toDecimals));
    return {
      source: '1inch',
      toAmount: j.toTokenAmount,
      normalized,
      data: j,
    };
  } catch (e) {
    return null;
  }
}

export async function getBestQuote(
  fromAddr: string,
  toAddr: string,
  amountWei: string,
  fromDecimals: number,
  toDecimals: number,
  slippage: number
): Promise<QuoteResult | null> {
  const key = makeQuoteKey(fromAddr, toAddr, amountWei, slippage);
  
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.ts < config.quoteCacheTtl) {
    return cached.best;
  }

  const [q0x, q1inch] = await Promise.all([
    fetch0xQuote(fromAddr, toAddr, amountWei),
    fetch1InchQuote(fromAddr, toAddr, amountWei, fromDecimals, toDecimals, slippage),
  ]);

  const quotes = [q0x, q1inch].filter(Boolean) as QuoteResult[];
  if (quotes.length === 0) return null;

  quotes.sort((a, b) => b.normalized - a.normalized);
  const best = quotes[0];

  quoteCache.set(key, { best, ts: Date.now() });
  return best;
}

export function getCachedQuote(
  fromAddr: string,
  toAddr: string,
  amountWei: string,
  slippage: number
): QuoteResult | null {
  const key = makeQuoteKey(fromAddr, toAddr, amountWei, slippage);
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.ts < config.quoteCacheTtl) {
    return cached.best;
  }
  return null;
}

export async function executeSwap(
  signer: ethers.Signer,
  quote: QuoteResult,
  fromAddr: string,
  toAddr: string,
  amountWei: string,
  fromDecimals: number,
  slippage: number
): Promise<ethers.providers.TransactionResponse | null> {
  const userAddress = await signer.getAddress();

  if (quote.source === '0x') {
    const data = quote.data;
    if (!data || !data.to || !data.data) {
      throw new Error('Invalid 0x quote data');
    }

    const tx: ethers.providers.TransactionRequest = {
      to: data.to,
      data: data.data,
      value: data.value ? ethers.BigNumber.from(data.value) : undefined,
      gasLimit: data.gas ? ethers.BigNumber.from(data.gas).mul(120).div(100) : undefined,
    };

    return await signer.sendTransaction(tx);
  } else if (quote.source === '1inch') {
    const swapUrl = `${config.oneInchBase}/swap?fromTokenAddress=${fromAddr}&toTokenAddress=${toAddr}&amount=${amountWei}&fromAddress=${userAddress}&slippage=${slippage}&disableEstimate=true`;
    const resp = await fetchWithTimeout(swapUrl, {}, 10000);
    if (!resp.ok) throw new Error('1inch swap call failed');
    const j = await resp.json();
    if (!j || !j.tx) throw new Error('Invalid 1inch swap response');

    const tx: ethers.providers.TransactionRequest = {
      to: j.tx.to,
      data: j.tx.data,
      value: j.tx.value ? ethers.BigNumber.from(j.tx.value) : undefined,
      gasLimit: j.tx.gas ? ethers.BigNumber.from(j.tx.gas).mul(120).div(100) : undefined,
    };

    return await signer.sendTransaction(tx);
  }

  return null;
}

export async function approveToken(
  signer: ethers.Signer,
  tokenAddress: string,
  spenderAddress: string,
  amount: ethers.BigNumber
): Promise<ethers.providers.TransactionReceipt> {
  const erc20 = new ethers.Contract(
    tokenAddress,
    ['function approve(address spender, uint256 amount) public returns (bool)'],
    signer
  );
  const tx = await erc20.approve(spenderAddress, amount);
  return await tx.wait();
}

export async function checkAllowance(
  provider: ethers.providers.Provider,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<ethers.BigNumber> {
  const erc20 = new ethers.Contract(
    tokenAddress,
    ['function allowance(address owner, address spender) view returns (uint256)'],
    provider
  );
  return await erc20.allowance(ownerAddress, spenderAddress);
}

export function parseSwapError(e: any): string {
  const s = (e && e.message) ? e.message.toLowerCase() : '';
  if (s.includes('user-rejected') || s.includes('user rejected') || s.includes('request rejected') || s.includes('user denied')) {
    return 'You rejected the wallet request. Please confirm the transaction in your wallet.';
  }
  if (s.includes('insufficient funds') || s.includes('insufficient balance')) {
    return 'Insufficient funds for this transaction (including gas). Check wallet balance.';
  }
  if (s.includes('allowance') || s.includes('approve') || s.includes('insufficient allowance')) {
    return 'Token allowance is missing. Please approve the token in your wallet.';
  }
  if (s.includes('network') || s.includes('wrong-chain') || s.includes('chain')) {
    return 'Wrong network — switch your wallet to Polygon (chain 137).';
  }
  return (e && e.message) ? `Transaction error: ${e.message}` : 'An unknown error occurred.';
}
