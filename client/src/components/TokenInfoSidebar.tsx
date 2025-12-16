import { useState } from 'react';
import { Token } from '@/lib/tokenService';
import { formatUSD } from '@/lib/config';

interface TokenInfoSidebarProps {
  fromToken: Token | null;
  toToken: Token | null;
  fromPriceUsd: number | null;
  toPriceUsd: number | null;
  fromChange24h?: number | null;
  toChange24h?: number | null;
}

export function TokenInfoSidebar({
  fromToken,
  toToken,
  fromPriceUsd,
  toPriceUsd,
  fromChange24h,
  toChange24h,
}: TokenInfoSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasTokens = fromToken || toToken;

  return (
    <>
      {/* Button - same style as swap button */}
      <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}>
        <button
          className="glassy-btn"
          style={{
            width: '100%',
            justifyContent: 'center',
            background: isOpen
              ? 'linear-gradient(90deg, var(--accent-1), var(--accent-2))'
              : 'rgba(180, 68, 255, 0.15)',
            opacity: hasTokens ? 1 : 0.5,
            cursor: hasTokens ? 'pointer' : 'not-allowed',
          }}
          onClick={() => hasTokens && setIsOpen(!isOpen)}
          disabled={!hasTokens}
          data-testid="button-token-info"
        >
          <span className="icon">ℹ</span>
          <span className="label">{isOpen ? 'Hide Token Info' : 'Show Token Info'}</span>
        </button>
      </div>

      {/* Sidebar */}
      {isOpen && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
            minWidth: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
          data-testid="sidebar-token-info"
        >
          {/* From Token */}
          {fromToken && (
            <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                {fromToken.logoURI && (
                  <img
                    src={fromToken.logoURI}
                    alt={fromToken.symbol}
                    style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>
                    {fromToken.symbol}
                  </div>
                  <div style={{ fontSize: '10px', opacity: 0.7 }}>
                    {fromToken.name}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                <div>
                  <div style={{ opacity: 0.7, marginBottom: '2px' }}>Price</div>
                  <div style={{ fontWeight: 700 }}>
                    {fromPriceUsd ? formatUSD(fromPriceUsd) : '—'}
                  </div>
                </div>
                {fromChange24h !== null && fromChange24h !== undefined && (
                  <div>
                    <div style={{ opacity: 0.7, marginBottom: '2px' }}>24h Change</div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: fromChange24h >= 0 ? '#9ef39e' : '#ff9e9e',
                      }}
                    >
                      {fromChange24h >= 0 ? '+' : ''}{fromChange24h.toFixed(2)}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* To Token */}
          {toToken && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                {toToken.logoURI && (
                  <img
                    src={toToken.logoURI}
                    alt={toToken.symbol}
                    style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>
                    {toToken.symbol}
                  </div>
                  <div style={{ fontSize: '10px', opacity: 0.7 }}>
                    {toToken.name}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                <div>
                  <div style={{ opacity: 0.7, marginBottom: '2px' }}>Price</div>
                  <div style={{ fontWeight: 700 }}>
                    {toPriceUsd ? formatUSD(toPriceUsd) : '—'}
                  </div>
                </div>
                {toChange24h !== null && toChange24h !== undefined && (
                  <div>
                    <div style={{ opacity: 0.7, marginBottom: '2px' }}>24h Change</div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: toChange24h >= 0 ? '#9ef39e' : '#ff9e9e',
                      }}
                    >
                      {toChange24h >= 0 ? '+' : ''}{toChange24h.toFixed(2)}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
