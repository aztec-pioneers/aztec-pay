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
} from "./utils.js";

describe("Token Transfer", () => {
  let node: AztecNode;
  let wallet: TestWallet;
  let accounts: AztecAddress[];
  let usdc: TokenContract;

  // Test accounts
  let admin: AztecAddress;
  let addressA: AztecAddress;
  let addressB: AztecAddress;

  const MINT_AMOUNT = 1000n * 10n ** 6n; // 1000 USDC (6 decimals)
  const TRANSFER_AMOUNT = 250n * 10n ** 6n; // 250 USDC

  beforeAll(async () => {
    // Setup sandbox and wallet
    node = await setupSandbox();
    const result = await getTestWallet(node);
    wallet = result.wallet;
    accounts = result.accounts;

    // Assign accounts
    admin = accounts[0];
    addressA = accounts[1];
    addressB = accounts[2];
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

  it("should transfer tokens from A to B privately", async () => {
    // Get initial balances
    const initialBalanceA = await getPrivateBalance(usdc, addressA, addressA);
    const initialBalanceB = await getPrivateBalance(usdc, addressB, addressB);

    console.log(`Initial balance A: ${initialBalanceA}`);
    console.log(`Initial balance B: ${initialBalanceB}`);

    // Transfer tokens from A to B privately
    await usdc.methods
      .transfer_private_to_private(addressA, addressB, TRANSFER_AMOUNT, 0n)
      .send({ from: addressA })
      .wait();

    // Verify balances after transfer
    const finalBalanceA = await getPrivateBalance(usdc, addressA, addressA);
    const finalBalanceB = await getPrivateBalance(usdc, addressB, addressB);

    console.log(`Final balance A: ${finalBalanceA}`);
    console.log(`Final balance B: ${finalBalanceB}`);

    // A's balance should decrease by transfer amount
    expect(finalBalanceA).toBe(initialBalanceA - TRANSFER_AMOUNT);
    // B's balance should increase by transfer amount
    expect(finalBalanceB).toBe(initialBalanceB + TRANSFER_AMOUNT);
  }, 120_000);
});
