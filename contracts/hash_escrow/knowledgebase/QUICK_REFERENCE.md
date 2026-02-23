# Aztec Web Development Quick Reference

## Copy-Paste Templates

### 1. package.json dependencies

```json
{
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
    "html-webpack-plugin": "^5.6.0",
    "ts-loader": "^9.5.1",
    "typescript": "^5.0.0",
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4",
    "webpack-dev-server": "^4.15.1"
  },
  "scripts": {
    "web:dev": "cd web && webpack serve --config webpack.config.cjs",
    "web:build": "cd web && webpack --mode=production --config webpack.config.cjs"
  }
}
```

### 2. web/webpack.config.cjs

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
      'process/browser': require.resolve('process/browser.js'),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({ template: './index.html' }),
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
    static: { directory: path.join(__dirname, '../dist') },
    port: 3000,
    hot: true,
    historyApiFallback: true,
  },
};
```

### 3. web/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": false,
    "allowSyntheticDefaultImports": true,
    "sourceMap": true,
    "outDir": "../dist",
    "rootDir": ".",
    "baseUrl": "."
  },
  "include": ["./**/*.ts", "../artifacts/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 4. Basic app.ts Template

```typescript
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { CounterContract } from "../artifacts/Counter";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

let wallet: any = null;
let node: any = null;
let accountAddress: AztecAddress | null = null;
let contract: CounterContract | null = null;

async function init() {
  console.log("Initializing...");
  
  node = createAztecNodeClient(DEVNET_NODE_URL);
  const { TestWallet } = await import("@aztec/test-wallet/client/lazy");
  wallet = await TestWallet.create(node, { proverEnabled: true });
  
  console.log("Ready!");
}

async function deploy() {
  // Create account
  const accountManager = await wallet.createSchnorrAccount(
    Fr.random(), 
    Fr.random(), 
    GrumpkinScalar.random()
  );
  accountAddress = accountManager.address;
  
  // Register SponsoredFPC
  const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
  await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
  
  // Deploy account
  const deployAccountMethod = await accountManager.getDeployMethod();
  await deployAccountMethod
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: sponsoredPaymentMethod } })
    .wait();
  
  // Deploy contract
  contract = await CounterContract.deploy(wallet)
    .send({ from: accountAddress, fee: { paymentMethod: sponsoredPaymentMethod } })
    .deployed();
  
  console.log("Deployed:", contract.address.toString());
}

async function increment(secret: number) {
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(
    AztecAddress.fromString(SPONSORED_FPC_ADDRESS)
  );
  const hash = await contract!.methods.get_secret_hash().simulate({ from: accountAddress! });
  
  await contract!.methods.increment_with_secret(secret, hash)
    .send({ from: accountAddress!, fee: { paymentMethod: sponsoredPaymentMethod } })
    .wait();
  
  console.log("Incremented!");
}

document.addEventListener("DOMContentLoaded", init);
```

## Error Quick Fixes

| Error | Fix |
|-------|-----|
| `Buffer is not defined` | Add `ProvidePlugin` for Buffer |
| `Can't resolve 'assert'` | Add `assert: require.resolve('assert/')` to fallbacks |
| `Can't resolve 'tty'` | Add `tty: require.resolve('tty-browserify')` to fallbacks |
| `wallet.getNode is not a function` | Store node reference separately |
| `Invalid proof` | Use `proverEnabled: true` |
| WASM magic word error | Use Webpack, not Vite |
| `Module not found` | Install missing polyfill package |

## Important Constants

```typescript
// Devnet config
const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

// Secret for counter example
const SECRET = 42;
```

## Build Commands

```bash
# Compile Noir contract
aztec compile

# Generate TypeScript
aztec codegen ./target/contract-Contract.json -o ./artifacts

# Dev server
npm run web:dev

# Production build
npm run web:build
```

## Version Compatibility

Current devnet: **3.0.0-devnet.6-patch.1**

All @aztec/* packages must use this exact version.
