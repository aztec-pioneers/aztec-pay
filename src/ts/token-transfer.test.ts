import { describe, it, expect, beforeAll } from "vitest";
import type { AztecNode } from "@aztec/aztec.js/node";
import {
  setupSandbox,
  getTestWallet,
  deployToken,
  mintTokensPrivate,
  getPrivateBalance,
  AztecAddress,
  TestWallet,
  TokenContract,
  Fr,
} from "./utils.js";

describe("Token Transfer", () => {
  let node: AztecNode;
  let wallet: TestWallet;
  let accounts: AztecAddress[];
  let usdc: TokenContract;

  // Test accounts
  let admin: AztecAddress;
  let addressA: AztecAddress;
  let addressB: AztecAddress; // Will be a random ephemeral account

  // Ephemeral account credentials (for debugging)
  let ephemeralSecret: typeof Fr.prototype;
  let ephemeralSalt: typeof Fr.prototype;

  const MINT_AMOUNT = 1000n * 10n ** 6n; // 1000 USDC (6 decimals)
  const TRANSFER_AMOUNT = 250n * 10n ** 6n; // 250 USDC

  beforeAll(async () => {
    // Setup sandbox and wallet
    node = await setupSandbox();
    const result = await getTestWallet(node);
    wallet = result.wallet;
    accounts = result.accounts;

    // Assign accounts - admin and A from test accounts
    admin = accounts[0];
    addressA = accounts[1];

    // Create a random ephemeral account for B (like we do in the browser)
    ephemeralSecret = Fr.random();
    ephemeralSalt = Fr.random();

    console.log(`[Test] Creating ephemeral account for B...`);
    console.log(`[Test] Ephemeral secret: ${ephemeralSecret.toString()}`);
    console.log(`[Test] Ephemeral salt: ${ephemeralSalt.toString()}`);

    const ephemeralAccount = await wallet.createSchnorrAccount(ephemeralSecret, ephemeralSalt);
    addressB = ephemeralAccount.address;

    console.log(`[Test] Ephemeral address B: ${addressB.toString()}`);
  }, 120_000);

  it("should deploy USDC token", async () => {
    // Deploy Token contract (name: "USDC", symbol: "USDC", decimals: 6)
    usdc = await deployToken(wallet, admin, "USDC", "USDC", 6);

    expect(usdc).toBeDefined();
    expect(usdc.address).toBeDefined();
    console.log(`USDC token deployed at: ${usdc.address}`);
  }, 120_000);

  it("should mint private tokens to Address A", async () => {
    // Mint tokens to Address A privately
    await mintTokensPrivate(usdc, admin, addressA, MINT_AMOUNT);

    // Verify A's balance
    const balanceA = await getPrivateBalance(usdc, addressA, addressA);
    expect(balanceA).toBe(MINT_AMOUNT);
    console.log(`Address A balance after mint: ${balanceA}`);
  }, 120_000);

  it("should transfer tokens from A to ephemeral B privately", async () => {
    // Get initial balances
    const initialBalanceA = await getPrivateBalance(usdc, addressA, addressA);
    const initialBalanceB = await getPrivateBalance(usdc, addressB, addressB);

    console.log(`[Test] Initial balance A: ${initialBalanceA}`);
    console.log(`[Test] Initial balance B (ephemeral): ${initialBalanceB}`);

    // Transfer tokens from A to ephemeral B privately
    console.log(`[Test] Transferring ${TRANSFER_AMOUNT} from A to ephemeral B...`);
    await usdc.methods
      .transfer_private_to_private(addressA, addressB, TRANSFER_AMOUNT, 0n)
      .send({ from: addressA })
      .wait();

    console.log(`[Test] Transfer complete, checking balances...`);

    // Verify balances after transfer
    const finalBalanceA = await getPrivateBalance(usdc, addressA, addressA);
    const finalBalanceB = await getPrivateBalance(usdc, addressB, addressB);

    console.log(`[Test] Final balance A: ${finalBalanceA}`);
    console.log(`[Test] Final balance B (ephemeral): ${finalBalanceB}`);

    // A's balance should decrease by transfer amount
    expect(finalBalanceA).toBe(initialBalanceA - TRANSFER_AMOUNT);
    // B's balance should increase by transfer amount
    expect(finalBalanceB).toBe(initialBalanceB + TRANSFER_AMOUNT);
  }, 120_000);

  it("should be able to reconstruct ephemeral account and see balance", async () => {
    // This test simulates what happens in the browser claim flow:
    // We "reconstruct" the ephemeral account using the same secret/salt
    // and check if we can see the balance

    console.log(`[Test] Reconstructing ephemeral account from credentials...`);
    console.log(`[Test] Using secret: ${ephemeralSecret.toString()}`);
    console.log(`[Test] Using salt: ${ephemeralSalt.toString()}`);

    // Re-create the account using the same credentials
    // (This simulates what the claim page does)
    const reconstructedAccount = await wallet.createSchnorrAccount(ephemeralSecret, ephemeralSalt);

    console.log(`[Test] Original address B: ${addressB.toString()}`);
    console.log(`[Test] Reconstructed address: ${reconstructedAccount.address.toString()}`);

    // The addresses should match
    expect(reconstructedAccount.address.toString()).toBe(addressB.toString());

    // Now try to read the balance
    console.log(`[Test] Checking balance from reconstructed account...`);

    // Sync private state first (like the browser does)
    await usdc.methods.sync_private_state().simulate({ from: reconstructedAccount.address });

    const balance = await getPrivateBalance(usdc, reconstructedAccount.address, reconstructedAccount.address);
    console.log(`[Test] Balance from reconstructed account: ${balance}`);

    // Balance should be the transfer amount
    expect(balance).toBe(TRANSFER_AMOUNT);
  }, 120_000);

  it("should simulate NEW wallet reconstructing ephemeral account", async () => {
    // This is the most realistic test - create a completely new wallet/PXE
    // and try to discover the notes. This simulates what happens when
    // a different browser (claim page) tries to access the funds.

    console.log(`[Test] Creating a NEW TestWallet to simulate different browser/PXE...`);

    // Create a brand new wallet (simulating a different browser)
    const newWallet = await TestWallet.create(node, { proverEnabled: false });

    // Register the token contract in the new wallet
    const tokenInstance = await node.getContract(usdc.address);
    if (!tokenInstance) {
      throw new Error("Token contract not found on node");
    }
    await newWallet.registerContract(tokenInstance, usdc.artifact);

    // Reconstruct the ephemeral account in the NEW wallet
    console.log(`[Test] Reconstructing ephemeral account in NEW wallet...`);
    const reconstructedAccount = await newWallet.createSchnorrAccount(ephemeralSecret, ephemeralSalt);

    console.log(`[Test] Reconstructed address in new wallet: ${reconstructedAccount.address.toString()}`);
    expect(reconstructedAccount.address.toString()).toBe(addressB.toString());

    // Get the token contract attached to the new wallet
    const tokenInNewWallet = usdc.withWallet(newWallet);

    // IMPORTANT: Register the ORIGINAL SENDER (addressA) in the new wallet
    // This might help the PXE know to look for tags from that sender
    console.log(`[Test] Registering ORIGINAL sender (addressA) in new wallet...`);
    await newWallet.registerSender(addressA);

    // Also register the ephemeral address itself
    console.log(`[Test] Registering ephemeral address in new wallet...`);
    await newWallet.registerSender(reconstructedAccount.address);

    // Sync private state
    console.log(`[Test] Syncing private state in new wallet...`);
    await tokenInNewWallet.methods.sync_private_state().simulate({ from: reconstructedAccount.address });

    // Check balance
    console.log(`[Test] Checking balance from new wallet...`);
    const balance = await tokenInNewWallet.methods
      .balance_of_private(reconstructedAccount.address)
      .simulate({ from: reconstructedAccount.address });

    console.log(`[Test] Balance in new wallet: ${balance}`);

    // This is the critical test - can the new wallet see the notes?
    // NOTE: This FAILS because the new PXE cannot discover notes from a different PXE
    expect(balance).toBe(TRANSFER_AMOUNT);
  }, 120_000);

  it("should work when NEW wallet is created BEFORE transfer", async () => {
    // Hypothesis: Maybe the new PXE needs to exist and be registered
    // BEFORE the transfer happens, so it can track incoming notes

    console.log(`[Test] Creating NEW wallet BEFORE transfer...`);
    const newWallet2 = await TestWallet.create(node, { proverEnabled: false });

    // Generate new ephemeral credentials
    const newSecret = Fr.random();
    const newSalt = Fr.random();

    console.log(`[Test] Creating ephemeral account in NEW wallet first...`);
    const ephemeralInNewWallet = await newWallet2.createSchnorrAccount(newSecret, newSalt);
    console.log(`[Test] New ephemeral address: ${ephemeralInNewWallet.address.toString()}`);

    // Also register this address in the original wallet so we can send to it
    console.log(`[Test] Registering new ephemeral address in original wallet...`);
    await wallet.registerSender(ephemeralInNewWallet.address);

    // Register token in new wallet
    const tokenInstance = await node.getContract(usdc.address);
    if (!tokenInstance) throw new Error("Token not found");
    await newWallet2.registerContract(tokenInstance, usdc.artifact);

    // Check sync status before transfer
    console.log(`[Test] Node block number before transfer: ${await node.getBlockNumber()}`);

    // Now transfer from A to the new ephemeral address
    console.log(`[Test] Transferring 100 USDC from A to new ephemeral...`);
    const SMALL_AMOUNT = 100n * 10n ** 6n;
    const receipt = await usdc.methods
      .transfer_private_to_private(addressA, ephemeralInNewWallet.address, SMALL_AMOUNT, 0n)
      .send({ from: addressA })
      .wait();

    console.log(`[Test] Transfer complete in block: ${receipt.blockNumber}`);

    // Wait a bit for the new wallet's PXE to process the new block
    console.log(`[Test] Waiting 2 seconds for sync...`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`[Test] Node block number after transfer: ${await node.getBlockNumber()}`);

    // Try multiple sync attempts
    const tokenInNewWallet = usdc.withWallet(newWallet2);

    // IMPORTANT: Register addressA as a sender so PXE knows to look for tags from them
    console.log(`[Test] Registering addressA as sender in new wallet...`);
    await newWallet2.registerSender(addressA);

    console.log(`[Test] Sync attempt 1...`);
    await tokenInNewWallet.methods.sync_private_state().simulate({ from: ephemeralInNewWallet.address });
    let balance = await tokenInNewWallet.methods
      .balance_of_private(ephemeralInNewWallet.address)
      .simulate({ from: ephemeralInNewWallet.address });
    console.log(`[Test] Balance after sync 1: ${balance}`);

    if (balance === 0n) {
      console.log(`[Test] Sync attempt 2 (waiting 2 more seconds)...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await tokenInNewWallet.methods.sync_private_state().simulate({ from: ephemeralInNewWallet.address });
      balance = await tokenInNewWallet.methods
        .balance_of_private(ephemeralInNewWallet.address)
        .simulate({ from: ephemeralInNewWallet.address });
      console.log(`[Test] Balance after sync 2: ${balance}`);
    }

    if (balance === 0n) {
      console.log(`[Test] Sync attempt 3 (waiting 3 more seconds)...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await tokenInNewWallet.methods.sync_private_state().simulate({ from: ephemeralInNewWallet.address });
      balance = await tokenInNewWallet.methods
        .balance_of_private(ephemeralInNewWallet.address)
        .simulate({ from: ephemeralInNewWallet.address });
      console.log(`[Test] Balance after sync 3: ${balance}`);
    }

    expect(balance).toBe(SMALL_AMOUNT);
  }, 180_000);
});
