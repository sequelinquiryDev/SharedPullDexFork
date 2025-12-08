import { useState, useEffect, useCallback } from 'react';
import { explorerTxLink } from '@/lib/config';

interface ToastMessage {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warn';
  txHash?: string;
  ttl: number;
}

let toastId = 0;
const toastListeners: Set<(toast: ToastMessage) => void> = new Set();

export function showToast(
  message: string,
  opts: { type?: 'info' | 'success' | 'error' | 'warn'; txHash?: string; ttl?: number } = {}
) {
  const toast: ToastMessage = {
    id: ++toastId,
    message,
    type: opts.type || 'info',
    txHash: opts.txHash,
    ttl: opts.ttl || 4000,
  };
  toastListeners.forEach((listener) => listener(toast));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: ToastMessage) => {
    setToasts((prev) => {
      if (prev.length >= 3) {
        return [...prev.slice(1), toast];
      }
      return [...prev, toast];
    });

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, toast.ttl);
  }, []);

  useEffect(() => {
    toastListeners.add(addToast);
    return () => {
      toastListeners.delete(addToast);
    };
  }, [addToast]);

  return (
    <div
      style={{
        pointerEvents: 'none',
        position: 'fixed',
        right: '18px',
        bottom: '90px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
      data-testid="toast-container"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          style={{
            pointerEvents: 'auto',
            animation: 'cardIn 180ms ease',
          }}
          data-testid={`toast-${toast.id}`}
        >
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>{toast.message}</div>
            {toast.txHash && (
              <div style={{ fontSize: '12px', marginLeft: '8px' }}>
                <a
                  href={explorerTxLink(toast.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`toast-tx-link-${toast.id}`}
                >
                  View
                </a>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
