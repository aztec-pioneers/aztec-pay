# Railway GLIBCXX_3.4.32 Fix - Platform Issue

## Problem

You're building on **Mac (ARM64/Apple Silicon)** but Railway runs on **Linux (AMD64/x86_64)**.

When Docker builds without explicit platform targeting, it defaults to the host architecture (ARM64 on Mac). This causes the `GLIBCXX_3.4.32` error because:

1. The ARM64 version of `bb.js` is built differently
2. Railway tries to run the ARM64 image on AMD64 hardware
3. The library versions don't match

## Solution

### 1. Updated Dockerfile.backend

The Dockerfile now includes:

```dockerfile
# Explicitly target AMD64 for Railway
FROM --platform=linux/amd64 node:22-bookworm

# Install latest libstdc++ from Debian testing (has GLIBCXX_3.4.32)
RUN echo "deb http://deb.debian.org/debian testing main" >> /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends -t testing libstdc++6
```

### 2. Deploy to Railway (Let Railway Build It)

**DO NOT build locally and push the image.**

Instead, let Railway build the image from your Dockerfile:

```bash
# Push code to GitHub
git add Dockerfile.backend .dockerignore
git commit -m "Fix: Explicit AMD64 platform for Railway"
git push
```

Then in Railway:
1. Railway will automatically build using `linux/amd64` (the `--platform` directive handles this)
2. Railway's native AMD64 environment will build the correct image

### 3. Force Clean Build on Railway

If Railway has cached layers, force a clean build:

**Option A: Add a comment to Dockerfile**
```dockerfile
# Build trigger: 2026-02-04-01 (change this timestamp to invalidate cache)
```

**Option B: Use Railway CLI to redeploy**
```bash
railway up --service aztec-pay-backend
```

**Option C: Manually trigger redeploy**
- Railway Dashboard → Your Service → Deployments
- Click "Redeploy" on the latest deployment
- Or click "Deploy" to create a new deployment

## Local Testing (Optional)

If you want to test the AMD64 build locally, it will be slow (emulation):

```bash
# Build for AMD64 on Mac (slow due to QEMU emulation)
docker build --platform linux/amd64 -f Dockerfile.backend -t aztec-pay-railway .

# Run
docker run --platform linux/amd64 -p 3001:3001 --env-file .env aztec-pay-railway
```

**Note**: This will take 5-10x longer than normal due to architecture emulation.

## Key Changes Made

| File | Change |
|------|--------|
| `Dockerfile.backend` | Added `--platform=linux/amd64` and Debian testing repo for latest libstdc++ |
| `.dockerignore` | Added to prevent cache pollution |

## Why This Happens

```
┌─────────────────┐     ┌──────────────────┐
│   Your Mac      │     │   Railway        │
│   (ARM64)       │ ──► │   (AMD64)        │
│                 │     │                  │
│  Docker builds  │     │  Docker tries    │
│  ARM64 image    │     │  to run ARM64    │
│                 │     │  on AMD64 CPU    │
└─────────────────┘     └──────────────────┘
         │                       │
         └────── MISMATCH! ──────┘
```

With `--platform=linux/amd64`:
```
┌─────────────────┐     ┌──────────────────┐
│   Your Mac      │     │   Railway        │
│   (ARM64)       │ ──► │   (AMD64)        │
│                 │     │                  │
│  Docker builds  │     │  Docker runs     │
│  AMD64 image    │     │  AMD64 natively  │
│  (slow/emulated)│     │  (fast/native)   │
└─────────────────┘     └──────────────────┘
```

## Verification

After deploying to Railway, check the logs for:

✅ **Good sign**:
```
[Server] Connecting to Aztec at https://devnet-6.aztec-labs.com...
[Server] Setting up wallet...
[Server] Wallet initialized
```

❌ **Bad sign** (if still seeing):
```
GLIBCXX_3.4.32' not found
```

If you still see the error, Railway might be using cached layers. Try adding a unique comment to the Dockerfile to force cache invalidation.
