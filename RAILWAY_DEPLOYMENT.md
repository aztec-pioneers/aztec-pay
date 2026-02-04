# Railway Deployment Guide for AztecPay (No Docker)

This guide covers deploying AztecPay on [Railway](https://railway.app) using the **default Nixpacks builder** (no Docker required).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Railway                              │
│  ┌──────────────────┐         ┌──────────────────────────┐  │
│  │   Frontend       │         │        Backend           │  │
│  │   (Static Site)  │────────▶│  (Node.js + Express)     │  │
│  │   Port: 5173     │  API    │  Port: 3001              │  │
│  └──────────────────┘         └──────────────────────────┘  │
│                                          │                   │
│                                          ▼                   │
│                               ┌──────────────────────────┐  │
│                               │   Aztec Devnet Node      │  │
│                               │   (External)             │  │
│                               └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **GitHub Repository**: Push your AztecPay code to GitHub
3. **Base Sepolia RPC**: Get a free RPC URL from [Alchemy](https://alchemy.com) or [Infura](https://infura.io)
4. **Aztec Devnet Access**: The app connects to `https://devnet-6.aztec-labs.com`

---

## Project Structure for Railway

Your repository should have:
```
aztec-pay/
├── app/                    # Frontend source
├── src/ts/                 # Backend source
├── package.json            # Dependencies & scripts
├── railway.json            # Railway config (backend)
├── railway.toml            # Railway config (alternative)
└── ...
```

---

## Service 1: Backend API

### Step 1: Create Backend Service

1. In Railway dashboard, click **"New"** → **"Project"**
2. Click **"New"** → **"Service"** → **"GitHub Repo"**
3. Select your AztecPay repository
4. Name the service: `aztec-pay-backend`

### Step 2: Configure Build Settings

| Setting | Value |
|---------|-------|
| **Builder** | `Nixpacks` (default) |
| **Root Directory** | `/` (leave empty) |

> **Note**: The `railway.toml` file in your repo will configure this automatically.

### Step 3: Environment Variables

Add these environment variables in Railway dashboard (**Variables** tab):

#### Required Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `AZTEC_ENV` | `devnet` | Must be devnet for Railway |
| `AZTEC_NODE_URL` | `https://devnet-6.aztec-labs.com` | Aztec devnet node |
| `SPONSORED_FPC_ADDRESS` | `0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e` | Sponsored fee payment contract |
| `PORT` | `3001` | Backend port (required by Railway) |
| `NODE_ENV` | `production` | Production mode |

#### EVM Bridge Configuration (Required)

| Variable | Value | Description |
|----------|-------|-------------|
| `EVM_PRIVATE_KEY` | `0x...` | Private key with Base Sepolia ETH |
| `EVM_RPC_URL` | `https://...` | Base Sepolia RPC (Alchemy/Infura) |
| `EVM_TOKEN_ADDRESS` | `0x...` | Your deployed EVM token contract |

#### Aztec Contract Addresses (from your deployment.json)

| Variable | Value | Description |
|----------|-------|-------------|
| `TOKEN_ADDRESS` | `0x...` | Aztec token contract address |
| `MINTER_ADDRESS` | `0x...` | Aztec minter account address |
| `MINTER_SECRET` | `0x...` | Minter secret key |
| `MINTER_SALT` | `0x...` | Minter salt |

### Step 4: Configure Start Command

In Railway dashboard, go to **Settings** → **Deploy**:

| Setting | Value |
|---------|-------|
| **Start Command** | `npm run server:devnet` |
| **Healthcheck Path** | `/api/health` |
| **Healthcheck Timeout** | `300` (5 minutes) |

### Step 5: Networking

- Railway will automatically expose the port defined in `PORT` environment variable
- **Generate Domain**: Enable this to get a public URL (e.g., `https://aztec-pay-backend.up.railway.app`)
- Copy this domain - you'll need it for the frontend

---

## Service 2: Frontend (Static Site)

### Step 1: Create Frontend Service

1. In the same Railway project, click **"New"** → **"Service"** → **"GitHub Repo"**
2. Select the same AztecPay repository
3. Name the service: `aztec-pay-frontend`

### Step 2: Configure Build Settings

| Setting | Value |
|---------|-------|
| **Builder** | `Nixpacks` (default) |
| **Build Command** | `npm install && npm run build:devnet` |
| **Start Command** | `npx serve -s dist -p 5173` |

### Step 3: Environment Variables

Add these environment variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `AZTEC_ENV` | `devnet` | Frontend environment |
| `NODE_ENV` | `production` | Production build |
| `AZTEC_NODE_URL` | `https://devnet-6.aztec-labs.com` | Aztec node URL |
| `API_BASE_URL` | `https://your-backend.up.railway.app` | **IMPORTANT**: Your backend URL |

> **⚠️ Critical**: Replace `your-backend.up.railway.app` with the actual domain from your backend service (Step 5 above).

### Step 4: Networking

- **Port**: `5173`
- **Generate Domain**: Enable this for your public frontend URL

---

## Configuration Files

### `railway.toml` (Backend Service)

Create this file in your repo root:

```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "npm run server:devnet"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

### `package.json` Scripts

Ensure your `package.json` has these scripts:

```json
{
  "scripts": {
    "dev": "webpack serve --mode development",
    "dev:devnet": "AZTEC_ENV=devnet webpack serve --mode development",
    "build": "webpack --mode production",
    "build:devnet": "AZTEC_ENV=devnet webpack --mode production",
    "server": "tsx src/ts/server.ts",
    "server:devnet": "AZTEC_ENV=devnet tsx src/ts/server.ts",
    "start": "npm run server:devnet"
  }
}
```

---

## Deployment Steps

### Step 1: Prepare Your Repository

1. Ensure all code is pushed to GitHub
2. Verify `railway.toml` exists in repo root
3. Make sure `.env` is in `.gitignore` (never commit secrets!)

### Step 2: Deploy Backend First

1. Create backend service in Railway
2. Add all environment variables
3. Deploy and wait for healthcheck to pass
4. Copy the backend domain URL

### Step 3: Deploy Frontend

1. Create frontend service in Railway
2. Set `API_BASE_URL` to your backend domain
3. Deploy frontend
4. Visit the frontend domain to test

### Step 4: Verify Deployment

1. Visit your frontend URL
2. Generate a payment link
3. Open the claim link in a new tab
4. Complete the claim flow
5. Check that tokens arrive on Base Sepolia

---

## Environment Variables Reference

### Complete Backend Variables

```env
# Core Settings
AZTEC_ENV=devnet
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
PORT=3001
NODE_ENV=production

# EVM Bridge (Base Sepolia)
EVM_PRIVATE_KEY=0x22d423e3b79256b3f3bd85d6c42e04c4a2844e1512328e6aa370919d4c5e89db
EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
EVM_TOKEN_ADDRESS=0x8e967C9D33E2a97cca55Be55276c05EAE39c2201

# Aztec Contracts
TOKEN_ADDRESS=0x2276dbef3608e81a4290d0e6106295233b89233adf3a09b40505a165d7b83777
MINTER_ADDRESS=0x1fb205206044f27e5513b66ad9c08b19604e1c8a56000db24b8ac89741191a46
MINTER_SECRET=0x14fcb1fae161095fd39029572a337aea534f6d26aea2ab027e6dd907c04d21ff
MINTER_SALT=0x047d7085627604f995f8614119418e983acd4e92a146a61fb9c5c9b5c0bd7a4c
```

### Complete Frontend Variables

```env
AZTEC_ENV=devnet
NODE_ENV=production
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
API_BASE_URL=https://aztec-pay-backend.up.railway.app
```

---

## Troubleshooting

### Issue: Build fails with "node-gyp" errors
**Solution**: Railway's Nixpacks should handle this. If not, add a `nixpacks.toml`:
```toml
[phases.build]
cmds = ["npm install --build-from-source", "npm run build:devnet"]
```

### Issue: "Cannot find module 'tsx'"
**Solution**: Ensure `tsx` is in devDependencies in package.json:
```json
"devDependencies": {
  "tsx": "^4.19.2"
}
```

### Issue: Frontend shows "Cannot connect to backend"
**Solution**: 
1. Verify `API_BASE_URL` includes `https://`
2. Check CORS is enabled on backend
3. Ensure backend healthcheck passes

### Issue: "AZTEC_ENV is not set" error
**Solution**: Set `AZTEC_ENV=devnet` in BOTH backend and frontend variables.

### Issue: Claim transaction fails
**Solution**: 
1. Check browser console for errors
2. Verify minter account has tokens on Aztec devnet
3. Ensure EVM bridge has tokens and ETH on Base Sepolia

---

## Alternative: Using Static Website for Frontend

If you prefer, you can deploy the frontend as a **Static Website** on Railway:

1. Create service from GitHub repo
2. Select **"Static Website"** as the service type
3. Set build command: `npm install && npm run build:devnet`
4. Set publish directory: `dist`
5. Add environment variables as above

---

## Monitoring & Logs

### View Logs
- Go to your service in Railway dashboard
- Click **"Deployments"** tab
- Click on a deployment to see logs

### Health Check
Backend health endpoint: `GET /api/health`
Should return: `{"status": "ok"}`

---

## Security Best Practices

1. **Never commit `.env`**: Add it to `.gitignore`
2. **Use Railway Variables**: All secrets should be in Railway dashboard
3. **Restrict CORS**: In production, update backend CORS to only allow your frontend domain
4. **HTTPS Only**: Railway provides HTTPS automatically
5. **Private Keys**: Use a dedicated wallet for deployment (not your main wallet)

---

## Cost Estimation (Railway)

| Resource | Estimated Cost |
|----------|----------------|
| Backend (512MB RAM, 1 CPU) | ~$5-10/month |
| Frontend (Static) | ~$0-5/month |
| **Total** | **~$5-15/month** |

> Note: Backend uses CPU for ZK proof generation. Higher specs may be needed for faster proving.

---

## Support & Resources

- **Railway Docs**: https://docs.railway.app
- **Railway Discord**: https://discord.gg/railway
- **Aztec Docs**: https://docs.aztec.network
- **Aztec Discord**: https://discord.gg/aztec
