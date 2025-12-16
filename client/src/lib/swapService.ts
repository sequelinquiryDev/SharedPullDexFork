import { ethers } from 'ethers';
import { config, ethereumConfig, fetchWithTimeout, low } from './config';

export type ChainType = 'ETH' | 'POL' | 'BRG';

export interface QuoteResult {
  source: '0x' | 'lifi';
  toAmount: string;
  normalized: number;
  data?: any;
  isBridge?: boolean;
}

// Chain IDs for LIFI
const CHAIN_IDS = {
  ETH: 1,
  POL: 137,
} as const;

const quoteCache = new Map<string, { best: QuoteResult; ts: number }>();

function getChainConfig(chain: ChainType) {
  return chain === 'ETH' ? ethereumConfig : config;
}

function makeQuoteKey(
  fromAddr: string,
  toAddr: string,
  amountWei: string,
  slippage: number,
  chain: ChainType
): string {
  return `${chain}-${low(fromAddr)}-${low(toAddr)}-${amountWei}-${slippage}`;
}

async function fetch0xQuote(
  fromAddr: string,
  toAddr: string,
  sellAmount: string,
  walletAddress: string,
  chain: ChainType = 'POL'
): Promise<QuoteResult | null> {
  try {
    // Use server proxy for 0x API calls (handles API keys server-side)
    const proxyBase = chain === 'ETH' ? '/api/proxy/0x-eth' : '/api/proxy/0x';
    const url = `${proxyBase}/swap/v1/quote?sellToken=${encodeURIComponent(fromAddr)}&buyToken=${encodeURIComponent(toAddr)}&sellAmount=${sellAmount}&takerAddress=${walletAddress}`;
    console.log(`[0x Quote] Fetching quote: ${chain} | ${fromAddr} -> ${toAddr} | Amount: ${sellAmount} | Taker: ${walletAddress}`);
    
    const resp = await fetchWithTimeout(url, {}, 5000);
    if (!resp.ok) {
      console.warn(`[0x Quote] Failed with status ${resp.status}`);
      return null;
    }
    const j = await resp.json();
    if (!j || !j.buyAmount) {
      console.warn('[0x Quote] Invalid response - no buyAmount');
      return null;
    }
    const normalized = Number(ethers.utils.formatUnits(j.buyAmount, j.buyTokenDecimals || 18));
    console.log(`[0x Quote] Success: buyAmount=${j.buyAmount}, normalized=${normalized.toFixed(8)}`);
    return {
      source: '0x',
      toAmount: j.buyAmount,
      normalized,
      data: j,
    };
  } catch (e) {
    console.error('[0x Quote] Error:', e);
    return null;
  }
}

// LIFI quote for same-chain swaps or cross-chain bridges
async function fetchLifiQuote(
  fromAddr: string,
  toAddr: string,
  sellAmount: string,
  toDecimals: number,
  fromChainId: number,
  toChainId: number,
  walletAddress: string
): Promise<QuoteResult | null> {
  try {
    const isBridge = fromChainId !== toChainId;
    const url = `/api/proxy/lifi/quote?fromChain=${fromChainId}&toChain=${toChainId}&fromToken=${encodeURIComponent(fromAddr)}&toToken=${encodeURIComponent(toAddr)}&fromAmount=${sellAmount}&fromAddress=${walletAddress}`;
    console.log(`[LIFI Quote] Fetching ${isBridge ? 'bridge' : 'swap'} quote: chain ${fromChainId} -> ${toChainId} | From: ${walletAddress}`);
    
    const resp = await fetchWithTimeout(url, {}, 8000);
    if (!resp.ok) {
      console.warn(`[LIFI Quote] Failed with status ${resp.status}`);
      return null;
    }
    const j = await resp.json();
    if (!j || !j.estimate || !j.estimate.toAmount) {
      console.warn('[LIFI Quote] Invalid response - no toAmount');
      return null;
    }
    const normalized = Number(ethers.utils.formatUnits(j.estimate.toAmount, toDecimals));
    console.log(`[LIFI Quote] Success: toAmount=${j.estimate.toAmount}, normalized=${normalized.toFixed(8)}`);
    return {
      source: 'lifi',
      toAmount: j.estimate.toAmount,
      normalized,
      data: j,
      isBridge,
    };
  } catch (e) {
    console.error('[LIFI Quote] Error:', e);
    return null;
  }
}

// Get LIFI bridge quote for cross-chain transfers
export async function getLifiBridgeQuote(
  fromAddr: string,
  toAddr: string,
  amountWei: string,
  toDecimals: number,
  fromChainId: number,
  toChainId: number,
  walletAddress: string
): Promise<QuoteResult | null> {
  return fetchLifiQuote(fromAddr, toAddr, amountWei, toDecimals, fromChainId, toChainId, walletAddress);
}

export async function getBestQuote(
  fromAddr: string,
  toAddr: string,
  amountWei: string,
  fromDecimals: number,
  toDecimals: number,
  slippage: number,
  walletAddress: string,
  chain: ChainType = 'POL'
): Promise<QuoteResult | null> {
  const key = makeQuoteKey(fromAddr, toAddr, amountWei, slippage, chain);
  
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.ts < config.quoteCacheTtl) {
    console.log(`[Quote] Using cached quote from ${cached.best.source}`);
    return cached.best;
  }

  const chainId = chain === 'ETH' ? CHAIN_IDS.ETH : CHAIN_IDS.POL;
  console.log(`[Quote] Fetching quotes from 0x and LIFI for ${chain}...`);
  
  // Fetch with timeout fallback: try both sources in parallel, accept first valid response
  const [q0x, qLifi] = await Promise.all([
    fetch0xQuote(fromAddr, toAddr, amountWei, walletAddress, chain),
    fetchLifiQuote(fromAddr, toAddr, amountWei, toDecimals, chainId, chainId, walletAddress),
  ]);

  const quotes = [q0x, qLifi].filter(Boolean) as QuoteResult[];
  console.log(`[Quote] Received ${quotes.length} valid quotes: ${quotes.map(q => `${q.source}=${q.normalized.toFixed(6)}`).join(', ')}`);
  
  if (quotes.length === 0) {
    console.warn('[Quote] No valid quotes available - all sources failed');
    return null;
  }

  quotes.sort((a, b) => b.normalized - a.normalized);
  const best = quotes[0];
  console.log(`[Quote] Best quote: ${best.source} with normalized amount ${best.normalized.toFixed(6)}`);

  quoteCache.set(key, { best, ts: Date.now() });
  return best;
}

export function getCachedQuote(
  fromAddr: string,
  toAddr: string,
  amountWei: string,
  slippage: number,
  chain: ChainType = 'POL'
): QuoteResult | null {
  const key = makeQuoteKey(fromAddr, toAddr, amountWei, slippage, chain);
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
  slippage: number,
  chain: ChainType = 'POL'
): Promise<ethers.providers.TransactionResponse | null> {
  const userAddress = await signer.getAddress();
  const chainConfig = getChainConfig(chain);

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
  } else if (quote.source === 'lifi') {
    const data = quote.data;
    if (!data || !data.transactionRequest) {
      throw new Error('Invalid LIFI quote data');
    }
    const txReq = data.transactionRequest;
    const tx: ethers.providers.TransactionRequest = {
      to: txReq.to,
      data: txReq.data,
      value: txReq.value ? ethers.BigNumber.from(txReq.value) : undefined,
      gasLimit: txReq.gasLimit ? ethers.BigNumber.from(txReq.gasLimit).mul(120).div(100) : undefined,
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

export function parseSwapError(e: any, chain: ChainType = 'POL'): string {
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
    const chainName = chain === 'ETH' ? 'Ethereum (chain 1)' : 'Polygon (chain 137)';
    return `Wrong network — switch your wallet to ${chainName}.`;
  }
  return (e && e.message) ? `Transaction error: ${e.message}` : 'An unknown error occurred.';
}
