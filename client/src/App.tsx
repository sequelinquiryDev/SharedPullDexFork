import { Switch, Route } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { queryClient } from '@/lib/queryClient';
import { wagmiConfig } from '@/lib/wagmiConfig';
import { ChainProvider } from '@/lib/chainContext';
import { ParticleBackground } from '@/components/ParticleBackground';
import { Logo } from '@/components/Logo';
import { TokenSearchBar } from '@/components/TokenSearchBar';
import { ConnectButton } from '@/components/ConnectButton';
import { SwitchChainButton } from '@/components/SwitchChainButton';
import { ChatPanel } from '@/components/ChatPanel';
import { ToolsButton } from '@/components/ToolsButton';
import { Footer } from '@/components/Footer';
import { ToastContainer } from '@/components/Toast';
import { CookiesPopup } from '@/components/CookiesPopup';
import Home from '@/pages/home';
import NotFound from '@/pages/not-found';

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ChainProvider defaultChain="POL">
          <ParticleBackground />
          <Logo />
          <TokenSearchBar />
          <ConnectButton />
          <SwitchChainButton />
          <CookiesPopup />
          <Router />
          <ChatPanel />
          <ToolsButton />
          <Footer />
          <ToastContainer />
        </ChainProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;