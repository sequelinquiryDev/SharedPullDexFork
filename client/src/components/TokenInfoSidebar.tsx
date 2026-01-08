import { useState, useEffect, useRef, useMemo } from 'react';
import { Token, fetchTokenIcon, getPlaceholderImage } from '@/lib/tokenService';
import { formatUSD } from '@/lib/config';

interface ExtendedToken extends Token {
  chainId?: number;
}

interface TokenInfoSidebarProps {
  fromToken: ExtendedToken | null;
  toToken: ExtendedToken | null;
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

/**
 * Advanced curve drawing algorithms for smooth sparklines
 * Uses Catmull-Rom spline interpolation for natural curves
 */

// Catmull-Rom spline interpolation for smooth curves
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const a1 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const a2 = -0.5 * p0 + 0.5 * p2;
  const a3 = p1;
  
  return a0 * t * t * t + a1 * t * t + a2 * t + a3;
}

// Generate smooth curve points using Catmull-Rom interpolation
function interpolateCurve(data: number[], samplesPerSegment: number = 8): number[] {
  if (data.length < 2) return data;
  if (data.length === 2) {
    // Linear interpolation for 2 points
    const result: number[] = [];
    for (let i = 0; i < samplesPerSegment; i++) {
      result.push(data[0] + (data[1] - data[0]) * (i / (samplesPerSegment - 1)));
    }
    return result;
  }
  
  const result: number[] = [];
  
  // For Catmull-Rom, we need points before and after the segment
  for (let i = 0; i < data.length - 1; i++) {
    const p0 = i === 0 ? data[0] : data[i - 1];
    const p1 = data[i];
    const p2 = data[i + 1];
    const p3 = i === data.length - 2 ? data[data.length - 1] : data[i + 2];
    
    for (let j = 0; j < samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      result.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  
  // Add final point
  result.push(data[data.length - 1]);
  return result;
}

// Professional sparkline with empathetic colors and movement-aware dots
function Sparkline({ trend, change, isLoading, priceHistory }: { trend: 'up' | 'down'; change?: number | null; isLoading?: boolean; priceHistory?: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Process price history: expecting 1-hour data with 5-minute intervals (12 points max)
  const sparklineData = useMemo(() => {
    if (priceHistory && priceHistory.length >= 2) {
      // Use real historical price data: 1-hour frame with 5-minute movements
      // Expected: array of up to 12 points (1 hour / 5 min = 12)
      const maxPoints = Math.min(priceHistory.length, 12); // Max 12 for 1-hour 5-min intervals
      const rawData = priceHistory.slice(-maxPoints);
      
      // Interpolate smoothly with Catmull-Rom spline (8 samples per segment)
      return interpolateCurve(rawData, 8);
    }
    
    // Fallback: Generate realistic price data representing 1 hour of price movement
    // 12 data points for 1-hour at 5-minute intervals
    const intervals = 12;
    const changePercent = change ?? (trend === 'up' ? 1.5 : -1.5);
    const volatility = Math.abs(changePercent) * 0.3;
    
    const data: number[] = [];
    let currentPrice = 100;
    const targetPrice = 100 + changePercent;
    const priceStep = (targetPrice - currentPrice) / intervals;
    
    // Generate 12 price points simulating realistic market movement over 1 hour
    for (let i = 0; i < intervals; i++) {
      const progressRatio = i / intervals;
      
      // Ornstein-Uhlenbeck process for realistic price movement
      const noise = (Math.random() - 0.5) * volatility;
      const meanReversion = (currentPrice - (100 + priceStep * i)) * 0.08;
      const trend_component = priceStep * (0.7 + Math.random() * 0.6);
      
      currentPrice = currentPrice + trend_component + noise - meanReversion;
      data.push(Math.max(currentPrice, 50));
    }
    
    // Interpolate for smooth curve
    return interpolateCurve(data, 8);
  }, [priceHistory, trend, change]);

  // Calculate trend from actual price history data (1-hour range)
  const calculatedTrend = useMemo(() => {
    if (!priceHistory || priceHistory.length < 2) return trend;
    const firstPrice = priceHistory[0];
    const lastPrice = priceHistory[priceHistory.length - 1];
    // If prices are nearly identical (stablecoin), return neutral
    const volatilityPercent = Math.abs((lastPrice - firstPrice) / firstPrice) * 100;
    if (volatilityPercent < 0.1) return 'neutral'; // Less than 0.1% change = stablecoin
    return lastPrice > firstPrice ? 'up' : 'down';
  }, [priceHistory, trend]);

  // Calculate recent 5-minute movement for dot indicator
  const recentMovement = useMemo(() => {
    if (!priceHistory || priceHistory.length < 2) return 'neutral';
    // Last point is most recent (5-minute frame just completed)
    // Compare with previous 5-minute interval
    const lastPrice = priceHistory[priceHistory.length - 1];
    const prevPrice = priceHistory[Math.max(0, priceHistory.length - 2)];
    const diff = (lastPrice - prevPrice) / prevPrice;
    
    // Only show movement if there's actual change > 0.05% (more sensitive for 5-min frame)
    if (Math.abs(diff) < 0.0005) return 'neutral';
    if (diff > 0) return 'up';
    if (diff < 0) return 'down';
    return 'neutral';
  }, [priceHistory]);
  
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
    if (data.length === 0) return;
    
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = Math.max(max - min, 0.0001); // Prevent division by zero
    
    // Empathetic color scheme - softer, more sophisticated
    const lineColorUp = 'rgba(106, 230, 230, 0.85)'; // Peaceful cyan
    const lineColorDown = 'rgba(255, 140, 130, 0.85)'; // Gentle coral
    const lineColorNeutral = 'rgba(148, 163, 184, 0.7)'; // Steady slate
    const glowColorUp = 'rgba(106, 230, 230, 0.25)';
    const glowColorDown = 'rgba(255, 140, 130, 0.25)';
    const glowColorNeutral = 'rgba(148, 163, 184, 0.15)';
    
    const lineColor = calculatedTrend === 'up' ? lineColorUp : calculatedTrend === 'down' ? lineColorDown : lineColorNeutral;
    const glowColor = calculatedTrend === 'up' ? glowColorUp : calculatedTrend === 'down' ? glowColorDown : glowColorNeutral;
    
    // Helper function to convert price to canvas Y coordinate
    const priceToY = (price: number): number => 34 - ((price - min) / range) * 30;
    const priceToX = (index: number): number => 2 + (index / Math.max(data.length - 1, 1)) * 96;
    
    // Draw gradient area under line with empathetic feel
    const gradient = ctx.createLinearGradient(0, 0, 0, 36);
    gradient.addColorStop(0, glowColor);
    gradient.addColorStop(1, glowColor.replace('0.25', '0.02').replace('0.15', '0.01'));
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(2, 34);
    
    // Use smooth interpolated curve for area fill
    for (let i = 0; i < data.length; i++) {
      const x = priceToX(i);
      const y = priceToY(data[i]);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(98, 34);
    ctx.closePath();
    ctx.fill();
    
    // Draw main price line with advanced rendering
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.2; // Slightly thicker for better visibility
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Enable image smoothing for better curve rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.beginPath();
    ctx.moveTo(priceToX(0), priceToY(data[0]));
    
    // Draw smooth curve using the interpolated data (already smooth from Catmull-Rom)
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(priceToX(i), priceToY(data[i]));
    }
    ctx.stroke();
    
    // Add subtle glow effect to the line (second pass with lower opacity, thicker)
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.moveTo(priceToX(0), priceToY(data[0]));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(priceToX(i), priceToY(data[i]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;
    
    // Terminal dot with movement-aware color indicator (shows recent 5-min movement)
    const lastX = priceToX(data.length - 1);
    const lastY = priceToY(data[data.length - 1]);
    
    let dotOuterColor: string;
    let dotInnerColor: string;
    
    if (recentMovement === 'up') {
      dotOuterColor = 'rgba(52, 211, 153, 0.4)'; // Green glow
      dotInnerColor = 'rgba(16, 185, 129, 1)'; // Solid green
    } else if (recentMovement === 'down') {
      dotOuterColor = 'rgba(251, 146, 60, 0.4)'; // Orange glow
      dotInnerColor = 'rgba(249, 115, 22, 1)'; // Solid orange
    } else {
      if (calculatedTrend === 'neutral') {
        dotOuterColor = 'rgba(148, 163, 184, 0.3)'; // Slate glow
        dotInnerColor = 'rgba(107, 114, 128, 1)'; // Solid slate
      } else {
        dotOuterColor = calculatedTrend === 'up' ? 'rgba(106, 230, 230, 0.4)' : 'rgba(255, 140, 130, 0.4)';
        dotInnerColor = calculatedTrend === 'up' ? 'rgba(106, 230, 230, 1)' : 'rgba(255, 140, 130, 1)';
      }
    }
    
    // Draw outer glow circle
    ctx.fillStyle = dotOuterColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw middle ring for depth
    ctx.fillStyle = dotOuterColor.replace('0.4', '0.25');
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw solid indicator dot
    ctx.fillStyle = dotInnerColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }, [calculatedTrend, sparklineData, isLoading, recentMovement]);
  
  if (isLoading) {
    return <LoadingPulse width={100} height={36} />;
  }
  
  return <canvas ref={canvasRef} style={{ width: '100px', height: '36px' }} />;
}

function TokenIcon({ token }: { token: ExtendedToken }) {
  const [iconUrl, setIconUrl] = useState<string>(getPlaceholderImage());
  
  useEffect(() => {
    let mounted = true;
    const fetchIcon = async () => {
      const url = await fetchTokenIcon(token, token.chainId);
      if (mounted) setIconUrl(url);
    };
    fetchIcon();
    return () => { mounted = false; };
  }, [token]);

  return (
    <img 
      src={iconUrl} 
      alt={token.symbol} 
      style={{ width: '28px', height: '28px', borderRadius: '50%' }}
      onError={(e) => {
        (e.target as HTMLImageElement).src = getPlaceholderImage();
      }} 
    />
  );
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
                <TokenIcon token={fromToken} />
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
                <TokenIcon token={toToken} />
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
