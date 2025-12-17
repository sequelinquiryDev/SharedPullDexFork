import { useState, useEffect, useRef, useMemo } from 'react';
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
  fromPriceHistory?: number[];
  toPriceHistory?: number[];
  isRadarOpen: boolean;
  onRadarToggle: (open: boolean) => void;
  isChatOpen: boolean;
  isLoading?: boolean;
}

// Loading pulse animation component
function LoadingPulse({ width = 40, height = 12 }: { width?: number; height?: number }) {
  return (
    <div 
      className="loading-pulse" 
      style={{ width: `${width}px`, height: `${height}px`, borderRadius: '4px' }}
    />
  );
}

// Professional sparkline that follows actual 2-minute price history from server
function Sparkline({ trend, change, isLoading, priceHistory }: { trend: 'up' | 'down'; change?: number | null; isLoading?: boolean; priceHistory?: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use actual price history from server (2-minute intervals), or generate synthetic data if unavailable
  const sparklineData = useMemo(() => {
    if (priceHistory && priceHistory.length > 0) {
      // Use real historical price data from server (follows 2-minute sequence)
      return priceHistory;
    }
    
    // Fallback: Generate realistic hourly price data if no history available
    const points = 24; // 24 hours of data
    const changePercent = change ?? (trend === 'up' ? 2.5 : -2.5);
    const volatility = Math.abs(changePercent) * 0.15;
    
    const data: number[] = [];
    let currentPrice = 100;
    const targetPrice = 100 + changePercent;
    const priceStep = (targetPrice - currentPrice) / points;
    
    for (let i = 0; i < points; i++) {
      const hour = i;
      const marketHoursMultiplier = (hour >= 9 && hour <= 16) ? 1.5 : 0.8;
      const asiaOpen = hour === 1 ? 1.3 : 1;
      const europeOpen = hour === 8 ? 1.4 : 1;
      const usOpen = hour === 14 ? 1.5 : 1;
      
      const noise = (Math.random() - 0.5) * volatility * marketHoursMultiplier * asiaOpen * europeOpen * usOpen;
      const reversion = (currentPrice - (100 + priceStep * i)) * 0.1;
      
      currentPrice = currentPrice + priceStep + noise - reversion;
      data.push(currentPrice);
    }
    
    const smoothed = data.map((val, i) => {
      if (i === 0 || i === data.length - 1) return val;
      return (data[i - 1] + val + data[i + 1]) / 3;
    });
    
    return smoothed;
  }, [priceHistory, trend, change]);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isLoading) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 100 * dpr;
    canvas.height = 36 * dpr;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, 100, 36);
    
    const data = sparklineData;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    
    // Draw gradient area under line
    const gradient = ctx.createLinearGradient(0, 0, 0, 36);
    gradient.addColorStop(0, trend === 'up' ? 'rgba(92,234,212,0.25)' : 'rgba(220,100,150,0.25)');
    gradient.addColorStop(1, trend === 'up' ? 'rgba(92,234,212,0.02)' : 'rgba(220,100,150,0.02)');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(2, 34);
    for (let i = 0; i < data.length; i++) {
      const x = 2 + (i / (data.length - 1)) * 96;
      const y = 34 - ((data[i] - min) / range) * 30;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(98, 34);
    ctx.closePath();
    ctx.fill();
    
    // Draw main price line
    ctx.strokeStyle = trend === 'up' ? 'rgba(92,234,212,0.9)' : 'rgba(220,100,150,0.9)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = 2 + (i / (data.length - 1)) * 96;
      const y = 34 - ((data[i] - min) / range) * 30;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Terminal dot with glow
    const lastX = 98;
    const lastY = 34 - ((data[data.length - 1] - min) / range) * 30;
    
    // Outer glow
    ctx.fillStyle = trend === 'up' ? 'rgba(76, 224, 193, 0.3)' : 'rgba(255, 100, 130, 0.3)';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner dot
    ctx.fillStyle = trend === 'up' ? 'rgba(76, 224, 193, 1)' : 'rgba(255, 100, 130, 1)';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }, [trend, sparklineData, isLoading]);
  
  if (isLoading) {
    return <LoadingPulse width={100} height={36} />;
  }
  
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
  fromPriceHistory,
  toPriceHistory,
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
                <div><div className="stat-label">Price</div><div className="stat-value">{fromPriceUsd ? formatUSD(fromPriceUsd) : <LoadingPulse width={50} height={10} />}</div></div>
                <div><div className="stat-label">24h</div><div className="stat-value">{fromChange24h !== null && fromChange24h !== undefined ? <span style={{ color: fromChange24h >= 0 ? '#9ef39e' : '#ff9e9e' }}>{fromChange24h >= 0 ? '+' : ''}{fromChange24h.toFixed(2)}%</span> : <LoadingPulse width={35} height={10} />}</div></div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '2px', fontSize: '7px', opacity: 0.7 }}>
                <div>Vol: {fromVolume24h !== null && fromVolume24h !== undefined ? (fromVolume24h > 1000000 ? `$${(fromVolume24h / 1000000).toFixed(1)}M` : `$${(fromVolume24h / 1000).toFixed(0)}K`) : <LoadingPulse width={30} height={8} />}</div>
                <div>Cap: {fromMarketCap !== null && fromMarketCap !== undefined ? (fromMarketCap > 1000000 ? `$${(fromMarketCap / 1000000).toFixed(1)}M` : `$${(fromMarketCap / 1000).toFixed(0)}K`) : <LoadingPulse width={30} height={8} />}</div>
              </div>
              <Sparkline trend={(fromChange24h ?? 0) >= 0 ? 'up' : 'down'} change={fromChange24h} isLoading={fromPriceUsd === null} priceHistory={fromPriceHistory} />
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
                <div><div className="stat-label">Price</div><div className="stat-value">{toPriceUsd ? formatUSD(toPriceUsd) : <LoadingPulse width={50} height={10} />}</div></div>
                <div><div className="stat-label">24h</div><div className="stat-value">{toChange24h !== null && toChange24h !== undefined ? <span style={{ color: toChange24h >= 0 ? '#9ef39e' : '#ff9e9e' }}>{toChange24h >= 0 ? '+' : ''}{toChange24h.toFixed(2)}%</span> : <LoadingPulse width={35} height={10} />}</div></div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '2px', fontSize: '7px', opacity: 0.7 }}>
                <div>Vol: {toVolume24h !== null && toVolume24h !== undefined ? (toVolume24h > 1000000 ? `$${(toVolume24h / 1000000).toFixed(1)}M` : `$${(toVolume24h / 1000).toFixed(0)}K`) : <LoadingPulse width={30} height={8} />}</div>
                <div>Cap: {toMarketCap !== null && toMarketCap !== undefined ? (toMarketCap > 1000000 ? `$${(toMarketCap / 1000000).toFixed(1)}M` : `$${(toMarketCap / 1000).toFixed(0)}K`) : <LoadingPulse width={30} height={8} />}</div>
              </div>
              <Sparkline trend={(toChange24h ?? 0) >= 0 ? 'up' : 'down'} change={toChange24h} isLoading={toPriceUsd === null} priceHistory={toPriceHistory} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
