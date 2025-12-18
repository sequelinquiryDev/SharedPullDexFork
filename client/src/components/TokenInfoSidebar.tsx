import { useState, useEffect, useRef, useMemo } from 'react';
import { Token } from '@/lib/tokenService';
import { formatUSD } from '@/lib/config';
import { SiCoinmarketcap } from 'react-icons/si';

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

// Professional sparkline with empathetic colors and movement-aware dots
function Sparkline({ trend, change, isLoading, priceHistory }: { trend: 'up' | 'down'; change?: number | null; isLoading?: boolean; priceHistory?: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use actual price history from server (2-minute intervals, max 5 minutes = 3 points)
  const sparklineData = useMemo(() => {
    if (priceHistory && priceHistory.length >= 2) {
      // Use real historical price data (5-minute frame = last 2-3 points from 2-minute intervals)
      // But keep at least the last 3 points for smooth curve even if older
      const maxPoints = Math.min(priceHistory.length, 60); // Max 60 points for smooth rendering
      return priceHistory.slice(-maxPoints);
    }
    
    // Fallback: Generate realistic price data with 60 points (good resolution for sparkline)
    const points = 60;
    const changePercent = change ?? (trend === 'up' ? 2.5 : -2.5);
    const volatility = Math.abs(changePercent) * 0.2;
    
    const data: number[] = [];
    let currentPrice = 100;
    const targetPrice = 100 + changePercent;
    const priceStep = (targetPrice - currentPrice) / points;
    
    for (let i = 0; i < points; i++) {
      const progressRatio = i / points;
      const noise = (Math.random() - 0.5) * volatility * (1 + Math.sin(progressRatio * Math.PI) * 0.5);
      const trend_component = priceStep + noise;
      const meanReversion = (currentPrice - (100 + priceStep * i)) * 0.05;
      
      currentPrice = Math.max(currentPrice + trend_component - meanReversion, 50);
      data.push(currentPrice);
    }
    
    // Apply smoothing for natural curve
    const smoothed = data.map((val, i) => {
      if (i === 0) return val;
      if (i === data.length - 1) return val;
      const window = i > 2 && i < data.length - 3 ? 5 : 3;
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - Math.floor(window / 2)); j <= Math.min(data.length - 1, i + Math.floor(window / 2)); j++) {
        sum += data[j];
        count++;
      }
      return sum / count;
    });
    
    return smoothed;
  }, [priceHistory, trend, change]);

  // Calculate recent movement for dot color indicator
  const recentMovement = useMemo(() => {
    if (sparklineData.length < 2) return 'neutral';
    const lastPrice = sparklineData[sparklineData.length - 1];
    const prevPrice = sparklineData[Math.max(0, sparklineData.length - 2)];
    if (lastPrice > prevPrice) return 'up';
    if (lastPrice < prevPrice) return 'down';
    return 'neutral';
  }, [sparklineData]);
  
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
    
    // Empathetic color scheme - softer, more sophisticated
    // Uptrend: peaceful cyan/teal gradient
    // Downtrend: gentle coral/peach gradient
    const lineColorUp = 'rgba(106, 230, 230, 0.85)'; // Peaceful cyan
    const lineColorDown = 'rgba(255, 140, 130, 0.85)'; // Gentle coral
    const glowColorUp = 'rgba(106, 230, 230, 0.25)'; // Light cyan glow
    const glowColorDown = 'rgba(255, 140, 130, 0.25)'; // Light coral glow
    
    // Draw gradient area under line with empathetic feel
    const gradient = ctx.createLinearGradient(0, 0, 0, 36);
    gradient.addColorStop(0, trend === 'up' ? glowColorUp : glowColorDown);
    gradient.addColorStop(1, trend === 'up' ? 'rgba(106, 230, 230, 0.02)' : 'rgba(255, 140, 130, 0.02)');
    
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
    
    // Draw main price line with empathetic color
    ctx.strokeStyle = trend === 'up' ? lineColorUp : lineColorDown;
    ctx.lineWidth = 2.0;
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
    
    // Terminal dot with movement-aware color indicator
    const lastX = 98;
    const lastY = 34 - ((data[data.length - 1] - min) / range) * 30;
    
    // Dot color shows recent movement direction (not just overall trend)
    let dotOuterColor: string;
    let dotInnerColor: string;
    
    if (recentMovement === 'up') {
      // Recent movement up: success green
      dotOuterColor = 'rgba(52, 211, 153, 0.4)';
      dotInnerColor = 'rgba(16, 185, 129, 1)';
    } else if (recentMovement === 'down') {
      // Recent movement down: caution orange-red
      dotOuterColor = 'rgba(251, 146, 60, 0.4)';
      dotInnerColor = 'rgba(249, 115, 22, 1)';
    } else {
      // Neutral: use trend color
      dotOuterColor = trend === 'up' ? 'rgba(106, 230, 230, 0.4)' : 'rgba(255, 140, 130, 0.4)';
      dotInnerColor = trend === 'up' ? 'rgba(106, 230, 230, 1)' : 'rgba(255, 140, 130, 1)';
    }
    
    // Outer glow - soft halo
    ctx.fillStyle = dotOuterColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner dot - solid indicator
    ctx.fillStyle = dotInnerColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }, [trend, sparklineData, isLoading, recentMovement]);
  
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
  const [currentSource, setCurrentSource] = useState<'cmc' | 'coingecko'>('cmc');
  const [timeInCycle, setTimeInCycle] = useState(0);

  // Track which source is active and time in 2-minute cycle
  useEffect(() => {
    const updateSource = () => {
      const now = Date.now();
      const cycleTime = now % 120000; // 2 minutes
      setTimeInCycle(Math.floor(cycleTime / 1000)); // Seconds in current cycle
      
      // Alternate every 2 minutes
      const cycles = Math.floor(now / 120000);
      setCurrentSource(cycles % 2 === 0 ? 'cmc' : 'coingecko');
    };
    
    updateSource();
    const interval = setInterval(updateSource, 1000);
    return () => clearInterval(interval);
  }, []);

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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                <Sparkline trend={(fromChange24h ?? 0) >= 0 ? 'up' : 'down'} change={fromChange24h} isLoading={fromPriceUsd === null} priceHistory={fromPriceHistory} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '8px', opacity: 0.7 }}>
                  <div title={currentSource === 'cmc' ? 'CoinMarketCap' : 'CoinGecko'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '12px', height: '12px' }}>
                    {currentSource === 'cmc' ? (
                      <SiCoinmarketcap size={12} style={{ color: '#17f0cb' }} />
                    ) : (
                      <svg viewBox="0 0 500 500" width="12" height="12" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="250" cy="250" r="245" fill="#8DC63F"/>
                        <path d="M250 120c71.6 0 130 58.4 130 130s-58.4 130-130 130-130-58.4-130-130 58.4-130 130-130z" fill="#FFFFFF"/>
                        <path d="M250 160c50.7 0 92 41.3 92 92s-41.3 92-92 92-92-41.3-92-92 41.3-92 92-92z" fill="#8DC63F"/>
                      </svg>
                    )}
                  </div>
                  <span>{timeInCycle}s</span>
                </div>
              </div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                <Sparkline trend={(toChange24h ?? 0) >= 0 ? 'up' : 'down'} change={toChange24h} isLoading={toPriceUsd === null} priceHistory={toPriceHistory} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '8px', opacity: 0.7 }}>
                  <div title={currentSource === 'cmc' ? 'CoinMarketCap' : 'CoinGecko'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '12px', height: '12px' }}>
                    {currentSource === 'cmc' ? (
                      <SiCoinmarketcap size={12} style={{ color: '#17f0cb' }} />
                    ) : (
                      <svg viewBox="0 0 500 500" width="12" height="12" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="250" cy="250" r="245" fill="#8DC63F"/>
                        <path d="M250 120c71.6 0 130 58.4 130 130s-58.4 130-130 130-130-58.4-130-130 58.4-130 130-130z" fill="#FFFFFF"/>
                        <path d="M250 160c50.7 0 92 41.3 92 92s-41.3 92-92 92-92-41.3-92-92 41.3-92 92-92z" fill="#8DC63F"/>
                      </svg>
                    )}
                  </div>
                  <span>{timeInCycle}s</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
