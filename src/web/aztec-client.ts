/**
 * Browser-side Aztec client
 * Handles account creation, balance queries, and transfers directly in the browser.
 * Only fauceting requires the server.
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/client/bundle";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || "http://localhost:8080";

let wallet: TestWallet | null = null;
let isInitialized = false;

// Cache for created accounts
const accountCache = new Map<string, { address: AztecAddress; secret: Fr; salt: Fr }>();

/**
 * Initialize connection to Aztec node
 */
export async function initializeAztec(): Promise<void> {
  if (isInitialized) return;

  console.log("[Aztec] Connecting to node...");
  const node = createAztecNodeClient(AZTEC_NODE_URL);

  console.log("[Aztec] Creating wallet...");
  wallet = await TestWallet.create(node, { proverEnabled: false });

  isInitialized = true;
  console.log("[Aztec] Initialized successfully");
}

/**
 * Check if Aztec client is initialized
 */
export function isAztecReady(): boolean {
  return isInitialized && wallet !== null;
}

/**
 * Create or retrieve an account from cache
 */
export async function createAccount(secretHex?: string, saltHex?: string): Promise<{
  address: string;
  secret: string;
  salt: string;
}> {
  if (!wallet) throw new Error("Aztec not initialized");

  const secret = secretHex ? Fr.fromString(secretHex) : Fr.random();
  const salt = saltHex ? Fr.fromString(saltHex) : Fr.random();

  const cacheKey = `${secret.toString()}:${salt.toString()}`;

  if (accountCache.has(cacheKey)) {
    const cached = accountCache.get(cacheKey)!;
    return {
      address: cached.address.toString(),
      secret: cached.secret.toString(),
      salt: cached.salt.toString(),
    };
  }

  console.log("[Aztec] Creating account...");
  const account = await wallet.createSchnorrAccount(secret, salt);

  accountCache.set(cacheKey, { address: account.address, secret, salt });

  return {
    address: account.address.toString(),
    secret: secret.toString(),
    salt: salt.toString(),
  };
}

/**
 * Get private balance for an address
 */
export async function getBalance(tokenAddress: string, ownerAddress: string): Promise<bigint> {
  if (!wallet) throw new Error("Aztec not initialized");

  const token = await TokenContract.at(AztecAddress.fromString(tokenAddress), wallet);
  const owner = AztecAddress.fromString(ownerAddress);

  const balance = await token.methods.balance_of_private(owner).simulate({ from: owner });
  return balance;
}

/**
 * Transfer tokens privately from one account to another
 */
export async function transferPrivate(
  tokenAddress: string,
  fromSecret: string,
  fromSalt: string,
  toAddress: string,
  amount: bigint
): Promise<void> {
  if (!wallet) throw new Error("Aztec not initialized");

  // Ensure sender account is registered
  const senderAccount = await createAccount(fromSecret, fromSalt);
  const from = AztecAddress.fromString(senderAccount.address);
  const to = AztecAddress.fromString(toAddress);

  const token = await TokenContract.at(AztecAddress.fromString(tokenAddress), wallet);

  console.log(`[Aztec] Transferring ${amount} from ${from.toString()} to ${to.toString()}`);
  await token.methods.transfer_private_to_private(from, to, amount, 0n).send({ from }).wait();
  console.log("[Aztec] Transfer complete");
}

/**
 * Generate a random hex secret (32 bytes)
 */
export function generateRandomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export { Fr, AztecAddress };
