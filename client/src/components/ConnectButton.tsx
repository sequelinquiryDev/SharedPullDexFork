
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { useState, useEffect, useRef } from 'react';
import { shortAddr, config } from '@/lib/config';
import { showToast } from './Toast';

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [showModal, setShowModal] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowModal(false);
      }
    };

    if (showModal) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModal]);

  const handleConnect = () => {
    if (isConnected) {
      if (confirm('Disconnect wallet?')) {
        disconnect();
        showToast('Wallet disconnected', { type: 'info' });
      }
    } else {
      setShowModal(true);
    }
  };

  const handleConnectorSelect = async (connector: any) => {
    setShowModal(false);
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
    <>
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
            style={{ 
              background: 'rgba(255, 100, 100, 0.2)',
              border: '1px solid rgba(255, 100, 100, 0.3)'
            }}
            data-testid="button-switch-chain"
          >
            Wrong Chain
          </button>
        )}

        <button
          onClick={handleConnect}
          className={`glassy-btn ${isConnected ? 'connected' : ''}`}
          style={{
            background: isConnected 
              ? 'linear-gradient(90deg, var(--accent-1), var(--accent-2))'
              : 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
            boxShadow: isConnected
              ? '0 10px 30px rgba(180,68,255,0.2), inset 0 -3px 8px rgba(0,0,0,0.12)'
              : '0 8px 22px rgba(106,0,255,0.12)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
          data-testid="button-connect-wallet"
        >
          <span style={{ marginRight: '8px' }}>{isConnected ? '🔗' : '🔌'}</span>
          <span>{isConnected ? 'Disconnect' : 'Connect Wallet'}</span>
        </button>
      </div>

      {showModal && (
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
          data-testid="modal-wallet-options"
        >
          <div
            ref={modalRef}
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.05))',
              padding: '25px',
              borderRadius: '20px',
              width: '300px',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 25px rgba(180,0,255,0.3)',
            }}
          >
            <h3
              style={{
                textAlign: 'center',
                marginBottom: '16px',
                color: '#e0b3ff',
                fontSize: '18px',
                fontWeight: 600,
              }}
            >
              Connect Wallet
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => handleConnectorSelect(connector)}
                  className="glassy-btn"
                  style={{ 
                    width: '100%', 
                    justifyContent: 'center',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                  data-testid={`button-connector-${connector.id}`}
                >
                  {connector.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowModal(false)}
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
    </>
  );
}
