import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { type AccountManager } from "@aztec/aztec.js/wallet";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/src/artifacts/Token.js";
import { AZTEC_NODE_URL, IS_DEVNET, SPONSORED_FPC_ADDRESS } from "./config.js";

/**
 * Get the SponsoredFeePaymentMethod if FPC address is configured.
 */
async function getSponsoredPaymentMethod() {
  if (!SPONSORED_FPC_ADDRESS) return undefined;
  const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee");
  return new SponsoredFeePaymentMethod(AztecAddress.fromString(SPONSORED_FPC_ADDRESS));
}

/**
 * Connect to the Aztec node
 */
export async function setupSandbox(): Promise<AztecNode> {
  const node = createAztecNodeClient(AZTEC_NODE_URL);
  return node;
}

/**
 * Create a wallet with fresh random accounts.
 * Accounts are created but NOT deployed — call deployAccount() to deploy with FPC.
 */
export async function getTestWallet(node: AztecNode): Promise<{
  wallet: EmbeddedWallet;
  accounts: AztecAddress[];
  accountManagers: AccountManager[];
}> {
  const proverEnabled = IS_DEVNET;
  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled } });

  const accounts: AztecAddress[] = [];
  const accountManagers: AccountManager[] = [];

  console.log("[Utils] Creating fresh random accounts...");
  for (let i = 0; i < 3; i++) {
    const secret = Fr.random();
    const salt = Fr.random();
    const account = await wallet.createSchnorrAccount(secret, salt);
    accounts.push(account.address);
    accountManagers.push(account);
  }

  return { wallet, accounts, accountManagers };
}

/**
 * Deploy an account using SponsoredFPC for fee payment.
 */
export async function deployAccount(accountManager: AccountManager): Promise<void> {
  const paymentMethod = await getSponsoredPaymentMethod();
  if (!paymentMethod) {
    throw new Error("Cannot deploy account without a SponsoredFPC address configured");
  }

  const deployMethod = await accountManager.getDeployMethod();
  await deployMethod.send({ from: AztecAddress.ZERO, fee: { paymentMethod } });
  console.log(`[Utils] Account deployed: ${accountManager.address.toString()}`);
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
  const paymentMethod = await getSponsoredPaymentMethod();
  const token = await TokenContract.deployWithOpts(
    { wallet, method: "constructor_with_minter" },
    name,
    symbol,
    decimals,
    admin, // minter
    admin  // upgrade_authority
  )
    .send({ from: admin, ...(paymentMethod ? { fee: { paymentMethod } } : {}) });
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
  const paymentMethod = await getSponsoredPaymentMethod();
  await token.methods.mint_to_private(to, amount)
    .send({ from, ...(paymentMethod ? { fee: { paymentMethod } } : {}) });
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
  const paymentMethod = await getSponsoredPaymentMethod();
  await token.methods.mint_to_public(to, amount)
    .send({ from, ...(paymentMethod ? { fee: { paymentMethod } } : {}) });
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
  const paymentMethod = await getSponsoredPaymentMethod();
  await token.methods.transfer_private_to_private(from, to, amount, 0n)
    .send({ from, ...(paymentMethod ? { fee: { paymentMethod } } : {}) });
}

export { Fr, AztecAddress, EmbeddedWallet, TokenContract };
