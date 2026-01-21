import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { TokenContract } from "@defi-wonderland/aztec-standards/artifacts/Token.js";

const PXE_URL = "http://localhost:8080";

/**
 * Connect to the local Aztec node at localhost:8080
 */
export async function setupSandbox(): Promise<AztecNode> {
  const node = createAztecNodeClient(PXE_URL);
  return node;
}

/**
 * Get or create test accounts from the sandbox
 * Returns a single wallet with multiple accounts registered
 */
export async function getTestWallet(node: AztecNode): Promise<{
  wallet: TestWallet;
  accounts: AztecAddress[];
}> {
  const accountsData = await getInitialTestAccountsData();
  const wallet = await TestWallet.create(node, { proverEnabled: false });
  const accounts: AztecAddress[] = [];

  for (const accData of accountsData.slice(0, 3)) {
    const account = await wallet.createSchnorrAccount(accData.secret, accData.salt);
    accounts.push(account.address);
  }

  return { wallet, accounts };
}

/**
 * Deploy a TokenContract (USDC) for testing
 */
export async function deployToken(
  wallet: TestWallet,
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
    .send({ from: admin })
    .deployed();
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
  await token.methods.mint_to_private(to, amount).send({ from }).wait();
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
  await token.methods.mint_to_public(to, amount).send({ from }).wait();
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
  await token.methods.transfer_private_to_private(from, to, amount, 0n).send({ from }).wait();
}

export { Fr, AztecAddress, TestWallet, TokenContract };
