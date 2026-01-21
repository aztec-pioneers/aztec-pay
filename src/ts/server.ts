import express from "express";
import cors from "cors";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";
import { setupSandbox, getTestWallet, deployToken, mintTokensPrivate, mintTokensPublic } from "./utils.js";
import type { TestWallet } from "@aztec/test-wallet/server";

const PORT = 3000;
const FAUCET_AMOUNT = 1000n * 1000000n; // 1000 USDC with 6 decimals

let wallet: TestWallet;
let token: TokenContract;
let minterAddress: AztecAddress;
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
  isInitialized = true;
}

const app = express();
app.use(cors());
app.use(express.json());

// Faucet - mint USDC to any address (server's only job)
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

// Health check and config - returns token address for browser to use
app.get("/api/health", (_req, res) => {
  res.json({
    status: isInitialized ? "ok" : "initializing",
    tokenAddress: isInitialized ? token.address.toString() : null,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Initializing Aztec connection...");

  initialize()
    .then(() => {
      console.log("Server fully initialized and ready!");
      console.log("Server only handles faucet requests. All other operations happen in browser.");
    })
    .catch((err) => {
      console.error("Failed to initialize server:", err);
      process.exit(1);
    });
});
