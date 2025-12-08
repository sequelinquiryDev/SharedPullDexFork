import { Switch, Route } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { queryClient } from '@/lib/queryClient';
import { wagmiConfig } from '@/lib/wagmiConfig';
import { ParticleBackground } from '@/components/ParticleBackground';
import { Logo } from '@/components/Logo';
import { ConnectButton } from '@/components/ConnectButton';
import { ChatPanel } from '@/components/ChatPanel';
import { Footer } from '@/components/Footer';
import { ToastContainer } from '@/components/Toast';
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
        <ParticleBackground />
        <Logo />
        <ConnectButton />
        <Router />
        <ChatPanel />
        <Footer />
        <ToastContainer />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
