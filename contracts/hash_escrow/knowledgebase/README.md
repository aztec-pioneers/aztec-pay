# Aztec Web Development Knowledgebase

A comprehensive knowledgebase for building browser-based Aztec applications that deploy to devnet.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Project Setup](#project-setup)
4. [Webpack Configuration](#webpack-configuration)
5. [Package Dependencies](#package-dependencies)
6. [TypeScript Configuration](#typescript-configuration)
7. [Browser Polyfills](#browser-polyfills)
8. [Application Code Patterns](#application-code-patterns)
9. [Common Issues & Solutions](#common-issues--solutions)
10. [Code Templates](#code-templates)
11. [Resources](#resources)

---

## Overview

This knowledgebase documents how to create browser-based Aztec applications that:
- Connect to Aztec devnet from the browser
- Create wallets and deploy contracts client-side
- Handle WASM proving in the browser
- Use Webpack for bundling (better WASM support than Vite)

### Why Webpack?

The reference Aztec web starter uses Webpack because:
1. **Better WASM handling** - Aztec's bb.js (Barretenberg) uses large WASM files for proving
2. **Node.js polyfills** - Webpack 5 has robust polyfill configuration
3. **Module resolution** - Better handling of Aztec's complex subpath exports

---

## Architecture

### Local Network vs Devnet Differences

| Feature | Local Network | Devnet |
|---------|--------------|--------|
| Proving | Optional (default: off) | **Required** |
| Fees | None | **Required** |
| Block Time | Instant | ~36 seconds |
| Test Accounts | Pre-deployed | Must create manually |
| Fee Payment | N/A | Sponsored FPC or Fee Juice |

### Critical Requirements for Devnet

1. **Proving must be enabled** - Devnet validates proofs; invalid proofs are rejected
2. **Fees must be paid** - Use the sponsored FPC for free transactions
3. **Contracts must be registered** - The SponsoredFPC contract must be registered with your PXE
4. **Account deployment is special** - Must use `AztecAddress.ZERO` as sender

---

## Project Setup

### Project Structure

```
project/
├── package.json              # Dependencies and scripts
├── web/                      # Web application source
│   ├── index.html           # HTML entry point
│   ├── app.ts               # Main TypeScript application
│   ├── webpack.config.cjs   # Webpack configuration
│   └── tsconfig.json        # TypeScript configuration
├── artifacts/               # Generated contract artifacts
│   └── Counter.ts          # From aztec codegen
├── target/                  # Noir compilation output
└── src/                     # Noir contract source
    └── main.nr
```

---

## Webpack Configuration

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
            transpileOnly: true, // Skip type checking for speed
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
      // Core Node.js polyfills (REQUIRED for Aztec)
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify'),
      crypto: require.resolve('crypto-browserify'),
      util: require.resolve('util/'),
      process: require.resolve('process/browser.js'),
      path: require.resolve('path-browserify'),
      os: require.resolve('os-browserify/browser'),
      
      // Additional polyfills (needed by Aztec dependencies)
      assert: require.resolve('assert/'),
      tty: require.resolve('tty-browserify'),
      
      // Disable Node-only modules
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
    asyncWebAssembly: true, // Enable WASM support
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
};
```

### Key Configuration Points

1. **`.cjs` extension** - Required because package.json has `"type": "module"`
2. **`transpileOnly: true`** - Speeds up compilation; skip type checking
3. **`asyncWebAssembly: true`** - Required for Aztec's WASM prover
4. **All polyfills listed** - Each one is required by different parts of Aztec SDK

---

## Package Dependencies

### package.json

```json
{
  "name": "aztec-web-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "codegen": "aztec codegen ./target/contract-Contract.json -o ./artifacts",
    "web:dev": "cd web && webpack serve --config webpack.config.cjs",
    "web:build": "cd web && webpack --mode=production --config webpack.config.cjs"
  },
  "dependencies": {
    "@aztec/aztec.js": "3.0.0-devnet.6-patch.1",
    "@aztec/test-wallet": "3.0.0-devnet.6-patch.1",
    "@aztec/l1-artifacts": "3.0.0-devnet.6-patch.1",
    "@aztec/noir-contracts.js": "3.0.0-devnet.6-patch.1",
    
    "Browser polyfills": "",
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
    "typescript": "^5.0.0",
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4",
    "webpack-dev-server": "^4.15.1"
  }
}
```

### Version Matching (CRITICAL)

Aztec devnet requires **exact version matching**:

```typescript
const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";
```

Current devnet version: `3.0.0-devnet.6-patch.1`

---

## TypeScript Configuration

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

---

## Browser Polyfills

### Why Each Polyfill is Needed

| Polyfill | Package | Used By |
|----------|---------|---------|
| `buffer` | `buffer/` | Aztec crypto operations |
| `stream` | `stream-browserify` | Protocol handling |
| `crypto` | `crypto-browserify` | Hashing, signatures |
| `util` | `util/` | Node.js utilities |
| `process` | `process/browser.js` | Environment detection |
| `path` | `path-browserify` | Path resolution |
| `os` | `os-browserify` | OS info (browser mock) |
| `assert` | `assert/` | Noir protocol circuits |
| `tty` | `tty-browserify` | Logging/colors |

### Common Errors Without Polyfills

```
Error: Can't resolve 'buffer' in ...
Error: Can't resolve 'assert' in ...
Error: Can't resolve 'tty' in ...
Error: Cannot read properties of undefined (reading 'module')
```

---

## Application Code Patterns

### web/app.ts - Key Patterns

```typescript
// 1. Import Aztec SDK modules (using subpath exports)
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { CounterContract } from "../artifacts/Counter";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

// 2. Lazy import TestWallet (handles WASM loading)
const { TestWallet } = await import("@aztec/test-wallet/client/lazy");

// 3. Create node and wallet
const node = createAztecNodeClient(DEVNET_NODE_URL);
const wallet = await TestWallet.create(node, { proverEnabled: true });

// 4. Create account
const accountManager = await wallet.createSchnorrAccount(
  Fr.random(), 
  Fr.random(), 
  GrumpkinScalar.random()
);
const accountAddress = accountManager.address;

// 5. Register SponsoredFPC (REQUIRED for fees)
const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);

// 6. Deploy account (must use AztecAddress.ZERO)
const deployAccountMethod = await accountManager.getDeployMethod();
await deployAccountMethod
  .send({ 
    from: AztecAddress.ZERO,  // CRITICAL: Not accountAddress!
    fee: { paymentMethod: sponsoredPaymentMethod }
  })
  .wait();

// 7. Deploy contract
const contract = await CounterContract.deploy(wallet)
  .send({
    from: accountAddress,
    fee: { paymentMethod: sponsoredPaymentMethod },
  })
  .deployed();

// 8. Interact with contract
const count = await contract.methods.get_count().simulate({ from: accountAddress });
```

### Critical Implementation Details

1. **Lazy import TestWallet** - `@aztec/test-wallet/client/lazy` loads WASM on demand
2. **proverEnabled: true** - Required for devnet (must generate proofs)
3. **AztecAddress.ZERO for account deployment** - Special case for account contracts
4. **Register SponsoredFPC first** - Must register before using for fees
5. **Store node reference separately** - `wallet.getNode()` doesn't exist in browser bundle

---

## Common Issues & Solutions

### Issue 1: "Buffer is not defined"

```
Uncaught ReferenceError: Buffer is not defined
```

**Solution**: Add to webpack.config.cjs:
```javascript
plugins: [
  new webpack.ProvidePlugin({
    Buffer: ['buffer', 'Buffer'],
  }),
],
resolve: {
  fallback: {
    buffer: require.resolve('buffer/'),
  },
}
```

### Issue 2: WASM Magic Word Error

```
WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f
```

**Cause**: WASM file is being served as HTML (404 page)

**Solution**: 
- Use Webpack instead of Vite
- Ensure `experiments: { asyncWebAssembly: true }`
- Don't exclude Aztec packages from optimization incorrectly

### Issue 3: "Cannot find module 'assert'"

```
Module not found: Error: Can't resolve 'assert'
```

**Solution**: Add to webpack.config.cjs:
```javascript
resolve: {
  fallback: {
    assert: require.resolve('assert/'),
  },
}
```

### Issue 4: "wallet.getNode is not a function"

**Cause**: Browser bundle of TestWallet doesn't have getNode()

**Solution**: Store node reference separately:
```typescript
let node: any = null;
let wallet: any = null;

// Initialize
node = createAztecNodeClient(DEVNET_NODE_URL);
wallet = await TestWallet.create(node, { proverEnabled: true });

// Use stored node
const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
```

### Issue 5: "Invalid proof" Error

```
Error: Invalid tx: Invalid proof
```

**Solution**: Enable proving when creating wallet:
```typescript
const wallet = await TestWallet.create(node, { proverEnabled: true });
```

### Issue 6: "No contract instance found for address"

```
Simulation error: No contract instance found for address 0x1586f476...
```

**Solution**: Register SponsoredFPC before use:
```typescript
await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
```

### Issue 7: "Insufficient fee payer balance"

**Solution**: Include fee payment in account deployment:
```typescript
.send({ 
  from: AztecAddress.ZERO, 
  fee: { paymentMethod: sponsoredPaymentMethod } 
})
```

---

## Code Templates

### Minimal Counter Contract (src/main.nr)

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

### Nargo.toml

```toml
[package]
name = "counter"
version = "0.1.0"
type = "contract"

[dependencies]
aztec = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "v3.0.0-devnet.6-patch.1", directory = "noir-projects/aztec-nr/aztec" }
```

### Build Commands

```bash
# 1. Compile contract
aztec compile

# 2. Generate TypeScript artifacts
npm run codegen

# 3. Start web dev server
npm run web:dev
```

---

## Resources

### Devnet Information

- **RPC URL**: https://devnet-6.aztec-labs.com
- **Version**: 3.0.0-devnet.6-patch.1
- **L1 Chain ID**: 11155111 (Sepolia)
- **Rollup Version**: 1647720761
- **Block Time**: ~36 seconds

### Protocol Contract Addresses

| Contract | Address |
|----------|---------|
| MultiCallEntrypoint | `0x0000000000000000000000000000000000000000000000000000000000000004` |
| FeeJuice | `0x0000000000000000000000000000000000000000000000000000000000000005` |
| InstanceRegistry | `0x0000000000000000000000000000000000000000000000000000000000000002` |
| ClassRegistry | `0x0000000000000000000000000000000000000000000000000000000000000003` |
| SponsoredFPC | `0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e` |

### Official Resources

- [Aztec Devnet Docs](https://docs.aztec.network/developers/getting_started_on_devnet)
- [Aztec Web Starter](https://github.com/AztecProtocol/aztec-web-starter) - Reference project
- [Aztec Examples](https://github.com/AztecProtocol/aztec-examples)
- [Aztec Playground](https://playground.aztec.network)
- [AztecScan Explorer](https://aztecscan.xyz/)

---

## Summary Checklist

When setting up a new Aztec web project:

- [ ] Install all polyfill packages
- [ ] Configure webpack.config.cjs with all fallbacks
- [ ] Use `.cjs` extension for webpack config
- [ ] Set `experiments: { asyncWebAssembly: true }`
- [ ] Use `transpileOnly: true` in ts-loader
- [ ] Lazy import TestWallet: `await import("@aztec/test-wallet/client/lazy")`
- [ ] Store node reference separately from wallet
- [ ] Enable proving: `proverEnabled: true`
- [ ] Register SponsoredFPC before using
- [ ] Use `AztecAddress.ZERO` for account deployment
- [ ] Match package versions to devnet version exactly

---

*Last updated: 2026-02-16*
*Devnet version: 3.0.0-devnet.6-patch.1*
