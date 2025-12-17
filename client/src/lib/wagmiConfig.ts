import { createConfig, http } from 'wagmi';
import { polygon, mainnet } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { config, fetchServerConfig } from './config';

// SECURITY: RPC URLs are NEVER stored client-side
// All blockchain calls go through server proxy endpoints

// Dynamic config for WalletConnect only
let walletConnectProjectId = '';

// Initialize wagmi config with server-provided values
export async function initializeWagmiConfig(): Promise<void> {
  try {
    const serverConfig = await fetchServerConfig();
    if (serverConfig.walletConnectProjectId) {
      walletConnectProjectId = serverConfig.walletConnectProjectId;
    }
    // RPC URLs are NEVER fetched - we use proxy endpoints
  } catch (err) {
    console.error('Failed to initialize wagmi config:', err);
  }
}

// Get project ID
function getProjectId(): string {
  return walletConnectProjectId || config.walletConnectProjectId || '';
}

const projectId = getProjectId();

export const wagmiConfig = createConfig({
  chains: [polygon, mainnet],
  connectors: [
    injected(),
    walletConnect({
      projectId,
      metadata: {
        name: config.siteName,
        description: 'Decentralized Exchange on Polygon & Ethereum',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://nola.exchange',
        icons: [typeof window !== 'undefined' ? `${window.location.origin}/logo.gif` : '/logo.gif'],
      },
      showQrModal: true,
    }),
  ],
  transports: {
    // SECURITY: Use server-proxied RPC endpoints - custom RPC URLs with API keys are protected server-side
    // The server uses VITE_POL_RPC_URL and VITE_ETH_RPC_URL as primary, with public fallbacks
    [polygon.id]: http('/api/proxy/rpc/pol'),
    [mainnet.id]: http('/api/proxy/rpc/eth'),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
