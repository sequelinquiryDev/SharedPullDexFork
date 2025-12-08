# NOLA Exchange - Decentralized Exchange on Polygon

## Overview
NOLA Exchange is a production-ready DEX (Decentralized Exchange) built with React and TypeScript, featuring multi-wallet support via wagmi/WalletConnect, token swaps with 0x and 1inch aggregation, and a real-time chat system.

## Current State
- Complete React conversion from original HTML
- Purple gradient theme with nebula animations and floating particles
- Multi-wallet support (MetaMask, WalletConnect, and more)
- Token swapping with best price aggregation (0x + 1inch)
- Real-time chat via Supabase
- Mobile responsive (320px - 428px)

## Project Architecture

### Frontend (client/)
- **Framework**: React 18 with TypeScript
- **Routing**: wouter
- **State**: React hooks + TanStack Query
- **Wallet**: wagmi + viem
- **Styling**: Tailwind CSS + custom CSS variables

### Backend (server/)
- **Framework**: Express.js
- **Purpose**: API proxy and static file serving

### Key Files
- `client/src/App.tsx` - Main application entry
- `client/src/pages/home.tsx` - DEX swap interface
- `client/src/lib/config.ts` - Environment configuration
- `client/src/lib/wagmiConfig.ts` - Wallet configuration
- `client/src/lib/tokenService.ts` - Token fetching & pricing
- `client/src/lib/swapService.ts` - Quote aggregation & execution
- `client/src/lib/supabaseClient.ts` - Chat functionality
- `client/src/index.css` - Theme & animations

### Components
- `ParticleBackground` - Floating purple particles
- `Logo` - Animated rotating logo
- `ConnectButton` - Multi-wallet connection
- `TokenInput` - Token selection with search
- `SlippageControl` - Slippage settings
- `ChatPanel` - Sliding chat sidebar
- `Toast` - Notification system
- `Footer` - Links and copyright

## Environment Variables

All configuration is in environment variables (see .env.example):
- `VITE_CHAIN_ID` - Polygon chain ID (137)
- `VITE_ZEROX_API_KEY` - 0x API key for quotes
- `VITE_WALLETCONNECT_PROJECT_ID` - WalletConnect project ID
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon key

## Development

```bash
npm run dev  # Start development server
npm run build  # Build for production
```

The app runs on port 5000.

## Tech Stack
- React 18 + TypeScript
- Vite (build tool)
- wagmi v2 + viem (wallet)
- ethers.js v5 (transactions)
- TanStack Query (data fetching)
- Tailwind CSS (styling)
- Supabase (real-time chat)

## Design Tokens
- Primary Purple: #b445ff
- Secondary Purple: #7013ff
- Background: radial gradient from #0c0014 to #1a002b
- Glass: rgba(255,255,255,0.05)
- Font: Arial, sans-serif

## User Preferences
- Dark mode only (DEX theme)
- Touch-friendly (44px minimum targets)
- Mobile-first responsive design
