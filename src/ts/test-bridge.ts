/**
 * Bridge Integration Test Script
 *
 * Tests the complete Aztec -> EVM bridge flow:
 * 1. Check initial EVM balance (should be 0)
 * 2. Mint USDC on Aztec side
 * 3. Initiate bridge session
 * 4. Transfer to bridge ephemeral address
 * 5. Wait for bridge to detect and mint on EVM
 * 6. Verify EVM balance increased
 */

import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import "dotenv/config";

const SERVER_URL = "http://localhost:3000";
const EVM_RPC_URL = process.env.EVM_RPC_URL || "https://sepolia.base.org";
const BRIDGE_AMOUNT = 100; // 100 USDC

// Test EVM address - the address from EVM_PRIVATE_KEY in .env
const TEST_EVM_ADDRESS = "0x9845C963F28D092A2f2d063E57bAa95067B0Dd68";

// ERC20 ABI for balance check
const ERC20_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
]);

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  if (data !== undefined) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60) + "\n");
}

async function getEvmBalance(tokenAddress: string, account: string): Promise<bigint> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(EVM_RPC_URL),
  });

  try {
    const balance = await client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account as `0x${string}`],
    });
    return balance as bigint;
  } catch (error) {
    return 0n;
  }
}

async function checkServerHealth(): Promise<{
  tokenAddress: string;
  evmTokenAddress: string;
  bridgeEnabled: boolean;
} | null> {
  try {
    const response = await fetch(`${SERVER_URL}/api/health`);
    const data = await response.json();

    if (data.status !== "ok") {
      return null;
    }

    return {
      tokenAddress: data.tokenAddress,
      evmTokenAddress: data.evmTokenAddress,
      bridgeEnabled: data.bridgeEnabled,
    };
  } catch (error) {
    return null;
  }
}

async function mintOnAztec(address: string): Promise<boolean> {
  try {
    log(`Requesting faucet mint for ${address}...`);
    const response = await fetch(`${SERVER_URL}/api/faucet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });

    const data = await response.json();
    if (data.success) {
      log(`✓ Minted ${data.amount} USDC on Aztec`);
      return true;
    } else {
      log(`✗ Mint failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    log(`✗ Mint request failed:`, error);
    return false;
  }
}

async function transferPrivateToAddress(to: string, amount: number): Promise<boolean> {
  try {
    log(`Transferring ${amount} USDC privately to ${to}...`);
    const response = await fetch(`${SERVER_URL}/api/test/transfer-private`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, amount: amount * 1000000 }), // Convert to 6 decimals
    });

    const data = await response.json();
    if (data.success) {
      log(`✓ Transferred ${amount} USDC privately`);
      return true;
    } else {
      log(`✗ Transfer failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    log(`✗ Transfer request failed:`, error);
    return false;
  }
}

async function initiateBridge(evmAddress: string, senderAddress?: string): Promise<{
  aztecDepositAddress: string;
  expiresAt: number;
} | null> {
  try {
    log(`Initiating bridge for EVM address ${evmAddress}...`);
    if (senderAddress) {
      log(`  Sender address (for note discovery): ${senderAddress}`);
    }

    const response = await fetch(`${SERVER_URL}/api/bridge/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evmAddress, senderAddress }),
    });

    const data = await response.json();
    if (data.success) {
      log(`✓ Bridge session created`);
      log(`  Aztec deposit address: ${data.aztecDepositAddress}`);
      log(`  Expires at: ${new Date(data.expiresAt).toISOString()}`);
      return {
        aztecDepositAddress: data.aztecDepositAddress,
        expiresAt: data.expiresAt,
      };
    } else {
      log(`✗ Bridge initiation failed: ${data.error}`);
      return null;
    }
  } catch (error) {
    log(`✗ Bridge request failed:`, error);
    return null;
  }
}

async function checkBridgeStatus(aztecAddress: string): Promise<string> {
  try {
    const response = await fetch(`${SERVER_URL}/api/bridge/status/${aztecAddress}`);
    const data = await response.json();
    return data.status;
  } catch (error) {
    return "error";
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  logSection("AZTEC -> EVM BRIDGE INTEGRATION TEST");

  // Step 1: Check server health
  logSection("Step 1: Checking Server Status");

  log("Connecting to server...");
  const health = await checkServerHealth();

  if (!health) {
    log("✗ Server is not ready. Make sure to run: yarn server");
    process.exit(1);
  }

  log(`✓ Server is ready`);
  log(`  Aztec Token: ${health.tokenAddress}`);
  log(`  EVM Token: ${health.evmTokenAddress || "Not configured"}`);
  log(`  Bridge Enabled: ${health.bridgeEnabled}`);

  if (!health.bridgeEnabled || !health.evmTokenAddress) {
    log("\n✗ Bridge is not enabled!");
    log("  Start the server with: EVM_TOKEN_ADDRESS=<address> yarn server");
    process.exit(1);
  }

  // Step 2: Check initial EVM balance
  logSection("Step 2: Checking Initial EVM Balance");

  const initialEvmBalance = await getEvmBalance(health.evmTokenAddress, TEST_EVM_ADDRESS);
  log(`EVM Address: ${TEST_EVM_ADDRESS}`);
  log(`Initial bUSDC Balance: ${formatUnits(initialEvmBalance, 6)} bUSDC`);

  // Step 3: Initiate bridge session
  logSection("Step 3: Initiating Bridge Session");

  // NOTE: In this test, we don't pass senderAddress because we use /api/test/transfer-private
  // which uses mintTokensPrivate (server-side minting). The server's PXE creates the notes,
  // so it can discover them without needing to register an external sender.
  //
  // In the REAL claim flow (browser -> bridge), the browser passes the ephemeral address
  // as senderAddress so the bridge can discover notes sent by that address.
  const bridgeSession = await initiateBridge(TEST_EVM_ADDRESS);

  if (!bridgeSession) {
    log("✗ Failed to initiate bridge session");
    process.exit(1);
  }

  // Step 4: Transfer private USDC to bridge address
  logSection("Step 4: Sending Private Transfer to Bridge");

  // Transfer private tokens to the bridge deposit address
  // This simulates a user sending their private tokens to bridge
  log(`Sending ${BRIDGE_AMOUNT} USDC privately to bridge deposit address...`);
  log(`(This simulates a user transferring from their private balance)`);

  const transferSuccess = await transferPrivateToAddress(
    bridgeSession.aztecDepositAddress,
    BRIDGE_AMOUNT
  );

  if (!transferSuccess) {
    log("✗ Failed to transfer to bridge address");
    process.exit(1);
  }

  // Step 5: Wait for bridge to process
  logSection("Step 5: Waiting for Bridge to Process");

  log("Bridge polls every 5 seconds for balance changes...");
  log("Waiting for bridge to detect deposit and mint on EVM...\n");

  const maxWaitTime = 60000; // 60 seconds max
  const pollInterval = 3000; // Check every 3 seconds
  const startTime = Date.now();

  let bridgeCompleted = false;

  while (Date.now() - startTime < maxWaitTime) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  Waiting... ${elapsed}s elapsed`);

    // Check if bridge session is still pending
    const status = await checkBridgeStatus(bridgeSession.aztecDepositAddress);

    if (status === "not_found") {
      // Session was removed, which means bridge completed
      console.log("\n");
      log("✓ Bridge session completed (session removed)");
      bridgeCompleted = true;
      break;
    }

    // Also check EVM balance
    const currentEvmBalance = await getEvmBalance(health.evmTokenAddress, TEST_EVM_ADDRESS);
    if (currentEvmBalance > initialEvmBalance) {
      console.log("\n");
      log("✓ EVM balance increased - bridge completed!");
      bridgeCompleted = true;
      break;
    }

    await sleep(pollInterval);
  }

  if (!bridgeCompleted) {
    console.log("\n");
    log("✗ Bridge did not complete within timeout");
    log("  Check server logs for errors");
  }

  // Step 6: Verify final balances
  logSection("Step 6: Final Balance Check");

  const finalEvmBalance = await getEvmBalance(health.evmTokenAddress, TEST_EVM_ADDRESS);

  log(`EVM Address: ${TEST_EVM_ADDRESS}`);
  log(`Initial bUSDC Balance: ${formatUnits(initialEvmBalance, 6)} bUSDC`);
  log(`Final bUSDC Balance: ${formatUnits(finalEvmBalance, 6)} bUSDC`);
  log(`Change: +${formatUnits(finalEvmBalance - initialEvmBalance, 6)} bUSDC`);

  // Final result
  logSection("TEST RESULT");

  if (finalEvmBalance > initialEvmBalance) {
    log("✓ BRIDGE TEST PASSED!");
    log(`  Successfully bridged tokens from Aztec to EVM`);
    process.exit(0);
  } else {
    log("✗ BRIDGE TEST FAILED");
    log(`  EVM balance did not increase`);
    log(`  Possible causes:`);
    log(`    - Bridge polling didn't detect the deposit`);
    log(`    - EVM minting failed`);
    log(`    - Check server logs for more details`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Test script error:", error);
  process.exit(1);
});
