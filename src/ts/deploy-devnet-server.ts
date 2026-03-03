#!/usr/bin/env node
/**
 * AztecPay Devnet Server Deployment Script
 * 
 * Deploys a new TokenContract to devnet with the server's test account as minter.
 * This ensures the server can mint tokens without needing private notes.
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/src/artifacts/Token.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { writeFileSync } from "fs";
import "dotenv/config";

// Devnet configuration
const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = process.env.SPONSORED_FPC_ADDRESS || "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

async function main() {
  console.log("🚀 AztecPay Devnet Server Deployment");
  console.log("=".repeat(60));
  console.log(`📡 Node URL: ${DEVNET_NODE_URL}`);
  console.log(`💰 Sponsored FPC: ${SPONSORED_FPC_ADDRESS}`);
  console.log("=".repeat(60));

  // Connect to devnet node
  console.log("\n📡 Connecting to devnet node...");
  const node = createAztecNodeClient(DEVNET_NODE_URL);
  
  // Test connection
  try {
    const nodeInfo = await node.getNodeInfo();
    console.log("✅ Connected to devnet");
    console.log(`   Node Version: ${nodeInfo.nodeVersion}`);
  } catch (error: any) {
    console.error("❌ Failed to connect to devnet:", error.message);
    process.exit(1);
  }
  
  // Create wallet
  console.log("\n👤 Creating devnet wallet...");
  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  console.log("✅ Wallet created");

  // Register SponsoredFPC
  console.log("\n💰 Registering SponsoredFPC contract...");
  const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
  
  if (!sponsoredFpcInstance) {
    throw new Error(`SponsoredFPC contract not found at ${SPONSORED_FPC_ADDRESS}`);
  }
  
  await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
  console.log("✅ SponsoredFPC registered");

  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);

  // Create minter account
  console.log("\n🔑 Creating minter account...");
  const secretKey = Fr.random();
  const salt = Fr.random();
  const signingKey = GrumpkinScalar.random();
  
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);
  const minterAddress = accountManager.address;
  console.log(`   Account address: ${minterAddress}`);

  // Deploy the account
  console.log("\n⛽ Deploying minter account...");
  const deployAccountMethod = await accountManager.getDeployMethod();
  await deployAccountMethod
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: sponsoredPaymentMethod } });
  console.log("✅ Account deployed");

  // Deploy the TokenContract
  console.log("\n📦 Deploying USDC TokenContract...");
  
  try {
    console.log("\n⏳ Deploying token contract...");
    console.log("   Waiting for transaction to be mined...");

    const token = await TokenContract.deployWithOpts(
      { wallet, method: "constructor_with_minter" },
      "USDC",
      "USDC",
      6,
      minterAddress,
      minterAddress
    )
      .send({
        from: minterAddress,
        fee: { paymentMethod: sponsoredPaymentMethod },
      });
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ Token deployed successfully!");
    console.log("=".repeat(60));
    console.log(`📍 Token Address: ${token.address}`);
    console.log(`👤 Minter: ${minterAddress}`);
    console.log("=".repeat(60));

    // Save deployment info
    const deployment = {
      environment: 'devnet',
      tokenAddress: token.address.toString(),
      minterAddress: minterAddress.toString(),
      minterSecret: secretKey.toString(),
      minterSalt: salt.toString(),
      nodeUrl: DEVNET_NODE_URL,
      sponsoredFpcAddress: SPONSORED_FPC_ADDRESS,
      deployedAt: new Date().toISOString(),
    };

    writeFileSync("deployment.json", JSON.stringify(deployment, null, 2));
    writeFileSync(".env", generateEnvFile(deployment));
    
    console.log("\n💾 Deployment saved:");
    console.log("   - deployment.json");
    console.log("   - .env");
    console.log("\n✨ Server deployment complete!");
    console.log("\n⚠️  Important: Save deployment.json - it contains the minter credentials!");
    console.log("=".repeat(60));
    
  } catch (error: any) {
    console.error("\n❌ Deployment failed:", error.message || error);
    throw error;
  }
}

function generateEnvFile(deployment: any): string {
  return `# AztecPay Environment Configuration
AZTEC_ENV=devnet

# Devnet Configuration
AZTEC_NODE_URL=${deployment.nodeUrl}
SPONSORED_FPC_ADDRESS=${deployment.sponsoredFpcAddress}

# Deployed Contract Addresses
TOKEN_ADDRESS=${deployment.tokenAddress}
MINTER_ADDRESS=${deployment.minterAddress}
MINTER_SECRET=${deployment.minterSecret}
MINTER_SALT=${deployment.minterSalt}

# EVM Bridge Configuration
EVM_PRIVATE_KEY=0x22d423e3b79256b3f3bd85d6c42e04c4a2844e1512328e6aa370919d4c5e89db
EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/qcq-0LcD1tJUBQOhKgZxp5DwcxjiQt3-
EVM_TOKEN_ADDRESS=0x8e967C9D33E2a97cca55Be55276c05EAE39c2201
`;
}

main().catch((error) => {
  console.error("\n💥 Fatal error:", error);
  process.exit(1);
});
