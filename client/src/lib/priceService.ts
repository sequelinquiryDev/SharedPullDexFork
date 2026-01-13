// WebSocket price streaming service with automatic subscription management
// Implements TTL-based cleanup and intelligent pool caching
// Fixed for chain-switching: properly handles subscriptions across ETH/POL/BRG modes
import { OnChainPrice } from '@/lib/config';

let ws: WebSocket | null = null;
const activeSubscriptions = new Map<string, { callback: (price: OnChainPrice) => void; ttlTimer?: NodeJS.Timeout; chainId: number; address: string }>();
const subscriptionTTLTimers = new Map<string, NodeJS.Timeout>();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const SUBSCRIPTION_TTL = 60 * 1000; // 1 minute TTL for unsubscribed tokens
let pendingSubscriptions: Array<{ address: string; chainId: number }> = []; // Queue for pending subscriptions during reconnect

export function connectPriceService(): void {
  if (ws) return;
  
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/prices`);
    
    ws.onopen = () => {
      console.log('✓ Price WebSocket connected');
      reconnectAttempts = 0;
      
      // Re-subscribe to all active subscriptions after reconnect
      if (pendingSubscriptions.length > 0) {
        console.log(`[PriceService] Re-subscribing to ${pendingSubscriptions.length} pending subscriptions`);
        pendingSubscriptions.forEach(({ address, chainId }) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe', address, chainId }));
          }
        });
        pendingSubscriptions = [];
      }
      
      // Also re-subscribe to all currently active subscriptions
      activeSubscriptions.forEach((sub, subKey) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribe', address: sub.address, chainId: sub.chainId }));
        }
      });
    };
    
    ws.onmessage = (event) => {
      try {
        const { type, data, address, chainId } = JSON.parse(event.data);
        if (type === 'price') {
          const subKey = `${chainId}-${address.toLowerCase()}`;
          const sub = activeSubscriptions.get(subKey);
          if (sub) {
            sub.callback(data);
            // Clear TTL timer on new price update (token is still active)
            if (sub.ttlTimer) {
              clearTimeout(sub.ttlTimer);
              sub.ttlTimer = undefined;
            }
          }
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
  
  // Store callback with TTL management and chain info for reconnection
  activeSubscriptions.set(subKey, { callback, chainId, address: address.toLowerCase() });
  
  // Clear any existing TTL timer (token is being re-subscribed)
  if (subscriptionTTLTimers.has(subKey)) {
    clearTimeout(subscriptionTTLTimers.get(subKey)!);
    subscriptionTTLTimers.delete(subKey);
    console.log(`[PriceService] TTL cleared for ${subKey} due to re-subscription`);
  }
  
  // Connect if needed
  if (!ws) connectPriceService();
  
  // Send subscribe message
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', address, chainId }));
    console.log(`[PriceService] ✓ Subscribed to ${subKey}`);
  } else {
    // Queue for re-subscription when connection opens
    pendingSubscriptions.push({ address: address.toLowerCase(), chainId });
    console.log(`[PriceService] Queued subscription for ${subKey} (WebSocket not ready)`);
  }
  
  // Return unsubscribe function
  return () => {
    const sub = activeSubscriptions.get(subKey);
    // Only delete from activeSubscriptions if this specific callback is the one registered
    if (sub && sub.callback === callback) {
      activeSubscriptions.delete(subKey);
      console.log(`[PriceService] Unsubscribed from ${subKey}`);
    }
    
    // Remove from pending queue if present
    pendingSubscriptions = pendingSubscriptions.filter(
      p => !(p.address === address.toLowerCase() && p.chainId === chainId)
    );
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', address, chainId }));
    }
    
    // Start TTL cleanup: if no one is listening after 1 minute, server will clean up
    if (!subscriptionTTLTimers.has(subKey)) {
      const timer = setTimeout(() => {
        console.log(`[PriceService] TTL expired for ${subKey}, cleaning up`);
        subscriptionTTLTimers.delete(subKey);
      }, SUBSCRIPTION_TTL);
      subscriptionTTLTimers.set(subKey, timer);
    }
  };
}

// Clear all subscriptions (useful when switching chains)
export function clearAllSubscriptions(): void {
  console.log(`[PriceService] Clearing all ${activeSubscriptions.size} active subscriptions`);
  activeSubscriptions.forEach((sub, key) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const [chainId, address] = key.split('-');
      ws.send(JSON.stringify({ type: 'unsubscribe', address, chainId: Number(chainId) }));
    }
  });
  activeSubscriptions.clear();
  subscriptionTTLTimers.forEach(timer => clearTimeout(timer));
  subscriptionTTLTimers.clear();
  pendingSubscriptions = [];
}

export function disconnectPriceService(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
  activeSubscriptions.clear();
}
