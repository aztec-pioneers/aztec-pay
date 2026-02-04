#!/usr/bin/env node
/**
 * AztecPay Devnet Deployment Script
 * 
 * Deploys the TokenContract to Aztec devnet (3.0.0-devnet.6-patch).
 * 
 * Prerequisites:
 * - Set AZTEC_ENV=devnet in your .env file
 * - Ensure SPONSORED_FPC_ADDRESS is set (defaults to devnet-6 address)
 * 
 * Usage:
 *   AZTEC_ENV=devnet yarn deploy:devnet
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { writeFileSync } from "fs";
import "dotenv/config";

// Devnet configuration - force devnet settings regardless of AZTEC_ENV
const DEVNET_NODE_URL = "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = process.env.SPONSORED_FPC_ADDRESS || "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

console.log("🔧 Devnet Deployment Mode");

async function main() {
  console.log("🚀 AztecPay Devnet Deployment");
  console.log("=".repeat(60));
  console.log(`📡 Node URL: ${DEVNET_NODE_URL}`);
  console.log(`💰 Sponsored FPC: ${SPONSORED_FPC_ADDRESS}`);
  console.log("=".repeat(60));

  // Connect to devnet node
  console.log("\n📡 Connecting to devnet node...");
  const node = createAztecNodeClient(DEVNET_NODE_URL);
  
  // Test connection by getting node info
  try {
    const nodeInfo = await node.getNodeInfo();
    console.log("✅ Connected to devnet");
    console.log(`   Node Version: ${nodeInfo.nodeVersion}`);
    console.log(`   Chain ID: ${nodeInfo.chainId}`);
  } catch (error: any) {
    console.error("❌ Failed to connect to devnet:", error.message);
    console.log("\n💡 Troubleshooting:");
    console.log("   - Check your internet connection");
    console.log("   - Verify the devnet is online: https://devnet-6.aztec-labs.com");
    process.exit(1);
  }
  
  // Create a test wallet (this creates a PXE that connects to the node)
  console.log("\n👤 Creating devnet wallet...");
  console.log("   (Proving is enabled - this will download proving keys on first run)");
  const wallet = await TestWallet.create(node, { proverEnabled: true });
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

  // Create fee payment method
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);

  // Create account credentials
  console.log("\n🔑 Creating deployer account...");
  const secretKey = Fr.random();
  const salt = Fr.random();
  const signingKey = GrumpkinScalar.random();
  
  // Create the account
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);
  const accountAddress = accountManager.address;
  console.log(`   Account address: ${accountAddress}`);

  // Deploy the account contract with sponsored fees
  console.log("\n⛽ Deploying account contract (with sponsored fees)...");
  console.log("   This may take 2-3 minutes for proving on first run...");
  
  const deployAccountMethod = await accountManager.getDeployMethod();
  const accountTx = await deployAccountMethod
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: sponsoredPaymentMethod } })
    .wait();
  
  console.log(`✅ Account deployed in block ${accountTx.blockNumber}`);

  // Deploy the TokenContract
  console.log("\n📦 Deploying USDC TokenContract...");
  console.log("   This may take 2-3 minutes for proving...");
  
  try {
    const deployTx = TokenContract.deployWithOpts(
      { wallet, method: "constructor_with_minter" },
      "USDC",
      "USDC",
      6, // decimals
      accountAddress, // minter
      accountAddress  // upgrade_authority
    )
      .send({
        from: accountAddress,
        fee: { paymentMethod: sponsoredPaymentMethod },
      });

    // Get transaction hash
    const txHash = await deployTx.getTxHash();
    console.log(`\n⏳ Deployment transaction sent: ${txHash}`);
    console.log("   Waiting for transaction to be mined...");

    // Wait for deployment
    const token = await deployTx.deployed();
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ Token deployed successfully!");
    console.log("=".repeat(60));
    console.log(`📍 Token Address: ${token.address}`);
    console.log(`🔗 View on Explorer: https://aztecscan.xyz/address/${token.address}`);
    console.log(`👤 Deployer: ${accountAddress}`);
    console.log("=".repeat(60));

    // Test the contract - mint some tokens
    console.log("\n🧪 Testing contract - minting 1000 USDC to deployer...");
    const mintAmount = 1000n * 1000000n; // 1000 USDC with 6 decimals
    
    const mintTx = await token.methods.mint_to_public(accountAddress, mintAmount)
      .send({ 
        from: accountAddress, 
        fee: { paymentMethod: sponsoredPaymentMethod } 
      })
      .wait();
    
    console.log(`✅ Minted 1000 USDC in block ${mintTx.blockNumber}`);

    // Check balance
    const balance = await token.methods.balance_of_public(accountAddress).simulate({ from: accountAddress });
    console.log(`   Public balance: ${Number(balance) / 1000000} USDC`);

    // Save deployment info
    const deployment = {
      environment: 'devnet',
      tokenAddress: token.address.toString(),
      deployerAddress: accountAddress.toString(),
      deployerSecret: secretKey.toString(),
      deployerSalt: salt.toString(),
      nodeUrl: DEVNET_NODE_URL,
      sponsoredFpcAddress: SPONSORED_FPC_ADDRESS,
      deploymentBlock: accountTx.blockNumber,
    };

    writeFileSync("deployment.json", JSON.stringify(deployment, null, 2));
    writeFileSync(".env", generateEnvFile(deployment));
    
    console.log("\n💾 Deployment saved:");
    console.log("   - deployment.json (full details)");
    console.log("   - .env (updated with new token address)");

    console.log("\n" + "=".repeat(60));
    console.log("✨ Devnet deployment complete!");
    console.log("=".repeat(60));
    console.log("\n📚 Next steps:");
    console.log("   1. Your .env file has been updated with the new token address");
    console.log("   2. Ensure AZTEC_ENV=devnet is set in your .env");
    console.log("   3. Start the server: yarn server");
    console.log("   4. Start the dev server: yarn dev");
    console.log("\n⚠️  Important:");
    console.log("   - Save your deployer credentials from deployment.json");
    console.log("   - Transactions on devnet require proving (2-3 min each)");
    console.log("   - The deployer account has 1000 USDC for testing");
    console.log("=".repeat(60));
    
  } catch (error: any) {
    if (error.message?.includes("Timeout awaiting isMined")) {
      console.log("\n⏱️  Transaction is still being mined (this is normal on devnet).");
      console.log("   Check the explorer in a few minutes for the deployment status.");
    } else {
      console.error("\n❌ Deployment failed:", error.message || error);
      throw error;
    }
  }
}

/**
 * Generate .env file content with deployment info
 */
function generateEnvFile(deployment: any): string {
  return `# AztecPay Environment Configuration
# Set AZTEC_ENV=devnet to use devnet, otherwise defaults to localnet
AZTEC_ENV=devnet

# ============================================================
# DEVNET CONFIGURATION
# ============================================================
AZTEC_NODE_URL=${deployment.nodeUrl}
SPONSORED_FPC_ADDRESS=${deployment.sponsoredFpcAddress}

# ============================================================
# DEPLOYED CONTRACT ADDRESSES (devnet)
# ============================================================
TOKEN_ADDRESS=${deployment.tokenAddress}
DEPLOYER_ADDRESS=${deployment.deployerAddress}
DEPLOYER_SECRET=${deployment.deployerSecret}
DEPLOYER_SALT=${deployment.deployerSalt}

# ============================================================
# EVM BRIDGE CONFIGURATION (Base Sepolia)
# ============================================================
# These are used for the EVM bridge functionality
# address: 0x9845C963F28D092A2f2d063E57bAa95067B0Dd68
EVM_PRIVATE_KEY=0x22d423e3b79256b3f3bd85d6c42e04c4a2844e1512328e6aa370919d4c5e89db
EVM_RPC_URL=https://base-sepolia.g.alchemy.com/v2/qcq-0LcD1tJUBQOhKgZxp5DwcxjiQt3-
EVM_TOKEN_ADDRESS=0x8e967C9D33E2a97cca55Be55276c05EAE39c2201
`;
}

// Run the deployment
main().catch((error) => {
  console.error("\n💥 Fatal error:", error);
  process.exit(1);
});
