import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { useState } from 'react';
import { shortAddr, config } from '@/lib/config';
import { showToast } from './Toast';

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [showOptions, setShowOptions] = useState(false);

  const handleConnect = async () => {
    if (isConnected) {
      if (confirm('Disconnect wallet?')) {
        disconnect();
        showToast('Wallet disconnected', { type: 'info' });
      }
    } else {
      setShowOptions(true);
    }
  };

  const handleConnectorSelect = async (connector: any) => {
    setShowOptions(false);
    try {
      connect({ connector });
      showToast('Connecting...', { type: 'info' });
    } catch (e: any) {
      showToast('Connection failed: ' + (e.message || e), { type: 'error' });
    }
  };

  const handleSwitchChain = async () => {
    try {
      await switchChain({ chainId: config.chainId });
      showToast('Switched to Polygon', { type: 'success' });
    } catch (e: any) {
      showToast('Failed to switch network', { type: 'error' });
    }
  };

  const isWrongChain = isConnected && chainId !== config.chainId;

  return (
    <div className="top-right-connect">
      {isConnected && address && (
        <div className="addr-chip" data-testid="text-address-chip">
          {shortAddr(address)}
        </div>
      )}
      
      {isWrongChain && (
        <button
          onClick={handleSwitchChain}
          className="glassy-btn"
          style={{ background: 'rgba(255, 100, 100, 0.2)' }}
          data-testid="button-switch-chain"
        >
          Wrong Chain
        </button>
      )}

      <button
        onClick={handleConnect}
        className={`glassy-btn ${isConnected ? 'connected' : ''}`}
        disabled={isPending}
        data-testid="button-connect-wallet"
      >
        {isPending ? (
          <span className="btn-spinner" />
        ) : (
          <>
            <span style={{ marginRight: '8px' }}>{isConnected ? '🔗' : '🔌'}</span>
            <span>{isConnected ? 'Connected' : 'Connect Wallet'}</span>
          </>
        )}
      </button>

      {showOptions && !isConnected && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
          }}
          onClick={() => setShowOptions(false)}
          data-testid="modal-wallet-options"
        >
          <div
            style={{
              background: 'rgba(255,255,255,0.07)',
              padding: '25px',
              borderRadius: '20px',
              width: '300px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                textAlign: 'center',
                marginBottom: '16px',
                color: '#e0b3ff',
              }}
            >
              Select Wallet
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => handleConnectorSelect(connector)}
                  className="glassy-btn"
                  style={{ width: '100%', justifyContent: 'center' }}
                  data-testid={`button-connector-${connector.id}`}
                >
                  {connector.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowOptions(false)}
              style={{
                marginTop: '15px',
                width: '100%',
                padding: '10px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                color: '#fff',
                cursor: 'pointer',
              }}
              data-testid="button-close-wallet-modal"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
