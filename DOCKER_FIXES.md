# Docker Build Fixes Applied

## Summary

Successfully fixed Dockerfiles to build and run on Railway (and locally) using `node:22-bookworm` base image.

## Key Changes

### 1. Base Image: `node:22-bookworm` (Debian 12)

**Why**: Railway and modern Linux systems require GLIBCXX_3.4.32 which is not available in older Debian/Ubuntu versions.

```dockerfile
# BEFORE (doesn't work on Railway)
FROM node:22-alpine
# Error: pthread_cond_clockwait: symbol not found

FROM node:22-slim  
# Error: GLIBCXX_3.4.32 not found

# AFTER (works!)
FROM node:22-bookworm
# Debian 12 has GLIBCXX_3.4.32
```

### 2. Fixed Husky Error

**Problem**: `@defi-wonderland/aztec-standards` package runs husky in postinstall, which fails in Docker.

**Fix**:
```dockerfile
# Skip postinstall scripts
RUN npm install --ignore-scripts
```

### 3. Added Aztec Standards Artifacts

**Problem**: Since postinstall was skipped, the artifacts weren't built.

**Fix**:
```dockerfile
# Copy pre-built artifacts
COPY docker-assets/aztec-standards-artifacts ./node_modules/@defi-wonderland/aztec-standards/artifacts
COPY docker-assets/aztec-standards-target ./node_modules/@defi-wonderland/aztec-standards/target
```

### 4. GPG Key Workaround (Optional)

**Problem**: Some environments have GPG key issues with apt-get update.

**Fix**:
```dockerfile
# Make apt-get update optional
RUN apt-get update && apt-get install -y git curl || true
```

## Working Dockerfile.backend

```dockerfile
# Railway Backend Service Dockerfile (Devnet)
FROM node:22-bookworm

# Install required packages (git/curl should already be present)
RUN apt-get update && apt-get install -y git curl || true

WORKDIR /app

# Copy package files first (for better caching)
COPY package.json yarn.lock* package-lock.json* ./

# Install dependencies (ignore postinstall scripts to prevent husky errors)
RUN npm install --ignore-scripts

# Copy aztec-standards artifacts (required because postinstall was skipped)
COPY docker-assets/aztec-standards-artifacts ./node_modules/@defi-wonderland/aztec-standards/artifacts
COPY docker-assets/aztec-standards-target ./node_modules/@defi-wonderland/aztec-standards/target

# Copy source code
COPY . .

# Build frontend
ARG AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
ARG API_BASE_URL=
ARG AZTEC_ENV=devnet

ENV AZTEC_ENV=${AZTEC_ENV}
ENV AZTEC_NODE_URL=${AZTEC_NODE_URL}
ENV API_BASE_URL=${API_BASE_URL}
ENV NODE_ENV=production

RUN npm run build:devnet

# Expose port
EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3001}/api/health || exit 1

ENV PORT=3001

# Start command
CMD ["npm", "run", "server:devnet"]
```

## Local Testing Commands

```bash
# Build
docker build -f Dockerfile.backend -t aztec-pay-local .

# Run
docker run -d -p 3001:3001 --env-file .env --name aztec-pay-test aztec-pay-local

# Test healthcheck
curl http://localhost:3001/api/health

# View logs
docker logs -f aztec-pay-test

# Stop & clean
docker stop aztec-pay-test && docker rm aztec-pay-test
```

## Railway Deployment

### Environment Variables Required
```env
AZTEC_ENV=devnet
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
PORT=3001
NODE_ENV=production
EVM_PRIVATE_KEY=0x...
EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/...
EVM_TOKEN_ADDRESS=0x...
TOKEN_ADDRESS=0x...
MINTER_ADDRESS=0x...
MINTER_SECRET=0x...
MINTER_SALT=0x...
```

### Build Settings
| Setting | Value |
|---------|-------|
| Builder | `Dockerfile` |
| Dockerfile | `Dockerfile.backend` |

## Files Updated

- `Dockerfile.backend` - Backend + frontend combined ✅
- `Dockerfile.frontend` - Frontend only ✅  
- `Dockerfile.railway` - Multi-stage options ✅

## Railway-Specific Notes

1. **GLIBCXX_3.4.32**: Railway's build environment requires this version, which is provided by `node:22-bookworm` (Debian 12)

2. **Healthcheck**: The Dockerfile includes a healthcheck that Railway uses to verify the service is running

3. **Port**: Must be `3001` (set via `PORT` env var)

4. **Start Command**: `npm run server:devnet` (already in Dockerfile)

## Testing Results

✅ Builds successfully locally
✅ Runs successfully locally  
✅ Healthcheck passes
✅ Server initializes and connects to Aztec devnet
✅ Bridge functionality works
