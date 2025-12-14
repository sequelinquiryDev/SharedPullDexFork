
import { Router } from 'express';

const router = Router();

// Secure endpoint to get RPC URLs
router.get('/rpc/:chain', (req, res) => {
  const { chain } = req.params;
  
  if (chain === 'polygon') {
    res.json({
      rpcs: [
        process.env.POLYGON_RPC_1 || 'https://polygon-rpc.com',
        process.env.POLYGON_RPC_2 || 'https://rpc-mainnet.maticvigil.com',
      ]
    });
  } else if (chain === 'ethereum') {
    res.json({
      rpcs: [
        process.env.ETHEREUM_RPC_1 || 'https://eth.llamarpc.com',
        process.env.ETHEREUM_RPC_2 || 'https://rpc.ankr.com/eth',
      ]
    });
  } else {
    res.status(400).json({ error: 'Invalid chain' });
  }
});

// Secure endpoint to get API keys
router.get('/keys', (req, res) => {
  res.json({
    coingecko: process.env.VITE_COINGECKO_API_KEY || '',
    zeroX: process.env.VITE_ZEROX_API_KEY || '',
  });
});

export default router;
