import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/src/artifacts/Token.js";
import { setupSandbox, getTestWallet, deployToken, mintTokensPublic } from "./utils.js";
import { AztecToEvmBridge } from "./bridge.js";
import {
  AZTEC_NODE_URL,
  IS_DEVNET,
  IS_LOCALNET,
  SPONSORED_FPC_ADDRESS,
  logConfig
} from "./config.js";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const FAUCET_AMOUNT = 1000n * 1000000n; // 1000 USDC with 6 decimals

// Server startup timestamp - used by frontend to detect server restarts
const SERVER_STARTUP_TIMESTAMP = Date.now();
console.log(`[Server] Startup timestamp: ${SERVER_STARTUP_TIMESTAMP} (${new Date(SERVER_STARTUP_TIMESTAMP).toISOString()})`)

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

// Try to load Aztec token address from deployment file or env
function getAztecTokenAddress(): string | undefined {
  if (process.env.TOKEN_ADDRESS) {
    return process.env.TOKEN_ADDRESS;
  }

  // Try to read from deployment file
  const deploymentPath = path.join(__dirname, "../../deployment.json");
  try {
    if (fs.existsSync(deploymentPath)) {
      const data = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
      if (data.tokenAddress) {
        console.log(`[Config] Loaded Aztec token address from deployment.json: ${data.tokenAddress}`);
        return data.tokenAddress;
      }
    }
  } catch (error) {
    console.log("[Config] Could not read deployment.json:", error);
  }

  return undefined;
}

// Environment variables for bridge
const EVM_TOKEN_ADDRESS = getEvmTokenAddress();
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const EVM_RPC_URL = process.env.EVM_RPC_URL || "https://sepolia.base.org";
const TOKEN_ADDRESS = getAztecTokenAddress();

let wallet: EmbeddedWallet;
let token: TokenContract;
let minterAddress: AztecAddress;
let bridge: AztecToEvmBridge | null = null;
let isInitialized = false;

async function initialize() {
  // Log configuration
  logConfig();

  console.log(`[Server] Connecting to Aztec at ${AZTEC_NODE_URL}...`);
  const node = await setupSandbox();

  console.log("[Server] Setting up wallet...");
  const result = await getTestWallet(node);
  wallet = result.wallet;

  // For devnet, use existing deployed token and minter account
  if (IS_DEVNET && TOKEN_ADDRESS) {
    console.log(`[Server] Using existing token from deployment.json: ${TOKEN_ADDRESS}`);
    token = await TokenContract.at(AztecAddress.fromString(TOKEN_ADDRESS), wallet);
    
    // Load minter account from deployment.json
    const deploymentPath = path.join(__dirname, "../../deployment.json");
    let minterSet = false;
    
    try {
      if (fs.existsSync(deploymentPath)) {
        const data = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
        
        // Support both old (deployer) and new (minter) credential formats
        const secretKey = data.minterSecret || data.deployerSecret;
        const salt = data.minterSalt || data.deployerSalt;
        const address = data.minterAddress || data.deployerAddress;
        
        if (secretKey && salt && address) {
          const { Fr } = await import("@aztec/aztec.js/fields");
          const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
          
          console.log("[Server] Loading minter account for faucet...");
          const secret = Fr.fromString(secretKey);
          const saltFr = Fr.fromString(salt);
          
          const minterAccount = await wallet.createSchnorrAccount(secret, saltFr);
          minterAddress = minterAccount.address;
          
          // Verify the address matches
          if (minterAddress.toString() !== address) {
            console.warn("[Server] Minter address mismatch! Expected:", address, "Got:", minterAddress.toString());
            // Use the address from file anyway
            minterAddress = AztecAddress.fromString(address);
          }
          
          // Try to deploy the account on devnet (may already be deployed)
          console.log("[Server] Ensuring minter account is deployed...");
          try {
            const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
            const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
            
            const deployMethod = await minterAccount.getDeployMethod();
            await deployMethod
              .send({ from: AztecAddress.ZERO, fee: { paymentMethod } });
            console.log("[Server] Minter account deployed");
          } catch (deployError: any) {
            // Account might already be deployed
            if (deployError.message?.includes("already deployed") || deployError.message?.includes("nullifier") || deployError.message?.includes("existing")) {
              console.log("[Server] Minter account already deployed");
            } else {
              throw deployError;
            }
          }
          
          minterSet = true;
          console.log(`[Server] Using minter account: ${minterAddress.toString()}`);
        }
      }
    } catch (error: any) {
      console.error("[Server] Failed to load minter account:", error.message);
    }
    
    // Fallback to first test account
    if (!minterSet) {
      minterAddress = result.accounts[0];
      console.warn("[Server] Warning: Using test account for minter - faucet will likely fail!");
      console.warn("[Server] Please run: yarn deploy:devnet:server");
    }
  } else {
    // Localnet: deploy new token
    minterAddress = result.accounts[0];
    console.log("[Server] Deploying new USDC token...");
    token = await deployToken(wallet, minterAddress, "USDC", "USDC", 6);
    
    // Save deployment info for localnet
    const deployment = {
      environment: 'localnet',
      tokenAddress: token.address.toString(),
      minterAddress: minterAddress.toString(),
    };
    fs.writeFileSync("deployment.json", JSON.stringify(deployment, null, 2));
    console.log("[Server] Deployment saved to deployment.json");
  }

  console.log(`[Server] Token initialized at ${token.address.toString()}`);
  console.log(`[Server] Minter address: ${minterAddress.toString()}`);

  // Initialize bridge if EVM token address and private key are set
  if (EVM_TOKEN_ADDRESS && EVM_PRIVATE_KEY) {
    console.log("[Server] Initializing Aztec -> EVM bridge...");
    console.log(`  EVM RPC: ${EVM_RPC_URL}`);
    bridge = new AztecToEvmBridge(wallet, token, EVM_TOKEN_ADDRESS, EVM_PRIVATE_KEY, EVM_RPC_URL);
    await bridge.start();
    console.log(`[Server] Bridge initialized with EVM token at ${EVM_TOKEN_ADDRESS}`);
  } else {
    console.log("[Server] Bridge disabled - set EVM_TOKEN_ADDRESS and EVM_PRIVATE_KEY to enable");
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
    await wallet.registerSender(recipient, 'faucet-recipient');

    // Use public mint for both localnet and devnet
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
    const { mintTokensPrivate, transferPrivate } = await import("./utils.js");
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
    serverStartupTimestamp: SERVER_STARTUP_TIMESTAMP,
    environment: IS_DEVNET ? 'devnet' : 'localnet',
    nodeUrl: AZTEC_NODE_URL,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] Running at http://localhost:${PORT}`);
  console.log("[Server] Initializing Aztec connection...");

  initialize()
    .then(() => {
      console.log("[Server] Fully initialized and ready!");
      console.log("Endpoints:");
      console.log("  POST /api/faucet - Get test USDC");
      console.log("  POST /api/bridge/initiate - Start Aztec->EVM bridge");
      console.log("  GET  /api/bridge/status/:aztecAddress - Check bridge status");
      console.log("  GET  /api/health - Server health check");
    })
    .catch((err) => {
      console.error("[Server] Failed to initialize:", err);
      process.exit(1);
    });
});
