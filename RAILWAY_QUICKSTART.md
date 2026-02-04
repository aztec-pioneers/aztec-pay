# Railway Quickstart (No Docker)

## Files Added
- `railway.toml` - Backend service configuration
- `railway.json` - Alternative Railway config (JSON format)
- `nixpacks.toml` - Nixpacks builder configuration
- `RAILWAY_DEPLOYMENT.md` - Full deployment guide

## Backend Service Settings

| Setting | Value |
|---------|-------|
| Builder | `Nixpacks` (default) |
| Start Command | `npm run server:devnet` |
| Healthcheck | `/api/health` |
| Port | `3001` |

## Frontend Service Settings

| Setting | Value |
|---------|-------|
| Builder | `Nixpacks` (default) |
| Build Command | `npm install && npm run build:devnet` |
| Start Command | `npx serve -s dist -p 5173` |
| Port | `5173` |

## Required Environment Variables

### Backend
```env
AZTEC_ENV=devnet
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
PORT=3001
NODE_ENV=production
EVM_PRIVATE_KEY=your_key
EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/...
EVM_TOKEN_ADDRESS=your_token
TOKEN_ADDRESS=your_aztec_token
MINTER_ADDRESS=your_minter
MINTER_SECRET=your_secret
MINTER_SALT=your_salt
```

### Frontend
```env
AZTEC_ENV=devnet
NODE_ENV=production
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
API_BASE_URL=https://your-backend.up.railway.app
```

## Deployment Order
1. Deploy Backend → Copy domain URL
2. Set Frontend `API_BASE_URL` to backend domain
3. Deploy Frontend
4. Done!

See `RAILWAY_DEPLOYMENT.md` for full details.
