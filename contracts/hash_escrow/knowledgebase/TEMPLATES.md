# Aztec Web Development Templates

Complete, copy-paste ready templates for Aztec web development.

## Table of Contents

1. [Project Structure](#project-structure)
2. [Configuration Files](#configuration-files)
3. [Noir Contract Template](#noir-contract-template)
4. [Web Application Template](#web-application-template)
5. [Deployment Script Template](#deployment-script-template)

---

## Project Structure

```
aztec-project/
├── package.json
├── tsconfig.json
├── nargo.toml
├── src/
│   └── main.nr              # Noir contract source
├── target/
│   └── contract-Contract.json   # Compiled contract (generated)
├── artifacts/
│   └── Contract.ts          # TypeScript bindings (generated)
└── web/
    ├── index.html
    ├── app.ts
    ├── webpack.config.cjs
    └── tsconfig.json
```

---

## Configuration Files

### package.json

```json
{
  "name": "aztec-web-project",
  "version": "1.0.0",
  "description": "Aztec web application",
  "type": "module",
  "scripts": {
    "compile": "aztec compile",
    "codegen": "aztec codegen ./target/contract-Contract.json -o ./artifacts",
    "deploy": "tsx deploy.ts",
    "web:dev": "cd web && webpack serve --config webpack.config.cjs",
    "web:build": "cd web && webpack --mode=production --config webpack.config.cjs"
  },
  "dependencies": {
    "@aztec/aztec.js": "3.0.0-devnet.6-patch.1",
    "@aztec/test-wallet": "3.0.0-devnet.6-patch.1",
    "@aztec/l1-artifacts": "3.0.0-devnet.6-patch.1",
    "@aztec/noir-contracts.js": "3.0.0-devnet.6-patch.1",
    "buffer": "^6.0.3",
    "crypto-browserify": "^3.12.0",
    "os-browserify": "^0.3.0",
    "path-browserify": "^1.0.1",
    "process": "^0.11.10",
    "stream-browserify": "^3.0.0",
    "util": "^0.12.5",
    "assert": "^2.1.0",
    "tty-browserify": "^0.0.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.58.1",
    "html-webpack-plugin": "^5.6.0",
    "ts-loader": "^9.5.1",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4",
    "webpack-dev-server": "^4.15.1"
  }
}
```

### tsconfig.json (Root)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist", "web"]
}
```

### web/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": false,
    "allowSyntheticDefaultImports": true,
    "declaration": false,
    "declarationMap": false,
    "sourceMap": true,
    "outDir": "../dist",
    "rootDir": ".",
    "baseUrl": "."
  },
  "include": ["./**/*.ts", "../artifacts/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### web/webpack.config.cjs

```javascript
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  mode: 'development',
  entry: './app.ts',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, '../dist'),
    clean: true,
    publicPath: '/',
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            compilerOptions: {
              module: 'esnext',
              moduleResolution: 'node',
            },
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.mjs'],
    fallback: {
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify'),
      crypto: require.resolve('crypto-browserify'),
      util: require.resolve('util/'),
      process: require.resolve('process/browser.js'),
      path: require.resolve('path-browserify'),
      os: require.resolve('os-browserify/browser'),
      assert: require.resolve('assert/'),
      tty: require.resolve('tty-browserify'),
      fs: false,
      net: false,
      tls: false,
      child_process: false,
    },
    alias: {
      '@': path.resolve(__dirname, '../src'),
      'process/browser': require.resolve('process/browser.js'),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser.js',
    }),
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({}),
    }),
  ],
  experiments: {
    asyncWebAssembly: true,
  },
  devServer: {
    static: {
      directory: path.join(__dirname, '../dist'),
    },
    compress: true,
    port: 3000,
    open: true,
    hot: true,
    historyApiFallback: true,
  },
  stats: {
    errorDetails: true,
  },
};
```

### nargo.toml

```toml
[package]
name = "my_contract"
version = "0.1.0"
type = "contract"

[dependencies]
aztec = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "v3.0.0-devnet.6-patch.1", directory = "noir-projects/aztec-nr/aztec" }
```

---

## Noir Contract Template

### src/main.nr (Counter Contract)

```rust
use dep::aztec::macros::aztec;

#[aztec]
pub contract Counter {
    use aztec::{
        macros::{functions::{external, initializer, only_self}, storage::storage},
        state_vars::PublicMutable,
        hash::compute_secret_hash,
    };

    #[storage]
    struct Storage<Context> {
        count: PublicMutable<u32, Context>,
        secret_hash: PublicMutable<Field, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor() {
        self.storage.count.write(0);
        let secret_hash = compute_secret_hash(42);
        self.storage.secret_hash.write(secret_hash);
    }

    #[external("public")]
    fn get_count() -> pub u32 {
        self.storage.count.read()
    }

    #[external("public")]
    fn get_secret_hash() -> pub Field {
        self.storage.secret_hash.read()
    }

    #[external("private")]
    fn increment_with_secret(secret: Field, expected_hash: Field) {
        let provided_hash = compute_secret_hash(secret);
        assert(provided_hash == expected_hash, "Invalid secret");
        self.enqueue_self._increment_public();
    }

    #[external("public")]
    #[only_self]
    fn _increment_public() {
        let current = self.storage.count.read();
        self.storage.count.write(current + 1);
    }
}
```

---

## Web Application Template

### web/index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aztec App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #fff;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      text-align: center;
      margin-bottom: 10px;
      background: linear-gradient(90deg, #00d4ff, #7b2cbf);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 14px 28px;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      width: 100%;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status {
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 12px;
      font-family: monospace;
    }
    .status.pending { background: rgba(255, 193, 7, 0.1); color: #ffc107; }
    .status.success { background: rgba(76, 175, 80, 0.1); color: #4caf50; }
    .status.error { background: rgba(244, 67, 54, 0.1); color: #f44336; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Aztec App</h1>
    
    <div id="setup-section" class="card">
      <div id="setup-status" class="status pending">Initializing...</div>
      <button id="deploy-btn" class="hidden">Deploy Contract</button>
    </div>
    
    <div id="contract-section" class="card hidden">
      <h3>Contract Info</h3>
      <p>Address: <span id="contract-address">-</span></p>
    </div>
  </div>
</body>
</html>
```

### web/app.ts (Complete Template)

```typescript
/**
 * Aztec Web Application Template
 * 
 * Browser-based Aztec application with devnet deployment.
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { CounterContract } from "../artifacts/Counter";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

// Configuration
const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

// State
let wallet: any = null;
let node: any = null;
let accountAddress: AztecAddress | null = null;
let contract: CounterContract | null = null;

// DOM Elements
let setupStatus: HTMLDivElement;
let deployBtn: HTMLButtonElement;
let contractSection: HTMLDivElement;
let contractAddressEl: HTMLSpanElement;

function initDomElements() {
  setupStatus = document.getElementById("setup-status") as HTMLDivElement;
  deployBtn = document.getElementById("deploy-btn") as HTMLButtonElement;
  contractSection = document.getElementById("contract-section") as HTMLDivElement;
  contractAddressEl = document.getElementById("contract-address") as HTMLSpanElement;
}

function updateStatus(message: string, state: "pending" | "success" | "error") {
  setupStatus.className = `status ${state}`;
  setupStatus.textContent = message;
}

// Initialize the app
async function init() {
  console.log("Initializing Aztec client...");
  
  try {
    // Create node client
    node = createAztecNodeClient(DEVNET_NODE_URL);
    console.log("Connected to devnet node");
    
    // Create wallet with proving enabled (dynamically import to handle WASM)
    console.log("Creating TestWallet...");
    const { TestWallet } = await import("@aztec/test-wallet/client/lazy");
    wallet = await TestWallet.create(node, { proverEnabled: true });
    console.log("Wallet created successfully");
    
    // Show deploy button
    setupStatus.classList.add("hidden");
    deployBtn.classList.remove("hidden");
    
  } catch (error: any) {
    console.error("Initialization failed:", error);
    updateStatus(`Failed: ${error.message}`, "error");
  }
}

// Deploy contract
async function deployContract() {
  if (!wallet) return;
  
  deployBtn.disabled = true;
  deployBtn.textContent = "Deploying...";
  setupStatus.classList.remove("hidden");
  updateStatus("Creating account and deploying contract...", "pending");
  
  try {
    // Create account
    console.log("Creating Schnorr account...");
    const secretKey = Fr.random();
    const salt = Fr.random();
    const signingKey = GrumpkinScalar.random();
    
    const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);
    accountAddress = accountManager.address;
    console.log("Account created:", accountAddress.toString());
    
    // Register SponsoredFPC
    console.log("Registering SponsoredFPC...");
    const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
    
    if (!sponsoredFpcInstance) {
      throw new Error("SponsoredFPC not found");
    }
    
    await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
    console.log("SponsoredFPC registered");
    
    const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
    
    // Deploy account
    console.log("Deploying account (this may take 1-2 minutes)...");
    const deployAccountMethod = await accountManager.getDeployMethod();
    await deployAccountMethod
      .send({ from: AztecAddress.ZERO, fee: { paymentMethod: sponsoredPaymentMethod } })
      .wait();
    console.log("Account deployed");
    
    // Deploy contract
    console.log("Deploying contract (this may take 1-2 minutes)...");
    contract = await CounterContract.deploy(wallet)
      .send({
        from: accountAddress,
        fee: { paymentMethod: sponsoredPaymentMethod },
      })
      .deployed();
    
    console.log("Contract deployed:", contract.address.toString());
    
    // Update UI
    contractAddressEl.textContent = contract.address.toString();
    contractSection.classList.remove("hidden");
    setupStatus.classList.add("hidden");
    
  } catch (error: any) {
    console.error("Deployment failed:", error);
    updateStatus(`Failed: ${error.message}`, "error");
    deployBtn.disabled = false;
    deployBtn.textContent = "Deploy Contract";
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  initDomElements();
  deployBtn.addEventListener("click", deployContract);
  init();
});
```

---

## Deployment Script Template

### deploy.ts (Node.js/CLI Deployment)

```typescript
#!/usr/bin/env node
/**
 * Aztec Contract Deployment Script
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { CounterContract } from "./artifacts/Counter.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

async function main() {
  console.log("🚀 Aztec Contract Deployment");
  console.log("=" .repeat(60));

  // Connect to devnet node
  console.log(`\n📡 Connecting to devnet at ${DEVNET_NODE_URL}...`);
  const node = createAztecNodeClient(DEVNET_NODE_URL);
  
  // Create a test wallet
  console.log("\n👤 Creating new Schnorr account...");
  const wallet = await TestWallet.create(node, { proverEnabled: true });
  
  // Create account credentials
  const secretKey = Fr.random();
  const salt = Fr.random();
  const signingKey = GrumpkinScalar.random();
  
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);
  const accountAddress = accountManager.address;
  console.log(`   Account address: ${accountAddress}`);

  // Get sponsored FPC address and register it
  const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  console.log("\n💰 Fetching and registering SponsoredFPC contract...");
  
  const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
  if (!sponsoredFpcInstance) {
    throw new Error(`SponsoredFPC contract not found at ${sponsoredFpcAddress}`);
  }
  
  await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
  console.log("   SponsoredFPC contract registered");
  
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);

  // Deploy the account contract
  console.log("\n🔑 Deploying account...");
  console.log("   (This may take a few minutes for proving on first run)");
  
  const deployAccountMethod = await accountManager.getDeployMethod();
  const accountTx = await deployAccountMethod
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: sponsoredPaymentMethod } })
    .wait();
  console.log(`   Account deployed in block ${accountTx.blockNumber}`);

  // Deploy the contract
  console.log("\n📦 Deploying contract...");
  
  try {
    const deployTx = CounterContract.deploy(wallet)
      .send({
        from: accountAddress,
        fee: { paymentMethod: sponsoredPaymentMethod },
      });

    const txHash = await deployTx.getTxHash();
    console.log(`\n⏳ Deployment transaction sent: ${txHash}`);
    console.log("   Waiting for transaction to be mined...");

    const contract = await deployTx.deployed();
    
    console.log("\n✅ Contract deployed successfully!");
    console.log("=".repeat(60));
    console.log(`📍 Contract Address: ${contract.address}`);
    console.log(`🔗 View on Explorer: https://aztecscan.xyz/address/${contract.address}`);
    console.log("=".repeat(60));
    
  } catch (error: any) {
    if (error.message?.includes("Timeout awaiting isMined")) {
      console.log("\n⏱️  Transaction is still being mined (this is normal on devnet).");
      console.log("   Check the explorer in a few minutes for the deployment status.");
    } else {
      console.error("\n❌ Deployment failed:", error.message || error);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

---

## Build & Run Commands

### Initial Setup

```bash
# 1. Create project directory
mkdir my-aztec-project && cd my-aztec-project

# 2. Initialize npm
npm init -y

# 3. Install dependencies
npm install @aztec/aztec.js@3.0.0-devnet.6-patch.1 \
  @aztec/test-wallet@3.0.0-devnet.6-patch.1 \
  @aztec/l1-artifacts@3.0.0-devnet.6-patch.1 \
  @aztec/noir-contracts.js@3.0.0-devnet.6-patch.1 \
  buffer crypto-browserify os-browserify path-browserify \
  process stream-browserify util assert tty-browserify

# 4. Install dev dependencies
npm install -D typescript ts-loader webpack webpack-cli \
  webpack-dev-server html-webpack-plugin tsx @playwright/test
```

### Development Workflow

```bash
# Compile Noir contract
aztec compile

# Generate TypeScript bindings
npm run codegen

# Run deployment script
npm run deploy

# Start web dev server
npm run web:dev

# Build for production
npm run web:build
```

---

*Last updated: 2026-02-16*
*Devnet version: 3.0.0-devnet.6-patch.1*
