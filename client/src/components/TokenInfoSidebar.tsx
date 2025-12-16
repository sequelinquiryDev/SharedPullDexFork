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
}

// Minimal sparkline renderer
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
    
    // Generate mock sparkline data
    const points = 30;
    const data = Array.from({ length: points }, (_, i) => {
      const base = trend === 'up' ? i * 0.5 : 30 - i * 0.5;
      return base + Math.random() * 5;
    });
    
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    
    // Draw line
    ctx.strokeStyle = trend === 'up' ? 'rgba(92,234,212,0.95)' : 'rgba(124,58,237,0.95)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const x = 2 + (i / (points - 1)) * (96);
      const y = 34 - ((data[i] - min) / range) * 32;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Terminal dot
    const lastX = 2 + (96);
    const lastY = 34 - ((data[points - 1] - min) / range) * 32;
    ctx.fillStyle = trend === 'up' ? 'rgba(18,183,106,0.95)' : 'rgba(255,107,107,0.95)';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.4, 0, Math.PI * 2);
    ctx.fill();
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
}: TokenInfoSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const hasTokens = fromToken || toToken;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        containerRef.current &&
        buttonRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <>
      {/* Button - Mini Radar */}
      <div
        ref={buttonRef}
        className="token-info-button"
        onClick={() => hasTokens && setIsOpen(!isOpen)}
        style={{ opacity: hasTokens ? 1 : 0.5, cursor: hasTokens ? 'pointer' : 'not-allowed' }}
        data-testid="button-token-info"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
        <div className="token-info-text">{isOpen ? 'Hide' : 'Mini Radar'}</div>
      </div>

      {/* Sidebar */}
      {isOpen && (
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
                {fromChange24h !== null && fromChange24h !== undefined && <div><div className="stat-label">24h</div><div className="stat-value" style={{ color: fromChange24h >= 0 ? '#9ef39e' : '#ff9e9e' }}>{fromChange24h >= 0 ? '+' : ''}{fromChange24h.toFixed(2)}%</div></div>}
              </div>
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
                {toChange24h !== null && toChange24h !== undefined && <div><div className="stat-label">24h</div><div className="stat-value" style={{ color: toChange24h >= 0 ? '#9ef39e' : '#ff9e9e' }}>{toChange24h >= 0 ? '+' : ''}{toChange24h.toFixed(2)}%</div></div>}
              </div>
              <Sparkline trend={(toChange24h ?? 0) >= 0 ? 'up' : 'down'} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
