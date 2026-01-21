import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { TestWallet } from "@aztec/test-wallet/server";
import type { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";

// Bridge session tracking
interface BridgeSession {
  evmAddress: string;
  aztecAddress: AztecAddress;
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
  private wallet: TestWallet;
  private token: TokenContract;
  private evmTokenAddress: `0x${string}`;
  private evmPrivateKey: `0x${string}`;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(
    wallet: TestWallet,
    token: TokenContract,
    evmTokenAddress: string,
    evmPrivateKey: string
  ) {
    this.wallet = wallet;
    this.token = token;
    this.evmTokenAddress = evmTokenAddress as `0x${string}`;
    this.evmPrivateKey = evmPrivateKey as `0x${string}`;
  }

  /**
   * Start the bridge polling loop
   */
  start() {
    console.log("[Bridge] Starting bridge service...");
    this.pollInterval = setInterval(() => this.pollSessions(), POLL_INTERVAL);
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
   */
  async createSession(evmAddress: string): Promise<{
    aztecAddress: string;
    expiresAt: number;
  }> {
    // Generate ephemeral account credentials
    const secret = Fr.random();
    const salt = Fr.random();

    // Create the ephemeral Schnorr account
    const accountManager = await this.createEphemeralAccount(secret, salt);
    const aztecAddress = accountManager.address;

    const now = Date.now();
    const session: BridgeSession = {
      evmAddress,
      aztecAddress,
      secret,
      salt,
      createdAt: now,
      expiresAt: now + BRIDGE_SESSION_TIMEOUT,
    };

    // Store session by Aztec address
    this.sessions.set(aztecAddress.toString(), session);

    console.log(`[Bridge] Created session for EVM ${evmAddress}`);
    console.log(`[Bridge] Aztec deposit address: ${aztecAddress.toString()}`);
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
      // Check if session expired
      if (now > session.expiresAt) {
        console.log(`[Bridge] Session expired for ${session.evmAddress}`);
        this.sessions.delete(aztecAddr);
        continue;
      }

      // Check private balance - ephemeral accounts are created by server's PXE so it should see notes
      try {
        console.log(`[Bridge] Checking private balance for ${aztecAddr.slice(0, 10)}...`);
        const balance = await this.checkPrivateBalance(session.aztecAddress);
        console.log(`[Bridge] Private balance: ${balance}`);

        if (balance > 0n) {
          console.log(`[Bridge] ✓ Detected private deposit of ${balance} to ${aztecAddr}`);
          console.log(`[Bridge] Minting ${balance} to EVM address ${session.evmAddress}`);

          // Mint on EVM
          await this.mintOnEvm(session.evmAddress, balance);

          // Remove session after successful bridge
          this.sessions.delete(aztecAddr);
          console.log(`[Bridge] Bridge completed for ${session.evmAddress}`);
        }
      } catch (error) {
        console.error(`[Bridge] Error checking balance for ${aztecAddr}:`, error);
      }
    }
  }

  /**
   * Check private balance of an Aztec address
   * Since ephemeral accounts are created by the server's PXE, it should be able to decrypt notes
   */
  private async checkPrivateBalance(address: AztecAddress): Promise<bigint> {
    try {
      // Sync private state first to discover any new notes
      await this.token.methods.sync_private_state().simulate({ from: address });

      // Query private balance
      const balance = await this.token.methods
        .balance_of_private(address)
        .simulate({ from: address });

      return balance;
    } catch (error) {
      // If error, assume balance is 0
      console.error(`[Bridge] Error checking private balance for ${address}:`, error);
      return 0n;
    }
  }

  /**
   * Mint tokens on EVM (Anvil)
   */
  private async mintOnEvm(to: string, amount: bigint) {
    const account = privateKeyToAccount(this.evmPrivateKey);

    const walletClient = createWalletClient({
      account,
      chain: foundry,
      transport: http("http://127.0.0.1:8545"),
    });

    const hash = await walletClient.writeContract({
      address: this.evmTokenAddress,
      abi: BRIDGED_USDC_ABI,
      functionName: "mint",
      args: [to as `0x${string}`, amount],
    });

    console.log(`[Bridge] EVM mint tx: ${hash}`);

    // Wait for confirmation
    const publicClient = createPublicClient({
      chain: foundry,
      transport: http("http://127.0.0.1:8545"),
    });

    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[Bridge] EVM mint confirmed`);
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
 * Deploy BridgedUSDC contract to Anvil
 */
export async function deployBridgedUSDC(privateKey: string): Promise<string> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  });

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  });

  // BridgedUSDC bytecode - we'll use forge to get this
  // For now, deploy using forge script and pass the address
  console.log("[Bridge] Note: Deploy BridgedUSDC using forge script first");
  console.log("[Bridge] Run: cd evm && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <key>");

  throw new Error("BridgedUSDC must be deployed via forge script first. Set EVM_TOKEN_ADDRESS env var.");
}
