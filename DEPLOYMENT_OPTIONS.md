# AztecPay Deployment Options

This project supports multiple deployment methods on Railway:

## Option 1: Nixpacks (No Docker) - RECOMMENDED

**Best for**: Simple deployment, quick setup

See: `RAILWAY_DEPLOYMENT.md`

```bash
# Files:
- railway.toml
- nixpacks.toml
```

**Pros:**
- No Docker knowledge needed
- Faster builds
- Automatic Node.js setup
- Railway handles everything

**Cons:**
- Less control over environment
- Larger image size

---

## Option 2: Docker (Recommended for Production)

**Best for**: Production, reproducible builds, custom requirements

See: `RAILWAY_DOCKER_DEPLOYMENT.md`

```bash
# Files:
- Dockerfile.backend      # Backend + Frontend combined
- Dockerfile.frontend     # Frontend only (nginx)
- Dockerfile.railway      # Multi-stage options
- railway-docker-*.toml   # Railway configs
```

**Pros:**
- Reproducible builds
- Smaller production images
- Better caching
- Full control over environment
- Healthchecks included

**Cons:**
- Requires Docker knowledge
- Slightly more complex setup

---

## Quick Comparison

| Feature | Nixpacks | Docker |
|---------|----------|--------|
| Setup Complexity | Easy | Medium |
| Build Speed | Faster | Slower |
| Image Size | Larger | Smaller |
| Reproducibility | Good | Excellent |
| Customization | Limited | Full |
| Healthchecks | Manual | Built-in |
| Best For | Development | Production |

---

## Railway Dashboard Configuration

### Using Nixpacks (Default)

1. Create Service → GitHub Repo
2. Builder: `Nixpacks` (auto-selected)
3. Start Command: `npm run server:devnet`
4. Add environment variables
5. Deploy

### Using Docker

1. Create Service → GitHub Repo
2. Builder: `Dockerfile`
3. Dockerfile: `Dockerfile.backend`
4. Add environment variables
5. Deploy

---

## Required Environment Variables (Both Methods)

```env
# Core
AZTEC_ENV=devnet
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
PORT=3001
NODE_ENV=production

# EVM Bridge
EVM_PRIVATE_KEY=0x...
EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/...
EVM_TOKEN_ADDRESS=0x...

# Aztec Contracts
TOKEN_ADDRESS=0x...
MINTER_ADDRESS=0x...
MINTER_SECRET=0x...
MINTER_SALT=0x...
```

---

## Build Arguments (Docker Only)

For Docker frontend builds, set these build arguments:

```env
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
API_BASE_URL=https://your-backend.up.railway.app
AZTEC_ENV=devnet
```

---

## Recommended Setup

### For Development/Testing
→ Use **Nixpacks** (`RAILWAY_DEPLOYMENT.md`)

### For Production
→ Use **Docker** (`RAILWAY_DOCKER_DEPLOYMENT.md`)
- Better performance
- Smaller images
- Built-in healthchecks
- More reliable

---

## Files Created

### Nixpacks Deployment
```
railway.toml              # Backend config
railway.json              # Alternative config
nixpacks.toml             # Nixpacks settings
RAILWAY_DEPLOYMENT.md     # Full guide
RAILWAY_QUICKSTART.md     # Quick reference
```

### Docker Deployment
```
Dockerfile.backend              # Backend service
Dockerfile.frontend             # Frontend service
Dockerfile.railway              # Multi-stage options
railway-docker-backend.toml     # Backend config
railway-docker-frontend.toml    # Frontend config
RAILWAY_DOCKER_DEPLOYMENT.md    # Full guide
```

### Shared
```
DEPLOYMENT_OPTIONS.md           # This file
```

---

## Next Steps

1. Choose your deployment method (Nixpacks or Docker)
2. Follow the respective guide
3. Set environment variables in Railway
4. Deploy and test

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Aztec Docs: https://docs.aztec.network
- Aztec Discord: https://discord.gg/aztec
