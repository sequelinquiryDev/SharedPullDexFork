// WebSocket price streaming service with automatic subscription management
import { OnChainPrice } from '@/lib/config';

let ws: WebSocket | null = null;
const activeSubscriptions = new Map<string, (price: OnChainPrice) => void>();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

export function connectPriceService(): void {
  if (ws) return;
  
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/prices`);
    
    ws.onopen = () => {
      console.log('✓ Price WebSocket connected');
      reconnectAttempts = 0;
    };
    
    ws.onmessage = (event) => {
      try {
        const { type, data, address, chainId } = JSON.parse(event.data);
        if (type === 'price') {
          const subKey = `${chainId}-${address.toLowerCase()}`;
          const callback = activeSubscriptions.get(subKey);
          if (callback) callback(data);
        }
      } catch (e) {
        console.error('Price message parse error:', e);
      }
    };
    
    ws.onclose = () => {
      ws = null;
      // Reconnect with exponential backoff
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(() => {
          reconnectAttempts++;
          connectPriceService();
        }, Math.min(1000 * Math.pow(2, reconnectAttempts), 30000));
      }
    };
    
    ws.onerror = (error) => {
      console.error('Price WebSocket error:', error);
    };
  } catch (e) {
    console.error('Failed to create WebSocket:', e);
  }
}

export function subscribeToPrice(
  address: string,
  chainId: number,
  callback: (price: OnChainPrice) => void
): () => void {
  const subKey = `${chainId}-${address.toLowerCase()}`;
  
  // Store callback
  activeSubscriptions.set(subKey, callback);
  
  // Connect if needed
  if (!ws) connectPriceService();
  
  // Send subscribe message
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', address, chainId }));
  } else {
    // Will auto-subscribe when connection opens
    const checkConnection = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', address, chainId }));
        clearInterval(checkConnection);
      }
    }, 100);
    setTimeout(() => clearInterval(checkConnection), 5000);
  }
  
  // Return unsubscribe function
  return () => {
    // Only delete from activeSubscriptions if this specific callback is the one registered
    if (activeSubscriptions.get(subKey) === callback) {
      activeSubscriptions.delete(subKey);
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', address, chainId }));
    }
  };
}

export function disconnectPriceService(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
  activeSubscriptions.clear();
}
