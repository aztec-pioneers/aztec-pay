import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";
import { setupSandbox, getTestWallet, deployToken, mintTokensPrivate, mintTokensPublic } from "./utils.js";
import { AztecToEvmBridge } from "./bridge.js";
import type { TestWallet } from "@aztec/test-wallet/server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const FAUCET_AMOUNT = 1000n * 1000000n; // 1000 USDC with 6 decimals

// Try to load EVM token address from deployment file if not set via env
function getEvmTokenAddress(): string | undefined {
  if (process.env.EVM_TOKEN_ADDRESS) {
    return process.env.EVM_TOKEN_ADDRESS;
  }

  // Try to read from deployment file
  const deploymentPath = path.join(__dirname, "../../evm-deployment.json");
  try {
    if (fs.existsSync(deploymentPath)) {
      const data = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
      if (data.address) {
        console.log(`[Config] Loaded EVM token address from evm-deployment.json: ${data.address}`);
        return data.address;
      }
    }
  } catch (error) {
    console.log("[Config] Could not read evm-deployment.json:", error);
  }

  return undefined;
}

// Environment variables for bridge
const EVM_TOKEN_ADDRESS = getEvmTokenAddress();
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const EVM_RPC_URL = process.env.EVM_RPC_URL || "https://sepolia.base.org";

let wallet: TestWallet;
let token: TokenContract;
let minterAddress: AztecAddress;
let bridge: AztecToEvmBridge | null = null;
let isInitialized = false;

async function initialize() {
  console.log("Connecting to Aztec sandbox...");
  const node = await setupSandbox();

  console.log("Setting up wallet...");
  const result = await getTestWallet(node);
  wallet = result.wallet;
  minterAddress = result.accounts[0];

  console.log("Deploying USDC token...");
  token = await deployToken(wallet, minterAddress, "USDC", "USDC", 6);

  console.log(`Server initialized with token at ${token.address.toString()}`);
  console.log(`Minter address: ${minterAddress.toString()}`);

  // Initialize bridge if EVM token address and private key are set
  if (EVM_TOKEN_ADDRESS && EVM_PRIVATE_KEY) {
    console.log("Initializing Aztec -> EVM bridge...");
    console.log(`  EVM RPC: ${EVM_RPC_URL}`);
    bridge = new AztecToEvmBridge(wallet, token, EVM_TOKEN_ADDRESS, EVM_PRIVATE_KEY, EVM_RPC_URL);
    bridge.start();
    console.log(`Bridge initialized with EVM token at ${EVM_TOKEN_ADDRESS}`);
  } else {
    console.log("Bridge disabled - set EVM_TOKEN_ADDRESS and EVM_PRIVATE_KEY to enable");
  }

  isInitialized = true;
}

const app = express();
app.use(cors());
app.use(express.json());

// Faucet - mint USDC to any address
app.post("/api/faucet", async (req, res) => {
  if (!isInitialized) {
    return res.status(503).json({ error: "Server is still initializing, please wait..." });
  }

  try {
    const { address } = req.body;
    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }

    const recipient = AztecAddress.fromString(address);

    // Register the recipient so the server's PXE can send to them
    console.log(`[Faucet] Registering recipient ${address}...`);
    await wallet.registerSender(recipient);

    // Using public mint for now to debug - private note discovery seems broken
    console.log(`[Faucet] Minting 1000 USDC (PUBLIC) to ${address}...`);
    await mintTokensPublic(token, minterAddress, recipient, FAUCET_AMOUNT);
    console.log(`[Faucet] Mint complete to ${address}`);

    res.json({
      success: true,
      amount: "1000",
    });
  } catch (error) {
    console.error("Error minting tokens:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to mint tokens: ${errorMessage}` });
  }
});

// Bridge - Initiate Aztec -> EVM bridge
// Returns an ephemeral Aztec address where user should send tokens
app.post("/api/bridge/initiate", async (req, res) => {
  if (!isInitialized) {
    return res.status(503).json({ error: "Server is still initializing, please wait..." });
  }

  if (!bridge) {
    return res.status(503).json({ error: "Bridge is not enabled. Set EVM_TOKEN_ADDRESS env var." });
  }

  try {
    const { evmAddress, senderAddress } = req.body;
    if (!evmAddress) {
      return res.status(400).json({ error: "evmAddress is required" });
    }

    // Validate EVM address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
      return res.status(400).json({ error: "Invalid EVM address format" });
    }

    // Warn if sender address is not provided (required for note discovery)
    if (!senderAddress) {
      console.warn(`[Bridge] WARNING: No senderAddress provided - note discovery may fail!`);
    }

    console.log(`[Bridge] Initiating bridge for EVM address ${evmAddress}`);
    if (senderAddress) {
      console.log(`[Bridge] Sender address (for note discovery): ${senderAddress}`);
    }

    const session = await bridge.createSession(evmAddress, senderAddress);

    res.json({
      success: true,
      aztecDepositAddress: session.aztecAddress,
      expiresAt: session.expiresAt,
      message: "Send private USDC to the Aztec address within 5 minutes to bridge to EVM",
    });
  } catch (error) {
    console.error("Error initiating bridge:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to initiate bridge: ${errorMessage}` });
  }
});

// Bridge status - Check status of a bridge session
app.get("/api/bridge/status/:aztecAddress", (req, res) => {
  if (!bridge) {
    return res.status(503).json({ error: "Bridge is not enabled" });
  }

  const { aztecAddress } = req.params;
  const session = bridge.getSession(aztecAddress);

  if (!session) {
    return res.json({
      status: "not_found",
      message: "Session not found or expired",
    });
  }

  const now = Date.now();
  if (now > session.expiresAt) {
    return res.json({
      status: "expired",
      message: "Session expired without receiving payment",
    });
  }

  res.json({
    status: "pending",
    evmAddress: session.evmAddress,
    expiresAt: session.expiresAt,
    remainingTime: Math.max(0, session.expiresAt - now),
  });
});

// Test endpoint - Transfer private tokens (for bridge testing)
// In production, users would do this from their browser wallet
app.post("/api/test/transfer-private", async (req, res) => {
  if (!isInitialized) {
    return res.status(503).json({ error: "Server is still initializing, please wait..." });
  }

  try {
    const { to, amount } = req.body;
    if (!to || !amount) {
      return res.status(400).json({ error: "to and amount are required" });
    }

    const recipient = AztecAddress.fromString(to);
    const transferAmount = BigInt(amount);

    console.log(`[Test] Transferring ${transferAmount} USDC privately to ${to}...`);

    // First mint to minter's private balance, then transfer
    // This simulates a user sending private tokens
    await mintTokensPrivate(token, minterAddress, recipient, transferAmount);

    console.log(`[Test] Private transfer complete to ${to}`);

    res.json({
      success: true,
      amount: amount.toString(),
      to,
    });
  } catch (error) {
    console.error("Error in test transfer:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to transfer: ${errorMessage}` });
  }
});

// Health check and config - returns token address for browser to use
app.get("/api/health", (_req, res) => {
  res.json({
    status: isInitialized ? "ok" : "initializing",
    tokenAddress: isInitialized ? token.address.toString() : null,
    bridgeEnabled: !!bridge,
    evmTokenAddress: EVM_TOKEN_ADDRESS || null,
    activeBridgeSessions: bridge?.getActiveSessionsCount() || 0,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Initializing Aztec connection...");

  initialize()
    .then(() => {
      console.log("Server fully initialized and ready!");
      console.log("Endpoints:");
      console.log("  POST /api/faucet - Get test USDC");
      console.log("  POST /api/bridge/initiate - Start Aztec->EVM bridge");
      console.log("  GET  /api/bridge/status/:aztecAddress - Check bridge status");
      console.log("  GET  /api/health - Server health check");
    })
    .catch((err) => {
      console.error("Failed to initialize server:", err);
      process.exit(1);
    });
});
