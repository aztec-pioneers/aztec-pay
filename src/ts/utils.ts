import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/src/artifacts/Token.js";
import { AZTEC_NODE_URL, IS_DEVNET, SPONSORED_FPC_ADDRESS } from "./config.js";

/**
 * Connect to the Aztec node
 */
export async function setupSandbox(): Promise<AztecNode> {
  const node = createAztecNodeClient(AZTEC_NODE_URL);
  return node;
}

/**
 * Get or create test accounts from the sandbox
 * Returns a single wallet with multiple accounts registered
 */
export async function getTestWallet(node: AztecNode): Promise<{
  wallet: EmbeddedWallet;
  accounts: AztecAddress[];
}> {
  // Use appropriate proving setting based on environment
  const proverEnabled = IS_DEVNET;
  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled } });
  
  const accounts: AztecAddress[] = [];

  if (IS_DEVNET) {
    // On devnet, create fresh accounts since test accounts don't exist
    console.log("[Utils] Creating fresh accounts for devnet...");
    for (let i = 0; i < 3; i++) {
      const secret = Fr.random();
      const salt = Fr.random();
      const account = await wallet.createSchnorrAccount(secret, salt);
      accounts.push(account.address);
    }
  } else {
    // On localnet, use the standard test accounts
    const accountsData = await getInitialTestAccountsData();
    for (const accData of accountsData.slice(0, 3)) {
      const account = await wallet.createSchnorrAccount(accData.secret, accData.salt);
      accounts.push(account.address);
    }
  }

  return { wallet, accounts };
}

/**
 * Deploy a TokenContract (USDC) for testing
 */
export async function deployToken(
  wallet: EmbeddedWallet,
  admin: AztecAddress,
  name: string = "USDC",
  symbol: string = "USDC",
  decimals: number = 6
): Promise<TokenContract> {
  const token = await TokenContract.deployWithOpts(
    { wallet, method: "constructor_with_minter" },
    name,
    symbol,
    decimals,
    admin, // minter
    admin  // upgrade_authority
  )
    .send({ from: admin });
  return token;
}

/**
 * Mint tokens to an address (private balance)
 */
export async function mintTokensPrivate(
  token: TokenContract,
  from: AztecAddress,
  to: AztecAddress,
  amount: bigint
): Promise<void> {
  if (IS_DEVNET && SPONSORED_FPC_ADDRESS) {
    // On devnet, use sponsored fees
    const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    
    const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
    
    await token.methods.mint_to_private(to, amount)
      .send({ from, fee: { paymentMethod } });
  } else {
    // On localnet, no fees needed
    await token.methods.mint_to_private(to, amount).send({ from });
  }
}

/**
 * Mint tokens to an address (public balance)
 */
export async function mintTokensPublic(
  token: TokenContract,
  from: AztecAddress,
  to: AztecAddress,
  amount: bigint
): Promise<void> {
  if (IS_DEVNET && SPONSORED_FPC_ADDRESS) {
    // On devnet, use sponsored fees
    const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    
    const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
    
    await token.methods.mint_to_public(to, amount)
      .send({ from, fee: { paymentMethod } });
  } else {
    // On localnet, no fees needed
    await token.methods.mint_to_public(to, amount).send({ from });
  }
}

/**
 * Get private balance of an address
 */
export async function getPrivateBalance(
  token: TokenContract,
  address: AztecAddress,
  from: AztecAddress
): Promise<bigint> {
  return await token.methods.balance_of_private(address).simulate({ from });
}

/**
 * Transfer tokens privately from one address to another
 */
export async function transferPrivate(
  token: TokenContract,
  from: AztecAddress,
  to: AztecAddress,
  amount: bigint
): Promise<void> {
  if (IS_DEVNET && SPONSORED_FPC_ADDRESS) {
    // On devnet, use sponsored fees
    const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
    const { AztecAddress } = await import("@aztec/aztec.js/addresses");
    
    const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
    
    await token.methods.transfer_private_to_private(from, to, amount, 0n)
      .send({ from, fee: { paymentMethod } });
  } else {
    // On localnet, no fees needed
    await token.methods.transfer_private_to_private(from, to, amount, 0n).send({ from });
  }
}

export { Fr, AztecAddress, EmbeddedWallet, TokenContract };
