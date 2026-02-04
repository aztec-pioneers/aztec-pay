# AztecPay Railway Deployment

Deploy AztecPay to Railway with either **Nixpacks** (default) or **Docker**.

## Quick Deploy

### Option 1: Nixpacks (Easiest)
```bash
# Just push to GitHub, Railway handles the rest
git push origin main
```
Then in Railway:
- Builder: `Nixpacks`
- Start Command: `npm run server:devnet`

### Option 2: Docker (Production)
```bash
# Push to GitHub
git push origin main
```
Then in Railway:
- Builder: `Dockerfile`
- Dockerfile: `Dockerfile.backend`

---

## Files Overview

| File | Purpose |
|------|---------|
| `Dockerfile.backend` | Backend + frontend combined (RECOMMENDED) |
| `Dockerfile.frontend` | Frontend only (nginx) |
| `railway.toml` | Nixpacks backend config |
| `railway-docker-backend.toml` | Docker backend config |
| `RAILWAY_DEPLOYMENT.md` | Nixpacks full guide |
| `RAILWAY_DOCKER_DEPLOYMENT.md` | Docker full guide |
| `DEPLOYMENT_OPTIONS.md` | Compare options |

---

## Step-by-Step Deployment

### 1. Prepare Repository

Ensure these files are committed:
```bash
git add Dockerfile.backend railway.toml package.json
git commit -m "Add Railway deployment config"
git push
```

### 2. Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Click **"New Project"**
3. Click **"New"** → **"Service"** → **"GitHub Repo"**
4. Select your AztecPay repository

### 3. Configure Service

#### For Docker (Recommended):
| Setting | Value |
|---------|-------|
| Builder | `Dockerfile` |
| Dockerfile | `Dockerfile.backend` |

#### For Nixpacks:
| Setting | Value |
|---------|-------|
| Builder | `Nixpacks` |
| Start Command | `npm run server:devnet` |

### 4. Set Environment Variables

In Railway dashboard → **Variables** tab:

```env
# REQUIRED - Core Configuration
AZTEC_ENV=devnet
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
PORT=3001
NODE_ENV=production

# REQUIRED - EVM Bridge (Base Sepolia)
EVM_PRIVATE_KEY=your_private_key_with_0x
EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/your_key
EVM_TOKEN_ADDRESS=your_evm_token_contract

# REQUIRED - Aztec Contracts (from deployment.json)
TOKEN_ADDRESS=your_aztec_token
MINTER_ADDRESS=your_minter
MINTER_SECRET=your_secret
MINTER_SALT=your_salt
```

### 5. Deploy

Click **"Deploy"** and wait for:
- Build to complete
- Healthcheck to pass (`/api/health`)
- Public domain to be assigned

### 6. Access Your App

Visit the public domain shown in Railway dashboard:
```
https://aztec-pay-backend.up.railway.app
```

This serves both the API and the frontend!

---

## Docker-Specific: Build Arguments

If using Docker with separate frontend service, set build arguments:

| Build Arg | Value |
|-----------|-------|
| `API_BASE_URL` | `https://your-backend.up.railway.app` |
| `AZTEC_NODE_URL` | `https://devnet-6.aztec-labs.com` |
| `AZTEC_ENV` | `devnet` |

---

## Testing Your Deployment

1. **Generate Payment Link**
   - Visit your Railway domain
   - Enter amount (e.g., 100)
   - Click "Generate Link"

2. **Claim Payment**
   - Open the generated link in new tab
   - Enter Base Sepolia address
   - Click "Claim"
   - Wait for bridge confirmation

3. **Verify**
   - Check Base Sepolia for received tokens
   - View transaction on BaseScan

---

## Troubleshooting

### Build Fails
- Check all environment variables are set
- Verify `AZTEC_ENV=devnet` is set
- Check Railway logs for specific errors

### Healthcheck Fails
- Ensure `PORT=3001` is set
- Check `/api/health` endpoint is accessible
- Verify contracts are deployed to devnet

### Frontend Can't Connect
- For single-service: `API_BASE_URL` should be empty
- Check CORS settings in backend
- Verify backend is healthy

### Claim Fails
- Check browser console for errors
- Verify minter has tokens on Aztec devnet
- Ensure EVM bridge has ETH on Base Sepolia

---

## Useful Commands

```bash
# Build Docker locally (test before deploying)
docker build -f Dockerfile.backend -t aztec-pay:test .
docker run -p 3001:3001 --env-file .env aztec-pay:test

# Using Railway CLI
railway login
railway link
railway up
railway logs
```

---

## Architecture

```
┌──────────────────────────────────────────────┐
│              Railway Platform                │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │         Your Service                   │  │
│  │  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │  Backend API │  │  Frontend    │   │  │
│  │  │  (Node.js)   │  │  (Static)    │   │  │
│  │  │  Port: 3001  │  │  (Built-in)  │   │  │
│  │  └──────┬───────┘  └──────────────┘   │  │
│  │         │                              │  │
│  │         ▼                              │  │
│  │  ┌─────────────────────────────────┐   │  │
│  │  │     Aztec Devnet Node           │   │  │
│  │  │     (External)                  │   │  │
│  │  └─────────────────────────────────┘   │  │
│  │         │                              │  │
│  │         ▼                              │  │
│  │  ┌─────────────────────────────────┐   │  │
│  │  │     Base Sepolia                │   │  │
│  │  │     (EVM Bridge)                │   │  │
│  │  └─────────────────────────────────┘   │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

---

## Guides

- **Full Nixpacks Guide**: `RAILWAY_DEPLOYMENT.md`
- **Full Docker Guide**: `RAILWAY_DOCKER_DEPLOYMENT.md`
- **Compare Options**: `DEPLOYMENT_OPTIONS.md`

---

## Support

- **Railway**: https://discord.gg/railway
- **Aztec**: https://discord.gg/aztec

Happy deploying! 🚀
