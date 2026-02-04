# AztecPay Deployment Guide

This guide covers deploying and running AztecPay on both **localnet** (Aztec sandbox) and **devnet** (Aztec public testnet).

## Quick Reference

| Environment | AZTEC_ENV | Node URL | Fees | Proving |
|-------------|-----------|----------|------|---------|
| Localnet | `localnet` | `http://localhost:8080` | Free | Disabled |
| Devnet | `devnet` | `https://devnet-6.aztec-labs.com` | Sponsored | Enabled |

## Environment Configuration

The application uses environment variables to determine which network to connect to. Set `AZTEC_ENV` to switch between networks:

```bash
# For localnet (default)
AZTEC_ENV=localnet

# For devnet
AZTEC_ENV=devnet
```

### Configuration Files

**`.env`** - Main configuration file:
```env
# Set the environment: localnet or devnet
AZTEC_ENV=localnet

# Node URL (optional - defaults shown above)
AZTEC_NODE_URL=http://localhost:8080

# For devnet, also set:
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
```

**`deployment.json`** - Auto-generated after deployment:
```json
{
  "environment": "devnet",
  "tokenAddress": "0x...",
  "deployerAddress": "0x...",
  "nodeUrl": "https://devnet-6.aztec-labs.com"
}
```

## Localnet Development

### Prerequisites

- Docker Desktop installed and running
- Aztec CLI: `yarn global add @aztec/aztec-cli` (optional)

### Start Localnet

```bash
# Start Aztec sandbox
docker run -d --name aztec-sandbox -p 8080:8080 aztecprotocol/aztec-sandbox:3.0.0-devnet.20251212

# Or use the Aztec CLI
aztec start --sandbox
```

### Deploy to Localnet

```bash
# 1. Ensure .env has AZTEC_ENV=localnet

# 2. Deploy contracts (auto-deployed when server starts)
yarn server

# 3. In another terminal, start the frontend
yarn dev
```

## Devnet Deployment

### Prerequisites

- No local Aztec node needed - connects to public devnet
- Internet connection for downloading proving keys (~67MB on first run)

### Deploy to Devnet

```bash
# 1. Set environment to devnet
export AZTEC_ENV=devnet

# Or update your .env file:
# AZTEC_ENV=devnet
# AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
# SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e

# 2. Deploy the token contract to devnet
yarn deploy:devnet

# This will:
# - Create a devnet account
# - Deploy the account contract
# - Deploy the USDC token contract
# - Mint 1000 USDC to the deployer
# - Save deployment info to deployment.json and .env

# 3. Start the server (uses deployed token)
yarn server:devnet

# 4. In another terminal, start the frontend
yarn dev:devnet
```

### Devnet Deployment Script

The `yarn deploy:devnet` command runs `src/ts/deploy-devnet.ts` which:

1. Connects to the Aztec devnet node
2. Creates a Schnorr account with random credentials
3. Registers the SponsoredFPC contract for fee payment
4. Deploys the account contract (using sponsored fees)
5. Deploys the TokenContract with the deployer as minter
6. Mints 1000 USDC to the deployer for testing
7. Saves all deployment info to `deployment.json` and updates `.env`

**⚠️ Important:** Save your `deployment.json` file - it contains the deployer credentials needed to access the minted tokens.

## Available Scripts

| Script | Description |
|--------|-------------|
| `yarn dev` | Start dev server (localnet) |
| `yarn dev:devnet` | Start dev server (devnet) |
| `yarn server` | Start backend server (localnet) |
| `yarn server:devnet` | Start backend server (devnet) |
| `yarn deploy:devnet` | Deploy contracts to devnet |
| `yarn build` | Build for production (localnet) |
| `yarn build:devnet` | Build for production (devnet) |

## Architecture

### Browser-Side (PXE)

Both the main app (`App.svelte`) and claim page (`claim.ts`) create a PXE (Private Execution Environment) directly in the browser:

```typescript
// Localnet - proving disabled, fast
const wallet = await TestWallet.create(node, { proverEnabled: false });

// Devnet - proving enabled, sponsored fees
const wallet = await TestWallet.create(node, { proverEnabled: true });
// Transactions use SponsoredFeePaymentMethod for gasless transactions
```

### Server-Side

The server handles:
- **Faucet**: Minting tokens to user addresses
- **Bridge**: Monitoring for Aztec deposits and minting on EVM

On devnet, the server uses the deployed token address from `deployment.json` instead of deploying a new one.

## Troubleshooting

### Devnet Issues

**Problem**: "SponsoredFPC contract not found"
- Check that `SPONSORED_FPC_ADDRESS` is set correctly
- Verify devnet is online: `curl https://devnet-6.aztec-labs.com`

**Problem**: "Timeout awaiting isMined"
- Normal on devnet - transactions take 2-3 minutes
- Check explorer: https://aztecscan.xyz

**Problem**: Proving is very slow
- First run downloads ~67MB of proving keys
- Subsequent runs are faster
- This is expected behavior for devnet

**Problem**: "Account not found" or "Invalid nullifier"
- Accounts must be deployed before use on devnet
- The deployment script handles this automatically

### Localnet Issues

**Problem**: "Cannot connect to node"
- Ensure Aztec sandbox is running: `docker ps`
- Check port 8080 is not in use

**Problem**: "SharedArrayBuffer is not defined"
- Webpack devServer headers are configured correctly
- Try clearing browser cache

## Network Details

### Devnet (3.0.0-devnet.6-patch)

- **Node URL**: `https://devnet-6.aztec-labs.com`
- **Explorer**: https://aztecscan.xyz
- **Sponsored FPC**: `0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e`
- **Proving**: Required
- **Fees**: Sponsored (free for users)

### Localnet (Sandbox)

- **Node URL**: `http://localhost:8080`
- **Explorer**: None (use logs)
- **Proving**: Optional (disabled for speed)
- **Fees**: None

## Code Structure

### Configuration (`src/ts/config.ts`)

Centralized configuration that detects the environment:

```typescript
export const IS_DEVNET = AZTEC_ENV === 'devnet';
export const AZTEC_NODE_URL = IS_DEVNET 
  ? 'https://devnet-6.aztec-labs.com' 
  : 'http://localhost:8080';
```

### Environment-Specific Behavior

**Localnet:**
- Proving disabled for fast iteration
- No fees required
- New contracts deployed on each server start

**Devnet:**
- Proving enabled for valid proofs
- Sponsored fees via SponsoredFPC
- Uses existing deployed contracts from `deployment.json`
- All accounts must be deployed before use
