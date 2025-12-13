import { createConfig, http } from 'wagmi';
import { polygon, mainnet } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { config, ethereumConfig } from './config';

const projectId = config.walletConnectProjectId;

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
    [polygon.id]: http(config.rpcUrls[0]),
    [mainnet.id]: http(ethereumConfig.rpcUrls[0]),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
