# Local Testing Guide - Docker Backend

Test `Dockerfile.backend` locally before deploying to Railway.

## Prerequisites

- Docker Desktop installed and running
- Your `.env` file with all required variables

## Quick Start

### 1. Build the Docker Image

```bash
cd /Users/harshbajpai/Desktop/Projects/aztec-projects/aztec-pay

docker build -f Dockerfile.backend -t aztec-pay-local .
```

### 2. Run the Container

#### Option A: Using .env file (Recommended)
```bash
docker run -p 3001:3001 --env-file .env aztec-pay-local
```

#### Option B: Passing env vars individually
```bash
docker run -p 3001:3001 \
  -e AZTEC_ENV=devnet \
  -e AZTEC_NODE_URL=https://devnet-6.aztec-labs.com \
  -e SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e \
  -e PORT=3001 \
  -e NODE_ENV=production \
  -e EVM_PRIVATE_KEY=your_key \
  -e EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/your_key \
  -e EVM_TOKEN_ADDRESS=your_token \
  -e TOKEN_ADDRESS=your_aztec_token \
  -e MINTER_ADDRESS=your_minter \
  -e MINTER_SECRET=your_secret \
  -e MINTER_SALT=your_salt \
  aztec-pay-local
```

### 3. Test the Endpoints

```bash
# Healthcheck
curl http://localhost:3001/api/health

# Should return: {"status":"ok"}
```

### 4. Open in Browser

- Frontend: http://localhost:3001
- API: http://localhost:3001/api/health

---

## Helper Scripts

### Build Script
```bash
#!/bin/bash
# build-local.sh

echo "Building AztecPay Docker image..."
docker build -f Dockerfile.backend -t aztec-pay-local .

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo "Run with: docker run -p 3001:3001 --env-file .env aztec-pay-local"
else
    echo "❌ Build failed"
fi
```

### Run Script
```bash
#!/bin/bash
# run-local.sh

echo "Starting AztecPay container..."
docker run -p 3001:3001 --env-file .env --name aztec-pay-test aztec-pay-local
```

### Stop & Clean Script
```bash
#!/bin/bash
# stop-local.sh

echo "Stopping AztecPay container..."
docker stop aztec-pay-test
docker rm aztec-pay-test
echo "✅ Container stopped and removed"
```

---

## Common Commands

### Build with no cache (fresh build)
```bash
docker build --no-cache -f Dockerfile.backend -t aztec-pay-local .
```

### Run in background (detached mode)
```bash
docker run -d -p 3001:3001 --env-file .env --name aztec-pay-test aztec-pay-local
```

### View logs
```bash
docker logs -f aztec-pay-test
```

### Stop container
```bash
docker stop aztec-pay-test
```

### Remove container
```bash
docker rm aztec-pay-test
```

### Stop and remove in one command
```bash
docker stop aztec-pay-test && docker rm aztec-pay-test
```

### Rebuild and restart
```bash
docker stop aztec-pay-test && docker rm aztec-pay-test
docker build -f Dockerfile.backend -t aztec-pay-local .
docker run -d -p 3001:3001 --env-file .env --name aztec-pay-test aztec-pay-local
```

---

## Troubleshooting

### Issue: "Cannot find module 'tsx'"
**Solution**: Make sure you're using the Dockerfile.backend which installs all dependencies
```bash
docker build --no-cache -f Dockerfile.backend -t aztec-pay-local .
```

### Issue: Port already in use
**Solution**: Kill existing container or use different port
```bash
# Find process using port 3001
lsof -ti:3001 | xargs kill -9

# Or use different port
docker run -p 3002:3001 --env-file .env aztec-pay-local
```

### Issue: .env file not found
**Solution**: Check file path and permissions
```bash
ls -la .env
pwd  # Make sure you're in the project root
```

### Issue: Build takes too long
**Solution**: This is normal - it needs to install all node_modules and build the frontend. Subsequent builds will be faster due to Docker layer caching.

### Issue: "AZTEC_ENV is not set"
**Solution**: Ensure your .env file has `AZTEC_ENV=devnet`
```bash
cat .env | grep AZTEC_ENV
```

---

## Verify the Deployment

After starting the container:

1. **Check health endpoint**:
   ```bash
   curl http://localhost:3001/api/health
   ```

2. **Open browser**:
   - http://localhost:3001 - Should see AztecPay frontend

3. **Test full flow**:
   - Generate payment link
   - Open claim page
   - Complete claim process

---

## Docker Image Size

```bash
# Check image size
docker images | grep aztec-pay-local

# Expected: ~500MB-1GB (includes node_modules and built frontend)
```

---

## Next Steps

Once local testing passes:
1. Push code to GitHub
2. Deploy to Railway using `Dockerfile.backend`
3. Set same environment variables in Railway dashboard
