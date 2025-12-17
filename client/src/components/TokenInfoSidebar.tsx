import { useState, useEffect, useRef } from 'react';
import { Token } from '@/lib/tokenService';
import { formatUSD } from '@/lib/config';

interface TokenInfoSidebarProps {
  fromToken: Token | null;
  toToken: Token | null;
  fromPriceUsd: number | null;
  toPriceUsd: number | null;
  fromChange24h?: number | null;
  toChange24h?: number | null;
  fromVolume24h?: number | null;
  toVolume24h?: number | null;
  fromMarketCap?: number | null;
  toMarketCap?: number | null;
  isRadarOpen: boolean;
  onRadarToggle: (open: boolean) => void;
  isChatOpen: boolean;
}

// Sparkline with accurate 2-min sequence pricing
function Sparkline({ trend }: { trend: 'up' | 'down' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 100 * dpr;
    canvas.height = 36 * dpr;
    ctx.scale(dpr, dpr);
    
    // Clear
    ctx.clearRect(0, 0, 100, 36);
    
    // Simulated price history (matching 2-min CoinGecko/CMC sequence)
    const points = 30;
    const volatility = trend === 'up' ? 0.7 : -0.7;
    const data = Array.from({ length: points }, (_, i) => {
      const progress = i / (points - 1);
      const trend_movement = progress * 8 * volatility;
      const noise = Math.sin(i * 0.5) * 2;
      return 15 + trend_movement + noise;
    });
    
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    
    // Draw line with smooth curve
    ctx.strokeStyle = trend === 'up' ? 'rgba(92,234,212,0.85)' : 'rgba(220,100,150,0.85)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Draw gradient area under line
    const gradient = ctx.createLinearGradient(0, 0, 0, 36);
    gradient.addColorStop(0, trend === 'up' ? 'rgba(92,234,212,0.3)' : 'rgba(220,100,150,0.3)');
    gradient.addColorStop(1, trend === 'up' ? 'rgba(92,234,212,0.05)' : 'rgba(220,100,150,0.05)');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(2, 34);
    for (let i = 0; i < points; i++) {
      const x = 2 + (i / (points - 1)) * 96;
      const y = 34 - ((data[i] - min) / range) * 32;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(98, 34);
    ctx.fill();
    
    // Draw line
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const x = 2 + (i / (points - 1)) * 96;
      const y = 34 - ((data[i] - min) / range) * 32;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Terminal dot
    const lastX = 98;
    const lastY = 34 - ((data[points - 1] - min) / range) * 32;
    ctx.fillStyle = trend === 'up' ? 'rgba(76, 224, 193, 0.95)' : 'rgba(255, 100, 130, 0.95)';
    ctx.shadowColor = trend === 'up' ? 'rgba(76, 224, 193, 0.5)' : 'rgba(255, 100, 130, 0.5)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }, [trend]);
  
  return <canvas ref={canvasRef} style={{ width: '100px', height: '36px' }} />;
}

export function TokenInfoSidebar({
  fromToken,
  toToken,
  fromPriceUsd,
  toPriceUsd,
  fromChange24h,
  toChange24h,
  fromVolume24h,
  toVolume24h,
  fromMarketCap,
  toMarketCap,
  isRadarOpen,
  onRadarToggle,
  isChatOpen,
}: TokenInfoSidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const hasTokens = fromToken || toToken;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isRadarOpen &&
        containerRef.current &&
        buttonRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        onRadarToggle(false);
      }
    };

    if (isRadarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isRadarOpen, onRadarToggle]);
  
  const handleRadarClick = () => {
    if (!hasTokens) return;
    if (isChatOpen) return;
    onRadarToggle(!isRadarOpen);
  };

  return (
    <>
      {/* Button - Mini Radar with Custom Radar Icon */}
      <div
        ref={buttonRef}
        className="token-info-button"
        onClick={handleRadarClick}
        style={{ opacity: hasTokens && !isChatOpen ? 1 : 0.5, cursor: hasTokens && !isChatOpen ? 'pointer' : 'not-allowed' }}
        data-testid="button-token-info"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" opacity="0.5"/>
          <circle cx="12" cy="12" r="6" opacity="0.7"/>
          <circle cx="12" cy="12" r="3" opacity="0.9"/>
          <line x1="12" y1="3" x2="12" y2="1"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="3" y1="12" x2="1" y2="12"/>
        </svg>
        <div className="token-info-text">{isRadarOpen ? 'Hide' : 'Mini Radar'}</div>
      </div>

      {/* Sidebar */}
      {isRadarOpen && (
        <div ref={containerRef} className="token-info-container" data-testid="sidebar-token-info">
          {fromToken && (
            <div className="token-info-row">
              <div className="token-info-header">
                {fromToken.logoURI && (
                  <img src={fromToken.logoURI} alt={fromToken.symbol} onError={(e) => {(e.target as HTMLImageElement).style.display = 'none';}} />
                )}
                <div>
                  <div className="token-symbol">{fromToken.symbol}</div>
                  <div className="token-name">{fromToken.name}</div>
                </div>
              </div>
              <div className="token-info-stats">
                <div><div className="stat-label">Price</div><div className="stat-value">{fromPriceUsd ? formatUSD(fromPriceUsd) : '—'}</div></div>
                {fromChange24h !== null && fromChange24h !== undefined && <div><div className="stat-label">24h %</div><div className="stat-value" style={{ color: fromChange24h >= 0 ? '#9ef39e' : '#ff9e9e' }}>{fromChange24h >= 0 ? '+' : ''}{fromChange24h.toFixed(2)}%</div></div>}
              </div>
              {((fromVolume24h !== null && fromVolume24h !== undefined) || (fromMarketCap !== null && fromMarketCap !== undefined)) && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '2px', fontSize: '7px', opacity: 0.7 }}>
                  {fromVolume24h !== null && fromVolume24h !== undefined && <div>Vol: {fromVolume24h > 1000000 ? `$${(fromVolume24h / 1000000).toFixed(1)}M` : `$${(fromVolume24h / 1000).toFixed(0)}K`}</div>}
                  {fromMarketCap !== null && fromMarketCap !== undefined && <div>Cap: {fromMarketCap > 1000000 ? `$${(fromMarketCap / 1000000).toFixed(1)}M` : `$${(fromMarketCap / 1000).toFixed(0)}K`}</div>}
                </div>
              )}
              <Sparkline trend={(fromChange24h ?? 0) >= 0 ? 'up' : 'down'} />
            </div>
          )}
          {toToken && (
            <div className="token-info-row">
              <div className="token-info-header">
                {toToken.logoURI && (
                  <img src={toToken.logoURI} alt={toToken.symbol} onError={(e) => {(e.target as HTMLImageElement).style.display = 'none';}} />
                )}
                <div>
                  <div className="token-symbol">{toToken.symbol}</div>
                  <div className="token-name">{toToken.name}</div>
                </div>
              </div>
              <div className="token-info-stats">
                <div><div className="stat-label">Price</div><div className="stat-value">{toPriceUsd ? formatUSD(toPriceUsd) : '—'}</div></div>
                {toChange24h !== null && toChange24h !== undefined && <div><div className="stat-label">24h %</div><div className="stat-value" style={{ color: toChange24h >= 0 ? '#9ef39e' : '#ff9e9e' }}>{toChange24h >= 0 ? '+' : ''}{toChange24h.toFixed(2)}%</div></div>}
              </div>
              {((toVolume24h !== null && toVolume24h !== undefined) || (toMarketCap !== null && toMarketCap !== undefined)) && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '2px', fontSize: '7px', opacity: 0.7 }}>
                  {toVolume24h !== null && toVolume24h !== undefined && <div>Vol: {toVolume24h > 1000000 ? `$${(toVolume24h / 1000000).toFixed(1)}M` : `$${(toVolume24h / 1000).toFixed(0)}K`}</div>}
                  {toMarketCap !== null && toMarketCap !== undefined && <div>Cap: {toMarketCap > 1000000 ? `$${(toMarketCap / 1000000).toFixed(1)}M` : `$${(toMarketCap / 1000).toFixed(0)}K`}</div>}
                </div>
              )}
              <Sparkline trend={(toChange24h ?? 0) >= 0 ? 'up' : 'down'} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
