# AztecPay

Private payment links on Aztec. Create secure, anonymous payment links that anyone can claim—no signup required.

## What is AztecPay?

AztecPay lets you create private payment links using zero-knowledge proofs. Senders create links with a specified amount and optional message. Receivers claim funds by opening the link—no account registration needed.

All cryptographic operations happen in the browser. Private keys never leave the user's device.

## Features

- **Private payments** – Amounts and messages are hidden on-chain using ZK proofs
- **No signup** – Recipients don't need to register or provide personal info
- **Browser-native** – Wallet and proof generation run entirely in the browser
- **Payment links** – Share links through any channel (DMs, email, QR codes)
- **Fast claims** – Recipients get funds in ~30-60 seconds

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Sender    │────▶│  Generate ZK │────▶│  Share Link │
│  (Browser)  │     │   Proof      │     │  Anywhere   │
└─────────────┘     └──────────────┘     └─────────────┘
                                                   │
                                                   ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Receiver   │◀────│  Verify ZK   │◀────│  Open Link  │
│  (Browser)  │     │   Proof      │     │  in Browser │
└─────────────┘     └──────────────┘     └─────────────┘
```

1. **Create** – Sender enters amount and optional message, generates ZK proof (~1-2 min)
2. **Share** – Copy the unique claim link
3. **Claim** – Receiver opens link, proof is verified, funds transferred (~30-60 sec)

## Quick Start

### Prerequisites

- Node.js 22+
- Yarn or npm

### Local Development (Localnet)

```bash
# Install dependencies
yarn install

# Start Aztec sandbox
docker run -d --name aztec-sandbox -p 8080:8080 aztecprotocol/aztec-sandbox:3.0.0-devnet.20251212

# Start the backend server
yarn server

# In another terminal, start the frontend
yarn dev
```

Open http://localhost:3000

### Devnet (Public Testnet)

```bash
# Set environment
export AZTEC_ENV=devnet

# Deploy contracts (one-time)
yarn deploy:devnet

# Start services
yarn server:devnet
yarn dev:devnet
```

## Project Structure

```
├── app/                    # Frontend application
│   ├── index.html         # Main payment link creator
│   ├── claim.html         # Claim page for recipients
│   ├── main.ts            # Creator app logic
│   ├── claim.ts           # Claim page logic
│   ├── embedded-wallet.ts # Browser wallet implementation
│   └── style.css          # App styles
│
├── src/ts/                # Backend & scripts
│   ├── server.ts          # Express server (faucet, API)
│   ├── bridge.ts          # EVM bridge for cross-chain
│   ├── deploy-devnet.ts   # Devnet deployment script
│   └── config.ts          # Environment configuration
│
├── evm/                   # Solidity contracts (bridge)
└── contracts/             # Aztec contracts
```

## Scripts

| Command | Description |
|---------|-------------|
| `yarn dev` | Start dev server (localnet) |
| `yarn dev:devnet` | Start dev server (devnet) |
| `yarn server` | Start backend (localnet) |
| `yarn server:devnet` | Start backend (devnet) |
| `yarn deploy:devnet` | Deploy contracts to devnet |
| `yarn build` | Build for production |
| `yarn test` | Run tests |

## Deployment

See deployment guides:
- [`DEPLOYMENT.md`](DEPLOYMENT.md) – Local development and general deployment
- [`DEPLOYMENT_OPTIONS.md`](DEPLOYMENT_OPTIONS.md) – Railway deployment options
- [`RAILWAY_DEPLOYMENT.md`](RAILWAY_DEPLOYMENT.md) – Railway quickstart

## Architecture

### Browser-First Design

Unlike traditional dapps that rely on backend servers for transactions, AztecPay performs all cryptographic operations directly in the browser:

- **Account creation** – Generated locally with embedded wallet
- **ZK proof generation** – Happens in browser using WebAssembly
- **Transaction signing** – Private keys never leave the device
- **Server role** – Only handles faucet (test tokens) and optional bridging

### Zero-Knowledge Flow

```
Secret Data (in browser)          Public Data (on chain)
├── Amount                         ├── ZK Proof (validity)
├── Message                        ├── Nullifier (anti-double-spend)
├── Sender address                 └── Commitment (encrypted)
└── Proof key
```

The blockchain verifies the proof is valid without learning the secret details.

## Environment Configuration

Create a `.env` file:

```env
# Network: localnet or devnet
AZTEC_ENV=devnet

# Node URLs
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com

# For devnet (auto-set by deploy script)
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
TOKEN_ADDRESS=0x...
```

## Tech Stack

- **Frontend** – Vanilla TypeScript + Webpack
- **Wallet** – Custom EmbeddedWallet (runs in browser)
- **Contracts** – Aztec.nr (Aztec), Solidity (EVM bridge)
- **Network** – Aztec L2 (localnet or devnet)
- **Server** – Express.js (faucet only)

## License

MIT
