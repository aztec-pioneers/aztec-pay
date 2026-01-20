import express from "express";
import cors from "cors";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";
import { setupSandbox, getTestWallet, deployToken, mintTokensPrivate, getPrivateBalance } from "./utils.js";
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

// Generate a new Aztec account
app.post("/api/account", async (_req, res) => {
  if (!isInitialized) {
    return res.status(503).json({ error: "Server is still initializing, please wait..." });
  }

  try {
    console.log("Creating new account...");
    const secret = Fr.random();
    const salt = Fr.random();
    console.log("Generated secret and salt");

    const account = await wallet.createSchnorrAccount(secret, salt);
    console.log("Account created:", account);

    res.json({
      address: account.address.toString(),
      secret: secret.toString(),
      salt: salt.toString(),
    });
  } catch (error) {
    console.error("Error creating account:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to create account: ${errorMessage}` });
  }
});

// Mint USDC to an address (faucet)
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

    console.log(`Minting ${FAUCET_AMOUNT} USDC to ${address}...`);
    await mintTokensPrivate(token, minterAddress, recipient, FAUCET_AMOUNT);

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

// Query private balance (user sends credentials, server acts as PXE)
app.post("/api/balance", async (req, res) => {
  if (!isInitialized) {
    return res.status(503).json({ error: "Server is still initializing" });
  }

  try {
    const { secret, salt } = req.body;
    if (!secret || !salt) {
      return res.status(400).json({ error: "Secret and salt are required" });
    }

    // Recreate user's account from their credentials
    const account = await wallet.createSchnorrAccount(
      Fr.fromString(secret),
      Fr.fromString(salt)
    );

    // Query balance as the user
    const balance = await getPrivateBalance(token, account.address, account.address);
    const formattedBalance = (balance / 1000000n).toString();

    res.json({ balance: formattedBalance });
  } catch (error) {
    console.error("Error getting balance:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to get balance: ${errorMessage}` });
  }
});

// Health check and config
app.get("/api/health", (_req, res) => {
  res.json({
    status: isInitialized ? "ok" : "initializing",
    tokenAddress: isInitialized ? token.address.toString() : null,
  });
});

// Start server immediately, initialize in background
app.listen(PORT, () => {
  console.log(`Faucet server running at http://localhost:${PORT}`);
  console.log("Initializing Aztec connection...");

  initialize()
    .then(() => {
      console.log("Server fully initialized and ready!");
    })
    .catch((err) => {
      console.error("Failed to initialize server:", err);
      process.exit(1);
    });
});
