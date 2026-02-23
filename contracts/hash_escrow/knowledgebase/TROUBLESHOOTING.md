# Aztec Web Development Troubleshooting Guide

Common issues and solutions when building Aztec web applications.

## Table of Contents

1. [Build Errors](#build-errors)
2. [Runtime Errors](#runtime-errors)
3. [Transaction Errors](#transaction-errors)
4. [WASM Issues](#wasm-issues)
5. [Network Issues](#network-issues)

---

## Build Errors

### Error: "Can't resolve 'buffer'"

```
Module not found: Error: Can't resolve 'buffer'
```

**Cause**: Buffer polyfill not configured in Webpack.

**Solution**:
```javascript
// webpack.config.cjs
resolve: {
  fallback: {
    buffer: require.resolve('buffer/'),
  },
},
plugins: [
  new webpack.ProvidePlugin({
    Buffer: ['buffer', 'Buffer'],
  }),
],
```

Also install: `npm install buffer`

---

### Error: "Can't resolve 'assert'"

```
Module not found: Error: Can't resolve 'assert'
```

**Cause**: Assert polyfill not configured.

**Solution**:
```javascript
// webpack.config.cjs
resolve: {
  fallback: {
    assert: require.resolve('assert/'),
  },
}
```

Also install: `npm install assert`

---

### Error: "Can't resolve 'tty'"

```
Module not found: Error: Can't resolve 'tty'
```

**Solution**:
```javascript
// webpack.config.cjs
resolve: {
  fallback: {
    tty: require.resolve('tty-browserify'),
  },
}
```

Also install: `npm install tty-browserify`

---

### Error: "Can't resolve 'stream'"

**Solution**:
```javascript
// webpack.config.cjs
resolve: {
  fallback: {
    stream: require.resolve('stream-browserify'),
  },
}
```

Also install: `npm install stream-browserify`

---

### Error: "Can't resolve 'crypto'"

**Solution**:
```javascript
// webpack.config.cjs
resolve: {
  fallback: {
    crypto: require.resolve('crypto-browserify'),
  },
}
```

Also install: `npm install crypto-browserify`

---

### Error: "Can't resolve 'util'"

**Solution**:
```javascript
// webpack.config.cjs
resolve: {
  fallback: {
    util: require.resolve('util/'),
  },
}
```

Also install: `npm install util`

---

### Error: "Can't resolve 'process/browser'"

**Solution**:
```javascript
// webpack.config.cjs
resolve: {
  fallback: {
    process: require.resolve('process/browser.js'),
  },
  alias: {
    'process/browser': require.resolve('process/browser.js'),
  },
},
plugins: [
  new webpack.ProvidePlugin({
    process: 'process/browser.js',
  }),
],
```

---

### Error: "Cannot read properties of undefined (reading 'module')"

**Cause**: Missing `process` polyfill configuration.

**Solution**: Add complete process polyfill as shown above.

---

## Runtime Errors

### Error: "Buffer is not defined"

```
Uncaught ReferenceError: Buffer is not defined
```

**Cause**: Buffer not globally available.

**Solution**: Ensure ProvidePlugin is configured:
```javascript
plugins: [
  new webpack.ProvidePlugin({
    Buffer: ['buffer', 'Buffer'],
  }),
],
```

---

### Error: "process is not defined"

**Solution**: Ensure ProvidePlugin includes process:
```javascript
plugins: [
  new webpack.ProvidePlugin({
    process: 'process/browser.js',
  }),
],
```

---

### Error: "wallet.getNode is not a function"

**Cause**: The browser bundle of TestWallet doesn't expose getNode().

**Solution**: Store node reference separately:
```typescript
// ❌ Don't do this
const wallet = await TestWallet.create(node);
const contractInstance = await wallet.getNode().getContract(address); // Error!

// ✅ Do this instead
let node: any = null;
let wallet: any = null;

node = createAztecNodeClient(DEVNET_NODE_URL);
const { TestWallet } = await import("@aztec/test-wallet/client/lazy");
wallet = await TestWallet.create(node, { proverEnabled: true });

// Use stored node reference
const contractInstance = await node.getContract(address);
```

---

### Error: "Cannot find module '@aztec/...'"

**Cause**: Aztec SDK uses subpath exports that need proper resolution.

**Solution**: Ensure TypeScript and Webpack are configured correctly:

```json
// tsconfig.json
{
  "compilerOptions": {
    "moduleResolution": "node"
  }
}
```

```javascript
// webpack.config.cjs
resolve: {
  extensions: ['.ts', '.js', '.mjs'],
}
```

---

## Transaction Errors

### Error: "Invalid tx: Invalid proof"

```
Error: Invalid tx: Invalid proof
```

**Cause**: Proving is disabled (default) but devnet requires proofs.

**Solution**: Enable proving when creating wallet:
```typescript
const wallet = await TestWallet.create(node, { proverEnabled: true });
```

---

### Error: "No contract instance found for address"

```
Simulation error: No contract instance found for address 0x1586f476...
```

**Cause**: SponsoredFPC contract not registered with PXE.

**Solution**: Register before use:
```typescript
const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
```

---

### Error: "Insufficient fee payer balance"

**Cause**: Account deployment transaction doesn't include fee payment.

**Solution**: Include fee payment in account deployment:
```typescript
const deployAccountMethod = await accountManager.getDeployMethod();
await deployAccountMethod
  .send({ 
    from: AztecAddress.ZERO,  // Must be ZERO
    fee: { paymentMethod: sponsoredPaymentMethod }  // Required!
  })
  .wait();
```

---

### Error: "Failed to get a note 'self.is_some()'"

```
Assertion failed: Failed to get a note 'self.is_some()'
```

**Cause**: Using account address instead of ZERO for account deployment.

**Solution**: Use AztecAddress.ZERO:
```typescript
// ❌ Wrong
.send({ from: accountAddress, ... })

// ✅ Correct
.send({ from: AztecAddress.ZERO, ... })
```

---

### Error: "Timeout awaiting isMined"

**Cause**: Devnet has ~36 second block times; default timeout is too short.

**Solution**: This is normal! Handle gracefully:
```typescript
try {
  const receipt = await tx.wait();
} catch (error: any) {
  if (error.message?.includes("Timeout awaiting isMined")) {
    console.log("Transaction still being mined - check explorer");
    // Transaction may still succeed; check explorer for status
  }
}
```

---

### Error: "Version mismatch"

```
Error: Version mismatch between client and node
```

**Cause**: Aztec package versions don't match devnet version.

**Solution**: Use exact version matching:
```json
{
  "dependencies": {
    "@aztec/aztec.js": "3.0.0-devnet.6-patch.1",
    "@aztec/test-wallet": "3.0.0-devnet.6-patch.1",
    "@aztec/noir-contracts.js": "3.0.0-devnet.6-patch.1"
  }
}
```

---

## WASM Issues

### Error: "WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f"

```
WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f
```

**Cause**: WASM file is being served as HTML (404 page). The magic word `3c 21 44 4f` is `<!DO` (start of HTML doctype).

**Solution**:
1. Use Webpack instead of Vite
2. Enable WASM in webpack config:
```javascript
experiments: {
  asyncWebAssembly: true,
}
```
3. Ensure no incorrect exclusions in optimization

---

### Error: "Cannot load WASM module"

**Cause**: WASM loading not properly configured.

**Solution**: Use lazy import for TestWallet:
```typescript
const { TestWallet } = await import("@aztec/test-wallet/client/lazy");
```

This ensures WASM is loaded on-demand in the browser.

---

### Error: "Out of memory" during proving

**Cause**: Browser has memory limits; proving is resource-intensive.

**Solution**:
- Close other browser tabs
- Use a machine with more RAM
- First run is slower (downloads proving keys)

---

## Network Issues

### Error: "Failed to fetch"

```
TypeError: Failed to fetch
```

**Cause**: Cannot connect to devnet node.

**Solution**:
1. Check internet connection
2. Verify DEVNET_NODE_URL is correct:
   ```typescript
   const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
   ```
3. Check if devnet is online at [Aztec Status](https://status.aztec.network)

---

### Error: "CORS policy"

```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**Cause**: Browser security blocking cross-origin requests.

**Solution**: Devnet nodes should allow CORS. If using a proxy, ensure it forwards headers properly.

---

### Error: "Network Error"

**Solution**: 
- Check firewall settings
- Try different network
- Devnet may be temporarily unavailable

---

## Import/Module Errors

### Error: "Cannot use import statement outside a module"

**Cause**: Mixing CommonJS and ES modules.

**Solution**: 
- Set `"type": "module"` in package.json for ES modules
- Use `.cjs` extension for CommonJS files (like webpack.config.cjs)

---

### Error: "require is not defined"

**Cause**: Trying to use require() in ES module context.

**Solution**: Use `.cjs` extension for files that need require().

---

### Error: "AZTEC_ABI functions are not permitted to be called"

**Cause**: Trying to call contract methods before contract is deployed.

**Solution**: Ensure `.deployed()` is called:
```typescript
const contract = await CounterContract.deploy(wallet)
  .send({...})
  .deployed();  // Don't forget this!
```

---

## TypeScript Errors

### Error: "Cannot find module '../artifacts/Contract' or its corresponding type declarations"

**Cause**: TypeScript bindings not generated.

**Solution**: Run codegen:
```bash
aztec codegen ./target/contract-Contract.json -o ./artifacts
```

---

### Error: "TS2307: Cannot find module '@aztec/...'"

**Cause**: TypeScript can't resolve Aztec subpath exports.

**Solution**: Ensure `moduleResolution` is set to `"node"`:
```json
{
  "compilerOptions": {
    "moduleResolution": "node"
  }
}
```

---

## Quick Fix Checklist

When encountering errors, check:

1. [ ] All polyfill packages installed
2. [ ] webpack.config.cjs has all fallbacks configured
3. [ ] `experiments: { asyncWebAssembly: true }` set
4. [ ] Using `.cjs` extension for webpack config
5. [ ] `proverEnabled: true` in TestWallet.create()
6. [ ] SponsoredFPC registered before use
7. [ ] `AztecAddress.ZERO` for account deployment
8. [ ] Package versions match devnet version
9. [ ] Lazy import for TestWallet: `await import("@aztec/test-wallet/client/lazy")`
10. [ ] Node reference stored separately from wallet

---

*Last updated: 2026-02-16*
*Devnet version: 3.0.0-devnet.6-patch.1*
