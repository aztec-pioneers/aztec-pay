#!/usr/bin/env node
/**
 * AztecPay Server with Integrated Deployment
 * 
 * Deploys token on startup with server-controlled minter account.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/src/artifacts/Token.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { AztecToEvmBridge } from "./bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Devnet configuration
const DEVNET_NODE_URL = process.env.AZTEC_NODE_URL || "https://devnet-6.aztec-labs.com";
const SPONSORED_FPC_ADDRESS = process.env.SPONSORED_FPC_ADDRESS || "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const FAUCET_AMOUNT = 1000n * 1000000n;
const EVM_TOKEN_ADDRESS = process.env.EVM_TOKEN_ADDRESS;
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const EVM_RPC_URL = process.env.EVM_RPC_URL || "https://sepolia.base.org";

let wallet: EmbeddedWallet;
let token: TokenContract;
let minterAddress: AztecAddress;
let minterSecret: Fr;
let minterSalt: Fr;
let bridge: AztecToEvmBridge | null = null;
let isInitialized = false;

const SERVER_STARTUP_TIMESTAMP = Date.now();

async function deploy() {
  console.log("🚀 AztecPay Server Deployment");
  console.log("=".repeat(60));
  
  const node = createAztecNodeClient(DEVNET_NODE_URL);
  console.log("✅ Connected to devnet");
  
  wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  console.log("✅ Wallet created");
  
  // Register SponsoredFPC
  const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
  if (sponsoredFpcInstance) {
    await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
  }
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
  
  // Create minter account
  minterSecret = Fr.random();
  minterSalt = Fr.random();
  const signingKey = GrumpkinScalar.random();
  
  const accountManager = await wallet.createSchnorrAccount(minterSecret, minterSalt, signingKey);
  minterAddress = accountManager.address;
  console.log(`🔑 Minter: ${minterAddress}`);
  
  // Deploy account
  console.log("⛽ Deploying minter account...");
  const deployAccountMethod = await accountManager.getDeployMethod();
  await deployAccountMethod
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod: sponsoredPaymentMethod } });
  console.log("✅ Account deployed");
  
  // Deploy token
  console.log("📦 Deploying token...");
  token = await TokenContract.deployWithOpts(
    { wallet, method: "constructor_with_minter" },
    "USDC", "USDC", 6,
    minterAddress, minterAddress
  ).send({
    from: minterAddress,
    fee: { paymentMethod: sponsoredPaymentMethod },
  });
  console.log(`✅ Token: ${token.address}`);
  
  // Save deployment
  const deployment = {
    environment: 'devnet',
    tokenAddress: token.address.toString(),
    minterAddress: minterAddress.toString(),
    minterSecret: minterSecret.toString(),
    minterSalt: minterSalt.toString(),
    nodeUrl: DEVNET_NODE_URL,
  };
  fs.writeFileSync("deployment.json", JSON.stringify(deployment, null, 2));
  
  console.log("=".repeat(60));
  return { wallet, token, minterAddress };
}

async function initialize() {
  console.log(`[Server] Startup: ${new Date().toISOString()}`);
  
  // Always deploy fresh for devnet server mode
  const deployed = await deploy();
  wallet = deployed.wallet;
  token = deployed.token;
  minterAddress = deployed.minterAddress;
  
  // Init bridge
  if (EVM_TOKEN_ADDRESS && EVM_PRIVATE_KEY) {
    console.log("[Server] Initializing bridge...");
    bridge = new AztecToEvmBridge(wallet, token, EVM_TOKEN_ADDRESS, EVM_PRIVATE_KEY, EVM_RPC_URL);
    await bridge.start();
    console.log("✅ Bridge ready");
  }
  
  isInitialized = true;
  console.log("[Server] Ready!");
}

// Express app
const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/faucet", async (req, res) => {
  if (!isInitialized) return res.status(503).json({ error: "Initializing" });
  
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: "Address required" });
    
    const recipient = AztecAddress.fromString(address);
    await wallet.registerSender(recipient, 'faucet-recipient');
    
    const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
    
    await token.methods.mint_to_public(recipient, FAUCET_AMOUNT)
      .send({ from: minterAddress, fee: { paymentMethod } });
    
    res.json({ success: true, amount: "1000" });
  } catch (error: any) {
    console.error("Faucet error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/bridge/initiate", async (req, res) => {
  if (!isInitialized) return res.status(503).json({ error: "Initializing" });
  if (!bridge) return res.status(503).json({ error: "Bridge disabled" });
  
  try {
    const { evmAddress, senderAddress } = req.body;
    if (!evmAddress) return res.status(400).json({ error: "evmAddress required" });
    
    const session = await bridge.createSession(evmAddress, senderAddress);
    res.json({
      success: true,
      aztecDepositAddress: session.aztecAddress,
      expiresAt: session.expiresAt,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/bridge/status/:aztecAddress", (req, res) => {
  if (!bridge) return res.status(503).json({ error: "Bridge disabled" });
  
  const session = bridge.getSession(req.params.aztecAddress);
  if (!session) return res.json({ status: "not_found" });
  
  const now = Date.now();
  if (now > session.expiresAt) return res.json({ status: "expired" });
  
  res.json({ status: "pending", evmAddress: session.evmAddress, expiresAt: session.expiresAt });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: isInitialized ? "ok" : "initializing",
    tokenAddress: isInitialized ? token.address.toString() : null,
    bridgeEnabled: !!bridge,
    evmTokenAddress: EVM_TOKEN_ADDRESS || null,
    serverStartupTimestamp: SERVER_STARTUP_TIMESTAMP,
    environment: 'devnet',
  });
});

app.listen(PORT, () => {
  console.log(`[Server] Running at http://localhost:${PORT}`);
  initialize().catch(err => {
    console.error("Failed to initialize:", err);
    process.exit(1);
  });
});
