# Aztec Devnet Deployment Guide

A comprehensive guide for deploying contracts to the Aztec devnet using TypeScript and AztecJS.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Key Concepts](#key-concepts)
- [Step-by-Step Deployment](#step-by-step-deployment)
- [Common Issues & Solutions](#common-issues--solutions)
- [Code Examples](#code-examples)
- [Environment Variables](#environment-variables)
- [References](#references)

---

## Prerequisites

### 1. Package Versions

**CRITICAL**: Devnet is version-dependent. The SDK version must match the devnet version exactly.

Current devnet version: `3.0.0-devnet.6-patch.1`

```json
{
  "dependencies": {
    "@aztec/aztec.js": "3.0.0-devnet.6-patch.1",
    "@aztec/test-wallet": "3.0.0-devnet.6-patch.1",
    "@aztec/noir-contracts.js": "3.0.0-devnet.6-patch.1",
    "@aztec/accounts": "3.0.0-devnet.6-patch.1"
  }
}
```

### 2. Devnet Configuration

```typescript
const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";
```

### 3. Required Imports

```typescript
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
```

---

## Key Concepts

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

## Step-by-Step Deployment

### Step 1: Create a TestWallet with Proving Enabled

```typescript
const node = createAztecNodeClient(DEVNET_NODE_URL);

// CRITICAL: Must enable proving for devnet!
const wallet = await TestWallet.create(node, { proverEnabled: true });
```

**⚠️ Warning**: If `proverEnabled` is `false` (default), transactions will fail with "Invalid proof" errors.

### Step 2: Create a Schnorr Account

```typescript
const secretKey = Fr.random();
const salt = Fr.random();
const signingKey = GrumpkinScalar.random();

// Use the wallet's built-in method for proper PXE registration
const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);
const accountAddress = accountManager.address;

console.log(`Account address: ${accountAddress}`);
```

### Step 3: Register the SponsoredFPC Contract

**CRITICAL**: The SponsoredFPC contract MUST be registered before use.

```typescript
const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);

// Fetch the contract instance from the node
const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
if (!sponsoredFpcInstance) {
  throw new Error(`SponsoredFPC contract not found at ${sponsoredFpcAddress}`);
}

// Register with the wallet/PXE
await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);

// Create the fee payment method
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
```

**Common Error if skipped**: `No contract instance found for address 0x1586f476...`

### Step 4: Deploy the Account Contract

Account contracts have special deployment requirements:

```typescript
const deployAccountMethod = await accountManager.getDeployMethod();
const accountTx = await deployAccountMethod
  .send({ 
    from: AztecAddress.ZERO,  // MUST be ZERO, not the account address
    fee: { paymentMethod: sponsoredPaymentMethod }
  })
  .wait();

console.log(`Account deployed in block ${accountTx.blockNumber}`);
```

**Key Points:**
- `from: AztecAddress.ZERO` is **required** for account contract deployment
- Fee payment method is **required** (devnet requires fees)
- First deployment takes longer (~2-3 minutes) due to proving key downloads

### Step 5: Deploy Your Contract

```typescript
const deployTx = await CounterContract.deploy(wallet)
  .send({
    from: accountAddress,
    fee: { paymentMethod: sponsoredPaymentMethod },
  });

const contract = await deployTx.deployed();
console.log(`Contract deployed at: ${contract.address}`);
```

**Note**: Use the original `wallet` instance, not `accountManager.getAccount()`.

### Step 6: Interact with Your Contract

```typescript
// Simulate a read operation
const count = await contract.methods.get_count().simulate({ from: accountAddress });

// Send a transaction
const tx = await contract.methods.increment()
  .send({ 
    from: accountAddress, 
    fee: { paymentMethod: sponsoredPaymentMethod } 
  })
  .wait();
```

---

## Common Issues & Solutions

### Issue 1: "Invalid proof" Error

```
Error: Invalid tx: Invalid proof
```

**Solution**: Enable proving when creating the TestWallet:
```typescript
const wallet = await TestWallet.create(node, { proverEnabled: true });
```

### Issue 2: "No contract instance found for address" Error

```
Simulation error: No contract instance found for address 0x1586f476...
```

**Solution**: Register the SponsoredFPC contract before using it:
```typescript
const instance = await node.getContract(sponsoredFpcAddress);
await wallet.registerContract(instance, SponsoredFPCContract.artifact);
```

### Issue 3: "Insufficient fee payer balance" Error

**Solution**: Account deployment must include fee payment:
```typescript
.send({ 
  from: AztecAddress.ZERO, 
  fee: { paymentMethod: sponsoredPaymentMethod } 
})
```

### Issue 4: "Failed to get a note" / Account Deployment Simulation Error

```
Assertion failed: Failed to get a note 'self.is_some()'
```

**Solution**: Use `AztecAddress.ZERO` as sender for account deployment, not the account address.

### Issue 5: Transaction Timeout

Devnet has ~36 second block times. Handle timeouts gracefully:

```typescript
try {
  const receipt = await tx.wait();
} catch (error) {
  if (error.message?.includes("Timeout awaiting isMined")) {
    console.log("Transaction still being mined - check explorer");
  }
}
```

---

## Code Examples

### Complete Minimal Deployment Script

```typescript
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { CounterContract } from "./artifacts/Counter.js";

const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

async function deploy() {
  // 1. Connect to devnet with proving enabled
  const node = createAztecNodeClient(DEVNET_NODE_URL);
  const wallet = await TestWallet.create(node, { proverEnabled: true });

  // 2. Create account
  const accountManager = await wallet.createSchnorrAccount(
    Fr.random(), 
    Fr.random(), 
    GrumpkinScalar.random()
  );
  const accountAddress = accountManager.address;

  // 3. Register SponsoredFPC
  const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
  await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);

  // 4. Deploy account
  const deployAccountMethod = await accountManager.getDeployMethod();
  await deployAccountMethod
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: sponsoredPaymentMethod } })
    .wait();

  // 5. Deploy contract
  const contract = await CounterContract.deploy(wallet)
    .send({ from: accountAddress, fee: { paymentMethod: sponsoredPaymentMethod } })
    .deployed();

  console.log(`Contract deployed at: ${contract.address}`);
  return contract;
}

deploy().catch(console.error);
```

### Using Environment Variables

```typescript
// .env
AZTEC_NODE_URL=https://devnet-6.aztec-labs.com
SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
```

```typescript
// Load from environment
const DEVNET_NODE_URL = process.env.AZTEC_NODE_URL || "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = process.env.SPONSORED_FPC_ADDRESS || 
  "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AZTEC_NODE_URL` | Devnet RPC endpoint | `https://devnet-6.aztec-labs.com` |
| `SPONSORED_FPC_ADDRESS` | Sponsored FPC contract address | `0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e` |
| `VERSION` | Aztec version to use | `3.0.0-devnet.6-patch.1` |

---

## Web App

A browser-based web application is included for deploying and interacting with the contract from the browser.

### Running the Web App

```bash
# Start development server
npm run web:dev

# Build for production
npm run web:build

# Preview production build
npm run web:preview
```

### Web App Features

- 🚀 **Deploy from Browser** - Deploy the counter contract directly from your browser
- 🔐 **Secret Proving** - Prove knowledge of the secret (42) without revealing it
- 🔢 **View Counter** - See the current public counter value
- ⬆️ **Increment** - Increment the counter by proving you know the secret

### How to Use

1. Run `npm run web:dev` to start the development server
2. Open http://localhost:3000 in your browser
3. Click "Deploy Contract" (this takes 2-3 minutes for proving)
4. Once deployed, enter the secret value "42"
5. Click "Prove Secret & Increment"
6. The counter will increment if the secret is correct!

### Web App Architecture

- **Frontend**: Vanilla TypeScript with Webpack bundler
- **Aztec SDK**: Uses `@aztec/aztec.js` and `@aztec/test-wallet/client/lazy`
- **Proving**: Client-side proving directly in the browser
- **Network**: Connects to Aztec Devnet

---

## References

### Devnet Information

- **RPC URL**: https://devnet-6.aztec-labs.com
- **Version**: 3.0.0-devnet.6-patch.1
- **L1 Chain ID**: 11155111 (Sepolia)
- **Rollup Version**: 1647720761
- **Block Time**: ~36 seconds

### Official Resources

- [Aztec Devnet Documentation](https://docs.aztec.network/developers/getting_started_on_devnet)
- [Aztec Starter Repository](https://github.com/AztecProtocol/aztec-starter)
- [Aztec Examples](https://github.com/AztecProtocol/aztec-examples)
- [Aztec Playground](https://playground.aztec.network)

### Block Explorers

- [AztecScan](https://aztecscan.xyz/)

### Protocol Contract Addresses

| Contract | Address |
|----------|---------|
| MultiCallEntrypoint | `0x0000000000000000000000000000000000000000000000000000000000000004` |
| FeeJuice | `0x0000000000000000000000000000000000000000000000000000000000000005` |
| InstanceRegistry | `0x0000000000000000000000000000000000000000000000000000000000000002` |
| ClassRegistry | `0x0000000000000000000000000000000000000000000000000000000000000003` |

---

## Tips for Agents

1. **Always check version compatibility** - Devnet requires exact version matches
2. **Enable proving** - Never forget `proverEnabled: true` for devnet
3. **Register SponsoredFPC first** - Must be done before any fee payment
4. **Use AztecAddress.ZERO for account deployment** - This is a special case
5. **Handle timeouts gracefully** - Devnet is slower than local network
6. **First run is slow** - Proving keys are downloaded on first use (~2-3 minutes)
7. **Save generated keys** - Secret keys, salts, and signing keys should be saved for account recovery

---

## License

This guide is provided as-is for educational purposes. Refer to official Aztec documentation for authoritative information.
