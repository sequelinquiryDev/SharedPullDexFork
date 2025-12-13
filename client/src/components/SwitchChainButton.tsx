
import { useState, useEffect } from 'react';
import { useChainId, useSwitchChain } from 'wagmi';
import { polygon, mainnet } from 'wagmi/chains';
import { showToast } from './Toast';

export function SwitchChainButton() {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [currentChain, setCurrentChain] = useState<'POL' | 'ETH'>('POL');

  useEffect(() => {
    if (chainId === mainnet.id) {
      setCurrentChain('ETH');
      document.body.classList.add('eth-chain');
      document.documentElement.style.setProperty('--accent-1', '#4589ff');
      document.documentElement.style.setProperty('--accent-2', '#1370ff');
    } else {
      setCurrentChain('POL');
      document.body.classList.remove('eth-chain');
      document.documentElement.style.setProperty('--accent-1', '#b445ff');
      document.documentElement.style.setProperty('--accent-2', '#7013ff');
    }
  }, [chainId]);

  const handleSwitch = async () => {
    try {
      const targetChain = currentChain === 'POL' ? mainnet : polygon;
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
      className={`switch-chain-button ${currentChain === 'ETH' ? 'eth-active' : ''}`}
      onClick={handleSwitch}
      role="button"
      aria-label={`Switch to ${currentChain === 'POL' ? 'Ethereum' : 'Polygon'}`}
    >
      <div className="switch-chain-arrows">⇅</div>
      <div className="switch-chain-label">{currentChain}</div>
    </div>
  );
}
