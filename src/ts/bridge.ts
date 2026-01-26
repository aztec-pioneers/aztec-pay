import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { TestWallet } from "@aztec/test-wallet/server";
import type { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";
import type { PXE } from "@aztec/pxe/server";

// Bridge session tracking
interface BridgeSession {
  evmAddress: string;
  aztecAddress: AztecAddress;
  senderAddress?: AztecAddress; // The address that will send tokens to this deposit address
  secret: Fr;
  salt: Fr;
  createdAt: number;
  expiresAt: number;
}

const BRIDGE_SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes in ms
const POLL_INTERVAL = 5000; // Check balances every 5 seconds

// ERC20 ABI for minting
const BRIDGED_USDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
]);

export class AztecToEvmBridge {
  private sessions: Map<string, BridgeSession> = new Map();
  private processingJobs: Set<string> = new Set(); // Track jobs being processed
  private wallet: TestWallet;
  private pxe: PXE;
  private token: TokenContract;
  private evmTokenAddress: `0x${string}`;
  private evmPrivateKey: `0x${string}`;
  private evmRpcUrl: string;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(
    wallet: TestWallet,
    token: TokenContract,
    evmTokenAddress: string,
    evmPrivateKey: string,
    evmRpcUrl: string = "https://sepolia.base.org"
  ) {
    this.wallet = wallet;
    // Access the underlying PXE from the wallet (protected property)
    this.pxe = (wallet as unknown as { pxe: PXE }).pxe;
    this.token = token;
    this.evmTokenAddress = evmTokenAddress as `0x${string}`;
    this.evmPrivateKey = evmPrivateKey as `0x${string}`;
    this.evmRpcUrl = evmRpcUrl;
  }

  /**
   * Start the bridge polling loop
   */
  async start() {
    console.log("[Bridge] Starting bridge service...");

    // Clean up any leftover senders from previous sessions
    await this.cleanupLeftoverSenders();

    this.pollInterval = setInterval(() => this.pollSessions(), POLL_INTERVAL);
  }

  /**
   * Clean up any registered senders left over from previous sessions
   * This prevents accumulation across server restarts
   */
  private async cleanupLeftoverSenders() {
    try {
      const senders = await this.pxe.getSenders();
      if (senders.length > 0) {
        console.log(`[Bridge] Found ${senders.length} leftover sender(s) from previous sessions, cleaning up...`);
        for (const sender of senders) {
          await this.pxe.removeSender(sender);
          console.log(`[Bridge] Removed leftover sender ${sender.toString()}`);
        }
        console.log(`[Bridge] Cleanup complete`);
      } else {
        console.log(`[Bridge] No leftover senders to clean up`);
      }
    } catch (error) {
      console.warn(`[Bridge] Failed to clean up leftover senders:`, error);
    }
  }

  /**
   * Stop the bridge polling loop
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Create a new bridge session
   * Returns the Aztec address where user should send tokens
   * @param evmAddress - The EVM address to receive minted tokens
   * @param senderAddress - CRITICAL: The Aztec address that will send tokens to the deposit address.
   *                        Required for note discovery - the bridge PXE must register this sender
   *                        to discover the private notes.
   */
  async createSession(evmAddress: string, senderAddress?: string): Promise<{
    aztecAddress: string;
    expiresAt: number;
  }> {
    // Generate ephemeral account credentials
    const secret = Fr.random();
    const salt = Fr.random();

    // Create the ephemeral Schnorr account
    const accountManager = await this.createEphemeralAccount(secret, salt);
    const aztecAddress = accountManager.address;

    // CRITICAL: Register the sender address so the bridge can discover notes sent to the deposit address
    // Without this, the bridge PXE cannot see the private notes from the sender
    let senderAddr: AztecAddress | undefined;
    if (senderAddress) {
      senderAddr = AztecAddress.fromString(senderAddress);
      console.log(`[Bridge] Registering sender ${senderAddress} for note discovery...`);
      await this.wallet.registerSender(senderAddr);
    } else {
      console.warn(`[Bridge] WARNING: No sender address provided - note discovery may fail!`);
    }

    const now = Date.now();
    const session: BridgeSession = {
      evmAddress,
      aztecAddress,
      senderAddress: senderAddr,
      secret,
      salt,
      createdAt: now,
      expiresAt: now + BRIDGE_SESSION_TIMEOUT,
    };

    // Store session by Aztec address
    this.sessions.set(aztecAddress.toString(), session);

    console.log(`[Bridge] Created session for EVM ${evmAddress}`);
    console.log(`[Bridge] Aztec deposit address: ${aztecAddress.toString()}`);
    if (senderAddr) {
      console.log(`[Bridge] Sender address (for note discovery): ${senderAddr.toString()}`);
    }
    console.log(`[Bridge] Expires at: ${new Date(session.expiresAt).toISOString()}`);

    return {
      aztecAddress: aztecAddress.toString(),
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Create an ephemeral Schnorr account for receiving bridge deposits
   */
  private async createEphemeralAccount(secret: Fr, salt: Fr) {
    const { GrumpkinScalar } = await import("@aztec/foundation/curves/grumpkin");
    const { SchnorrAccountContract } = await import("@aztec/accounts/schnorr");
    const { AccountManager } = await import("@aztec/aztec.js/wallet");

    const signingKey = GrumpkinScalar.fromBuffer(secret.toBuffer());
    const accountManager = await AccountManager.create(
      this.wallet,
      secret,
      new SchnorrAccountContract(signingKey),
      salt
    );

    // Register the account with the wallet's PXE
    const instance = await accountManager.getInstance();
    const artifact = await accountManager.getAccountContract().getContractArtifact();
    await this.wallet.registerContract(instance, artifact, accountManager.getSecretKey());

    return accountManager;
  }

  /**
   * Poll all active sessions for balance changes
   */
  private async pollSessions() {
    const now = Date.now();

    for (const [aztecAddr, session] of this.sessions.entries()) {
      // Skip if already being processed
      if (this.processingJobs.has(aztecAddr)) {
        continue;
      }

      // Check if session expired
      if (now > session.expiresAt) {
        console.log(`[Bridge] Session expired for ${session.evmAddress}`);
        // Clean up registered sender to prevent accumulation
        if (session.senderAddress) {
          await this.pxe.removeSender(session.senderAddress);
          console.log(`[Bridge] Cleaned up sender ${session.senderAddress.toString()}`);
        }
        this.sessions.delete(aztecAddr);
        continue;
      }

      // Check private balance - ephemeral accounts are created by server's PXE so it should see notes
      try {
        // Sync private state to discover new notes
        console.log(`[Bridge] Syncing private state for ${aztecAddr.slice(0, 10)}...`);
        try {
          await this.token.methods.sync_private_state().simulate({ from: session.aztecAddress });
        } catch (syncError) {
          console.warn(`[Bridge] Sync failed:`, syncError);
        }

        console.log(`[Bridge] Checking private balance for ${aztecAddr.slice(0, 10)}...`);
        const balance = await this.checkPrivateBalance(session.aztecAddress);
        console.log(`[Bridge] Private balance: ${balance}`);

        if (balance > 0n) {
          console.log(`[Bridge] Detected private deposit of ${balance} to ${aztecAddr}`);

          // Mark as processing IMMEDIATELY to prevent duplicate processing
          this.processingJobs.add(aztecAddr);
          console.log(`[Bridge] Marked job as processing for ${aztecAddr.slice(0, 10)}`);

          console.log(`[Bridge] Minting ${balance} to EVM address ${session.evmAddress}`);

          // Mint on EVM
          try {
            await this.mintOnEvm(session.evmAddress, balance);
          } catch (mintError) {
            console.error(`[Bridge] EVM MINT FAILED:`, mintError);
            // Remove from processing to allow retry
            this.processingJobs.delete(aztecAddr);
            continue; // Skip cleanup, allow retry on next poll
          }

          // Clean up registered sender to prevent accumulation
          if (session.senderAddress) {
            await this.pxe.removeSender(session.senderAddress);
            console.log(`[Bridge] Cleaned up sender ${session.senderAddress.toString()}`);
          }

          // Remove from processing jobs
          this.processingJobs.delete(aztecAddr);

          // Remove session after successful bridge
          this.sessions.delete(aztecAddr);
          console.log(`[Bridge] Bridge completed for ${session.evmAddress}`);
        }
      } catch (error) {
        console.error(`[Bridge] Error checking balance for ${aztecAddr}:`, error);
        // Remove from processing if it was added (allows retry on next poll)
        this.processingJobs.delete(aztecAddr);
      }
    }
  }

  /**
   * Check private balance of an Aztec address
   * Since ephemeral accounts are created by the server's PXE, it should be able to decrypt notes
   */
  private async checkPrivateBalance(address: AztecAddress): Promise<bigint> {
    try {
      const balance = await this.token.methods
        .balance_of_private(address)
        .simulate({ from: address });

      return balance;
    } catch (error) {
      console.error(`[Bridge] Error checking private balance for ${address}:`, error);
      return 0n;
    }
  }

  /**
   * Mint tokens on EVM (Base Sepolia)
   */
  private async mintOnEvm(to: string, amount: bigint) {
    console.log(`[Bridge] mintOnEvm called - to: ${to}, amount: ${amount}`);
    console.log(`[Bridge] EVM config - RPC: ${this.evmRpcUrl}, Token: ${this.evmTokenAddress}`);

    const account = privateKeyToAccount(this.evmPrivateKey);
    console.log(`[Bridge] Minter account: ${account.address}`);

    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(this.evmRpcUrl),
    });

    console.log(`[Bridge] Sending mint transaction...`);
    const hash = await walletClient.writeContract({
      address: this.evmTokenAddress,
      abi: BRIDGED_USDC_ABI,
      functionName: "mint",
      args: [to as `0x${string}`, amount],
    });

    console.log(`[Bridge] EVM mint tx submitted: ${hash}`);
    console.log(`[Bridge] View on BaseScan: https://sepolia.basescan.org/tx/${hash}`);

    // Wait for confirmation
    console.log(`[Bridge] Waiting for transaction confirmation...`);
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.evmRpcUrl),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[Bridge] EVM mint confirmed - status: ${receipt.status}, block: ${receipt.blockNumber}`);
  }

  /**
   * Get active sessions count (for monitoring)
   */
  getActiveSessionsCount(): number {
    return this.sessions.size;
  }

  /**
   * Get session info by Aztec address
   */
  getSession(aztecAddress: string): BridgeSession | undefined {
    return this.sessions.get(aztecAddress);
  }
}

/**
 * Deploy BridgedUSDC contract to Base Sepolia
 */
export async function deployBridgedUSDC(privateKey: string, rpcUrl: string = "https://sepolia.base.org"): Promise<string> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  // BridgedUSDC bytecode - we'll use forge to get this
  // For now, deploy using forge script and pass the address
  console.log("[Bridge] Note: Deploy BridgedUSDC using forge script first");
  console.log("[Bridge] Run: yarn evm:deploy");

  throw new Error("BridgedUSDC must be deployed via forge script first. Set EVM_TOKEN_ADDRESS env var.");
}
