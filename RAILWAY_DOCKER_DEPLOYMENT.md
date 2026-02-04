# Railway Docker Deployment Guide for AztecPay (Devnet)

This guide covers deploying AztecPay on [Railway](https://railway.app) using **Docker** with devnet configuration.

## Overview

This deployment uses **two separate Dockerfiles**:
- `Dockerfile.backend` - Node.js backend API + static frontend files
- `Dockerfile.frontend` - Nginx serving static frontend (alternative)

## Quick Start

### Option 1: Backend-Only (Recommended)
Single service that runs the backend API and serves the frontend:

```bash
# In Railway dashboard, set:
# - Builder: Dockerfile
# - Dockerfile: Dockerfile.backend
```

### Option 2: Separate Services
Two services: backend API + frontend static site:

```bash
# Service 1 (Backend):
# - Builder: Dockerfile
# - Dockerfile: Dockerfile.backend

# Service 2 (Frontend):
# - Builder: Dockerfile
# - Dockerfile: Dockerfile.frontend
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Railway Project                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Backend Service (Docker)                 │   │
│  │  ┌──────────────┐         ┌──────────────────────┐   │   │
│  │  │  Node.js API │────────▶│  Aztec Devnet Node   │   │   │
│  │  │  Port: 3001  │         │  (External)          │   │   │
│  │  └──────────────┘         └──────────────────────┘   │   │
│  │         │                                            │   │
│  │         ▼                                            │   │
│  │  ┌──────────────┐                                    │   │
│  │  │Static Frontend│  (Built into container)           │   │
│  │  │  (/dist)     │                                    │   │
│  │  └──────────────┘                                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│              ┌──────────────────────┐                       │
│              │   Base Sepolia       │                       │
│              │   (EVM Bridge)       │                       │
│              └──────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Service 1: Backend (Dockerfile.backend)

### Step 1: Create Service

1. In Railway dashboard: **New** → **Service** → **GitHub Repo**
2. Select your AztecPay repository
3. Name: `aztec-pay-backend`

### Step 2: Configure Docker Build

| Setting | Value |
|---------|-------|
| **Builder** | `Dockerfile` |
| **Dockerfile** | `Dockerfile.backend` |
| **Root Directory** | `/` |

Or use the config file:
```bash
# Rename to railway.toml or use in service settings
cp railway-docker-backend.toml railway.toml
```

### Step 3: Build Arguments (Optional)

These are baked into the frontend at build time:

| Build Arg | Default | Description |
|-----------|---------|-------------|
| `AZTEC_NODE_URL` | `https://devnet-6.aztec-labs.com` | Aztec devnet node |
| `API_BASE_URL` | (empty) | Backend API URL (empty = same origin) |
| `AZTEC_ENV` | `devnet` | Environment |

> **Note**: For single-service deployment, leave `API_BASE_URL` empty so frontend uses relative URLs.

### Step 4: Environment Variables

Add these in Railway dashboard (**Variables** tab):

```env
# Core Configuration
AZTEC_ENV=devnet
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
PORT=3001
NODE_ENV=production

# EVM Bridge (Base Sepolia)
EVM_PRIVATE_KEY=0x...
EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
EVM_TOKEN_ADDRESS=0x...

# Aztec Contracts (from deployment.json)
TOKEN_ADDRESS=0x...
MINTER_ADDRESS=0x...
MINTER_SECRET=0x...
MINTER_SALT=0x...
```

### Step 5: Deploy

1. Click **Deploy**
2. Wait for healthcheck to pass (`/api/health`)
3. Copy the public domain (e.g., `https://aztec-pay-backend.up.railway.app`)
4. **Done!** This URL serves both API and frontend.

---

## Service 2: Frontend Only (Optional)

If you want separate frontend service (e.g., for custom domain):

### Step 1: Create Service

1. **New** → **Service** → **GitHub Repo**
2. Name: `aztec-pay-frontend`

### Step 2: Configure Docker Build

| Setting | Value |
|---------|-------|
| **Builder** | `Dockerfile` |
| **Dockerfile** | `Dockerfile.frontend` |

### Step 3: Build Arguments (Required)

| Build Arg | Value | Description |
|-----------|-------|-------------|
| `API_BASE_URL` | `https://your-backend.up.railway.app` | Full backend URL |

### Step 4: Environment Variables

```env
# No runtime env vars needed for static frontend
# All config baked at build time
```

### Step 5: Deploy

1. Deploy service
2. Visit frontend URL

---

## Configuration Files

### `Dockerfile.backend`
```dockerfile
FROM node:22-alpine
RUN apk add --no-cache git curl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG AZTEC_ENV=devnet
ENV AZTEC_ENV=${AZTEC_ENV}
RUN npm run build:devnet
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1
ENV PORT=3001
CMD ["npm", "run", "server:devnet"]
```

### `Dockerfile.frontend`
```dockerfile
FROM node:22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG API_BASE_URL
ENV API_BASE_URL=${API_BASE_URL}
RUN npm run build:devnet
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
```

---

## Environment Variables Reference

### Backend Service

| Variable | Required | Description |
|----------|----------|-------------|
| `AZTEC_ENV` | ✅ | Must be `devnet` |
| `AZTEC_NODE_URL` | ✅ | `https://devnet-6.aztec-labs.com` |
| `SPONSORED_FPC_ADDRESS` | ✅ | Devnet sponsored FPC |
| `PORT` | ✅ | Must be `3001` |
| `NODE_ENV` | ✅ | `production` |
| `EVM_PRIVATE_KEY` | ✅ | Base Sepolia private key |
| `EVM_RPC_URL` | ✅ | Base Sepolia RPC URL |
| `EVM_TOKEN_ADDRESS` | ✅ | EVM token contract |
| `TOKEN_ADDRESS` | ✅ | Aztec token address |
| `MINTER_ADDRESS` | ✅ | Minter account address |
| `MINTER_SECRET` | ✅ | Minter secret key |
| `MINTER_SALT` | ✅ | Minter salt |

### Frontend Build Arguments

| Build Arg | Required | Description |
|-----------|----------|-------------|
| `API_BASE_URL` | ⚪ | Backend URL (empty for same-origin) |
| `AZTEC_NODE_URL` | ⚪ | Aztec node URL |
| `AZTEC_ENV` | ⚪ | `devnet` |

---

## Deployment Steps

### Method 1: Railway Dashboard (Recommended)

1. **Push code to GitHub**
   ```bash
   git add Dockerfile.backend Dockerfile.frontend railway-docker-*.toml
   git commit -m "Add Railway Docker config"
   git push
   ```

2. **Create Backend Service**
   - New Service → GitHub Repo
   - Builder: Dockerfile
   - Dockerfile: `Dockerfile.backend`
   - Add all environment variables
   - Deploy

3. **Copy Backend Domain**
   - Wait for deployment
   - Go to Settings → Networking
   - Copy public domain (e.g., `https://aztec-pay-backend.up.railway.app`)

4. **Test**
   - Visit `https://your-domain.up.railway.app`
   - Should see the AztecPay app

### Method 2: Using Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link project
railway link

# Deploy backend
railway up --service aztec-pay-backend

# Deploy frontend (if separate)
railway up --service aztec-pay-frontend
```

---

## Health Checks

The Dockerfiles include healthchecks that Railway uses:

### Backend
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1
```

Expected response: `{"status": "ok"}`

### Frontend
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:5173/ || exit 1
```

---

## Troubleshooting

### Issue: Build fails with "node-gyp" errors
**Solution**: The Dockerfile uses `node:22-alpine` which should work. If issues persist, switch to `node:22-slim`:
```dockerfile
FROM node:22-slim
```

### Issue: "AZTEC_ENV is not set"
**Solution**: Make sure `AZTEC_ENV=devnet` is set in Railway environment variables (not just build args).

### Issue: Frontend can't connect to backend
**Solution**: 
- For single-service: Ensure `API_BASE_URL` is empty or not set
- For separate services: Set `API_BASE_URL` to full backend URL with `https://`

### Issue: "Out of memory" during build
**Solution**: Railway's default builder may need more memory. Add a `.railwayignore` file:
```
node_modules
.git
dist
```

Or upgrade to higher tier in Railway.

### Issue: Healthcheck fails
**Solution**: 
1. Check logs in Railway dashboard
2. Verify `PORT` env var is set to `3001`
3. Ensure all required env vars are set
4. Check that contracts are deployed to devnet

---

## Updating Deployment

### Update Backend
```bash
# Push changes to GitHub
git push

# Railway auto-deploys
```

### Update Frontend Only
If using separate services:
1. Update code
2. Push to GitHub
3. Railway auto-rebuilds and deploys

---

## Monitoring

### View Logs
```bash
# Via Railway CLI
railway logs --service aztec-pay-backend

# Or in Railway dashboard → Deployments → Logs
```

### Metrics
Railway provides CPU, memory, and network metrics in the dashboard.

---

## Security Considerations

1. **Private Keys**: Stored in Railway encrypted environment variables
2. **HTTPS**: Railway provides automatic HTTPS for all domains
3. **CORS**: Backend allows all origins in devnet mode
4. **Secrets**: Never commit `.env` or private keys to GitHub

---

## Cost Optimization

| Resource | Tier | Est. Cost |
|----------|------|-----------|
| Backend | 512MB RAM, 1 CPU | ~$5-10/month |
| Frontend | 256MB RAM | ~$2-5/month |
| **Total** | | **~$7-15/month** |

Tips:
- Use single-service deployment to save costs
- Railway's free tier includes $5 credit monthly
- CPU usage spikes during ZK proof generation

---

## Files Reference

| File | Purpose |
|------|---------|
| `Dockerfile.backend` | Backend + frontend combined |
| `Dockerfile.frontend` | Frontend only (nginx) |
| `Dockerfile.railway` | Multi-stage options |
| `railway-docker-backend.toml` | Railway config for backend |
| `railway-docker-frontend.toml` | Railway config for frontend |
| `RAILWAY_DOCKER_DEPLOYMENT.md` | This guide |

---

## Next Steps

1. Deploy to Railway using this guide
2. Test payment link generation
3. Test claiming flow
4. Set up custom domain (optional)
5. Configure monitoring/alerts (optional)

For support:
- Railway: https://discord.gg/railway
- Aztec: https://discord.gg/aztec
