
import { useEffect } from 'react';
import { useChainId, useSwitchChain } from 'wagmi';
import { polygon, mainnet } from 'wagmi/chains';
import { useChain, ChainType } from '@/lib/chainContext';
import { showToast } from './Toast';

export function SwitchChainButton() {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { chain, setChain } = useChain();

  useEffect(() => {
    const newChain: ChainType = chainId === mainnet.id ? 'ETH' : 'POL';
    
    if (newChain !== chain) {
      setChain(newChain);
    }
    
    if (chainId === mainnet.id) {
      document.body.classList.add('eth-chain');
      document.documentElement.style.setProperty('--accent-1', '#4589ff');
      document.documentElement.style.setProperty('--accent-2', '#1370ff');
    } else {
      document.body.classList.remove('eth-chain');
      document.documentElement.style.setProperty('--accent-1', '#b445ff');
      document.documentElement.style.setProperty('--accent-2', '#7013ff');
    }
  }, [chainId, chain, setChain]);

  const handleSwitch = async () => {
    try {
      const targetChain = chain === 'POL' ? mainnet : polygon;
      await switchChain({ chainId: targetChain.id });
      showToast(`Switching to ${targetChain.name}...`, { type: 'info' });
    } catch (error: any) {
      if (error.code === 4001) {
        showToast('Chain switch cancelled', { type: 'warn' });
      } else {
        showToast('Failed to switch chain', { type: 'error' });
      }
    }
  };

  return (
    <div
      className={`switch-chain-button ${chain === 'ETH' ? 'eth-active' : ''}`}
      onClick={handleSwitch}
      role="button"
      aria-label={`Switch to ${chain === 'POL' ? 'Ethereum' : 'Polygon'}`}
      data-testid="button-switch-chain"
    >
      <div className="switch-chain-arrows">⇅</div>
      <div className="switch-chain-label">{chain}</div>
    </div>
  );
}
