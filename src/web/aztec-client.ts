/**
 * Browser-side Aztec client
 * Handles account creation, balance queries, and transfers directly in the browser.
 * Only fauceting requires the server.
 * 
 * Supports both localnet and devnet environments via AZTEC_ENV environment variable.
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";
import { 
  AZTEC_NODE_URL, 
  IS_DEVNET, 
  SPONSORED_FPC_ADDRESS,
  logConfig 
} from "../ts/config.js";

let wallet: any = null;
let isInitialized = false;
let node: any = null;

// Cache for created accounts
const accountCache = new Map<string, { address: AztecAddress; secret: Fr; salt: Fr }>();

/**
 * Initialize connection to Aztec node
 */
export async function initializeAztec(): Promise<void> {
  if (isInitialized) return;

  // Log configuration
  logConfig();

  console.log("[Aztec] Connecting to node:", AZTEC_NODE_URL);
  node = createAztecNodeClient(AZTEC_NODE_URL);

  console.log("[Aztec] Creating wallet...");
  
  // Use appropriate wallet creation based on environment
  if (IS_DEVNET) {
    // Devnet: Use lazy-loaded TestWallet with proving enabled
    const { TestWallet } = await import("@aztec/test-wallet/client/lazy");
    wallet = await TestWallet.create(node, { proverEnabled: true });
  } else {
    // Localnet: Use bundle TestWallet with proving disabled
    const { TestWallet } = await import("@aztec/test-wallet/client/bundle");
    wallet = await TestWallet.create(node, { proverEnabled: false });
  }

  // Register SponsoredFPC on devnet
  if (IS_DEVNET && SPONSORED_FPC_ADDRESS) {
    console.log("[Aztec] Registering SponsoredFPC for devnet...");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    const { SponsoredFPCContract } = await import("@aztec/noir-contracts.js/SponsoredFPC");
    
    const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const sponsoredFpcInstance = await node.getContract(sponsoredFpcAddress);
    
    if (sponsoredFpcInstance) {
      await wallet.registerContract(sponsoredFpcInstance, SponsoredFPCContract.artifact);
      console.log("[Aztec] SponsoredFPC registered successfully");
    } else {
      console.warn("[Aztec] SponsoredFPC contract not found at expected address");
    }
  }

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
 * Get the underlying wallet (for advanced use)
 */
export function getWallet(): any {
  return wallet;
}

/**
 * Get the node client (for advanced use)
 */
export function getNode(): any {
  return node;
}

/**
 * Create or retrieve an account from cache
 * On devnet, accounts need to be deployed before use
 */
export async function createAccount(secretHex?: string, saltHex?: string, deployAccount: boolean = false): Promise<{
  address: string;
  secret: string;
  salt: string;
}> {
  if (!wallet) throw new Error("Aztec not initialized");

  const secret = secretHex ? Fr.fromString(secretHex) : Fr.random();
  const salt = saltHex ? Fr.fromString(saltHex) : Fr.random();

  const cacheKey = `${secret.toString()}:${salt.toString()}`;

  if (accountCache.has(cacheKey) && !deployAccount) {
    const cached = accountCache.get(cacheKey)!;
    return {
      address: cached.address.toString(),
      secret: cached.secret.toString(),
      salt: cached.salt.toString(),
    };
  }

  console.log("[Aztec] Creating account...");
  const account = await wallet.createSchnorrAccount(secret, salt);

  // On devnet, we may need to deploy the account
  if (deployAccount && IS_DEVNET) {
    console.log("[Aztec] Deploying account to devnet (this may take 1-2 minutes)...");
    const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    
    const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS!);
    const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
    
    const deployMethod = await account.getDeployMethod();
    await deployMethod
      .send({ from: AztecAddress.ZERO, fee: { paymentMethod } })
      .wait();
    console.log("[Aztec] Account deployed successfully");
  }

  accountCache.set(cacheKey, { address: account.address, secret, salt });

  return {
    address: account.address.toString(),
    secret: secret.toString(),
    salt: salt.toString(),
  };
}

/**
 * Deploy an account (needed for devnet before sending transactions)
 */
export async function deployAccount(secretHex: string, saltHex: string): Promise<void> {
  if (!wallet) throw new Error("Aztec not initialized");
  if (!IS_DEVNET) {
    console.log("[Aztec] Account deployment not needed on localnet");
    return;
  }
  if (!SPONSORED_FPC_ADDRESS) {
    throw new Error("SponsoredFPC address not configured for devnet");
  }

  const secret = Fr.fromString(secretHex);
  const salt = Fr.fromString(saltHex);

  console.log("[Aztec] Deploying account to devnet...");
  
  const account = await wallet.createSchnorrAccount(secret, salt);
  const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
  const { AztecAddress } = await import("@aztec/aztec.js/addresses");
  
  const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
  
  const deployMethod = await account.getDeployMethod();
  await deployMethod
    .send({ from: AztecAddress.ZERO, fee: { paymentMethod } })
    .wait();
  
  console.log("[Aztec] Account deployed successfully");
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
  
  // On devnet, we need to use sponsored fees
  if (IS_DEVNET && SPONSORED_FPC_ADDRESS) {
    const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    
    const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
    
    await token.methods.transfer_private_to_private(from, to, amount, 0n)
      .send({ from, fee: { paymentMethod } })
      .wait();
  } else {
    // Localnet: no fees needed
    await token.methods.transfer_private_to_private(from, to, amount, 0n)
      .send({ from })
      .wait();
  }
  
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
