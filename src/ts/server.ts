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
import type { AztecNode } from "@aztec/aztec.js/node";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Anvil (local L1) config for fee juice bridging
const ANVIL_RPC_URL = process.env.ANVIL_RPC_URL || 'http://localhost:8545';
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

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
let sponsoredFpcAddress: string | null = null;
let bridge: AztecToEvmBridge | null = null;
let isInitialized = false;

/**
 * Fund the canonical SponsoredFPC with fee juice by bridging from L1 (Anvil).
 * The FPC is pre-deployed on the sandbox but needs fee juice to sponsor txs.
 */
async function fundFPCWithFeeJuice(
  node: AztecNode,
  fpcAddress: AztecAddress,
  feePayerAddress: AztecAddress
): Promise<void> {
  const { FeeJuiceContract } = await import('@aztec/aztec.js/protocol');
  const feeJuice = FeeJuiceContract.at(wallet);

  // Check if FPC already has fee juice
  const balance = await feeJuice.methods.balance_of_public(fpcAddress).simulate({ from: feePayerAddress });
  if (balance > 0n) {
    console.log(`[Server] SponsoredFPC already has ${balance} fee juice, skipping funding`);
    return;
  }

  console.log('[Server] SponsoredFPC has no fee juice, bridging from L1...');
  const { createExtendedL1Client } = await import('@aztec/ethereum/client');
  const { L1FeeJuicePortalManager } = await import('@aztec/aztec.js/ethereum');
  const { createLogger } = await import('@aztec/foundation/log');
  const { foundry } = await import('viem/chains');

  // Create L1 client with Anvil's default funded account
  const l1Client = createExtendedL1Client([ANVIL_RPC_URL], ANVIL_PRIVATE_KEY, foundry);
  const logger = createLogger('fee-juice-funding');
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, logger);

  // Bridge fee juice to the FPC (mint=true uses the faucet handler on L1)
  // The faucet handler requires exactly 1000 * 10^18 per mint
  const FUND_AMOUNT = 1000n * 10n ** 18n;
  console.log(`[Server] Bridging ${FUND_AMOUNT} fee juice from L1 to FPC...`);
  const claim = await portalManager.bridgeTokensPublic(fpcAddress, FUND_AMOUNT, true);
  console.log(`[Server] Fee juice deposited on L1 (messageLeafIndex: ${claim.messageLeafIndex})`);

  // Wait for the L1→L2 message to be included by the sequencer, then claim on L2
  const MAX_RETRIES = 30;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Server] Claiming fee juice on L2 (attempt ${attempt}/${MAX_RETRIES})...`);
      await feeJuice.methods.claim(
        fpcAddress,
        claim.claimAmount,
        claim.claimSecret,
        claim.messageLeafIndex
      ).send({ from: feePayerAddress });

      console.log('[Server] SponsoredFPC funded with fee juice successfully!');
      return;
    } catch (error: any) {
      const msg = error?.message || '';
      // Message not yet available in L2 inbox — wait and retry
      if (msg.includes('Message not in state') || msg.includes('not found') || msg.includes('leaf') || msg.includes('nothing to prove')) {
        if (attempt < MAX_RETRIES) {
          console.log(`[Server] L1→L2 message not yet available, waiting... (attempt ${attempt})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error('Failed to claim fee juice after max retries');
}

async function initialize() {
  // Log configuration
  logConfig();

  console.log(`[Server] Connecting to Aztec at ${AZTEC_NODE_URL}...`);
  const node = await setupSandbox();

  console.log("[Server] Setting up wallet...");
  const result = await getTestWallet(node);
  wallet = result.wallet;

  // Setup SponsoredFPC for fee payment
  if (IS_LOCALNET) {
    // Localnet: the canonical SponsoredFPC is pre-deployed on the sandbox.
    // Just verify it exists and fund it with fee juice so it can sponsor txs.
    const fpcAddr = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const fpcInstance = await node.getContract(fpcAddr);
    if (fpcInstance) {
      sponsoredFpcAddress = SPONSORED_FPC_ADDRESS;
      console.log(`[Server] Canonical SponsoredFPC found at ${sponsoredFpcAddress}`);

      // Check if it has fee juice, fund if needed
      try {
        const feePayerAddress = result.accounts[0];
        await fundFPCWithFeeJuice(node, fpcAddr, feePayerAddress);
      } catch (error) {
        console.error('[Server] Failed to fund SponsoredFPC:', error);
        console.warn('[Server] FPC exists but may not have fee juice - claim flow may fail');
      }
    } else {
      console.warn(`[Server] Canonical SponsoredFPC NOT found at ${SPONSORED_FPC_ADDRESS}`);
      console.warn('[Server] Claim flow will not work without a SponsoredFPC');
    }
  } else if (SPONSORED_FPC_ADDRESS) {
    // Devnet: verify existing FPC exists on-chain
    const fpcAddr = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const fpcInstance = await node.getContract(fpcAddr);
    if (fpcInstance) {
      sponsoredFpcAddress = SPONSORED_FPC_ADDRESS;
      console.log(`[Server] SponsoredFPC verified at ${sponsoredFpcAddress}`);
    } else {
      sponsoredFpcAddress = null;
      console.log(`[Server] SponsoredFPC NOT found at ${SPONSORED_FPC_ADDRESS} - transactions will be sent without fee payment`);
    }
  }

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
      sponsoredFpcAddress,
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
    sponsoredFpcAddress,
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
