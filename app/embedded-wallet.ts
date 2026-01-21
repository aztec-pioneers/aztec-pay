/**
 * Embedded Wallet for AztecPay
 *
 * This wallet runs entirely in the browser, managing accounts and signing transactions.
 * Based on the patterns from aztec-web-starter knowledge base.
 */

import { Account, SignerlessAccount } from '@aztec/aztec.js/account';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { createLogger } from '@aztec/aztec.js/log';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AccountManager } from '@aztec/aztec.js/wallet';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { AccountFeePaymentMethodOptions } from '@aztec/entrypoints/account';
import { Fr } from '@aztec/foundation/curves/bn254';
import { GrumpkinScalar } from '@aztec/foundation/curves/grumpkin';
import { SchnorrAccountContract } from '@aztec/accounts/schnorr/lazy';
import { getPXEConfig } from '@aztec/pxe/config';
import { createPXE } from '@aztec/pxe/client/lazy';
import { GasSettings } from '@aztec/stdlib/gas';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { type FeeOptions, BaseWallet } from '@aztec/wallet-sdk/base-wallet';

const PROVER_ENABLED = false;
const logger = createLogger('wallet');
const LocalStorageKey = 'aztec-pay-account';

export class EmbeddedWallet extends BaseWallet {
  connectedAccount: AztecAddress | null = null;
  protected accounts: Map<string, Account> = new Map();

  protected async getAccountFromAddress(address: AztecAddress): Promise<Account> {
    let account: Account | undefined;
    if (address.equals(AztecAddress.ZERO)) {
      const chainInfo = await this.getChainInfo();
      account = new SignerlessAccount(chainInfo);
    } else {
      account = this.accounts.get(address?.toString() ?? '');
    }

    if (!account) {
      throw new Error(`Account not found in wallet for address: ${address}`);
    }

    return account;
  }

  protected override async completeFeeOptions(
    from: AztecAddress,
    feePayer?: AztecAddress,
    gasSettings?: Partial<GasSettings>
  ): Promise<FeeOptions> {
    const maxFeesPerGas =
      gasSettings?.maxFeesPerGas ??
      (await this.aztecNode.getCurrentBaseFees()).mul(1 + this.baseFeePadding);

    let walletFeePaymentMethod;
    let accountFeePaymentMethodOptions;

    if (!feePayer) {
      const sponsoredFPCContract = await EmbeddedWallet.#getSponsoredPFCContract();
      walletFeePaymentMethod = new SponsoredFeePaymentMethod(
        sponsoredFPCContract.instance.address
      );
      accountFeePaymentMethodOptions = AccountFeePaymentMethodOptions.EXTERNAL;
    } else {
      accountFeePaymentMethodOptions = from.equals(feePayer)
        ? AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM
        : AccountFeePaymentMethodOptions.EXTERNAL;
    }

    const fullGasSettings: GasSettings = GasSettings.default({
      ...gasSettings,
      maxFeesPerGas,
    });

    return {
      gasSettings: fullGasSettings,
      walletFeePaymentMethod,
      accountFeePaymentMethodOptions,
    };
  }

  getAccounts() {
    return Promise.resolve(
      Array.from(this.accounts.values()).map((acc) => ({
        alias: '',
        item: acc.getAddress(),
      }))
    );
  }

  static async initialize(nodeUrl: string) {
    logger.info('Initializing wallet, connecting to node:', nodeUrl);

    const aztecNode = createAztecNodeClient(nodeUrl);

    const config = getPXEConfig();
    config.l1Contracts = await aztecNode.getL1ContractAddresses();
    config.proverEnabled = PROVER_ENABLED;

    const pxe = await createPXE(aztecNode, config, {
      useLogSuffix: true,
    });

    // Register Sponsored FPC Contract with PXE
    await pxe.registerContract(await EmbeddedWallet.#getSponsoredPFCContract());

    const nodeInfo = await aztecNode.getNodeInfo();
    logger.info('PXE Connected to node', nodeInfo);

    return new EmbeddedWallet(pxe, aztecNode);
  }

  static async #getSponsoredPFCContract() {
    const { SponsoredFPCContractArtifact } = await import(
      '@aztec/noir-contracts.js/SponsoredFPC'
    );
    const instance = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContractArtifact,
      {
        salt: new Fr(SPONSORED_FPC_SALT),
      }
    );

    return {
      instance,
      artifact: SponsoredFPCContractArtifact,
    };
  }

  getConnectedAccount() {
    return this.connectedAccount;
  }

  /**
   * Get contract instance from the Aztec node (not PXE)
   * This is needed to register contracts that were deployed by other clients
   */
  async getContractInstanceFromNode(address: AztecAddress) {
    return this.aztecNode.getContract(address);
  }

  private async registerAccount(accountManager: AccountManager) {
    const instance = await accountManager.getInstance();
    const artifact = await accountManager.getAccountContract().getContractArtifact();

    await this.registerContract(
      instance,
      artifact,
      accountManager.getSecretKey()
    );
  }

  /**
   * Create a new Schnorr account with given secret and salt
   * This is used for creating ephemeral accounts for payment links
   */
  async createSchnorrAccount(secret: Fr, salt: Fr): Promise<{ address: AztecAddress }> {
    // Generate a signing key from the secret
    const signingKey = GrumpkinScalar.fromBuffer(secret.toBuffer());

    const accountManager = await AccountManager.create(
      this,
      secret,
      new SchnorrAccountContract(signingKey),
      salt
    );

    await this.registerAccount(accountManager);
    this.accounts.set(
      accountManager.address.toString(),
      await accountManager.getAccount()
    );

    return { address: accountManager.address };
  }

  /**
   * Create a new account and connect it
   */
  async createAccountAndConnect(): Promise<AztecAddress> {
    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKey = GrumpkinScalar.fromBuffer(secretKey.toBuffer());

    const accountManager = await AccountManager.create(
      this,
      secretKey,
      new SchnorrAccountContract(signingKey),
      salt
    );

    // Register before deploy
    await this.registerAccount(accountManager);
    this.accounts.set(
      accountManager.address.toString(),
      await accountManager.getAccount()
    );

    // Deploy the account contract so public keys are on-chain
    // This is required for others to send private notes to this address
    logger.info('Deploying account contract...');
    const sponsoredFPC = await EmbeddedWallet.#getSponsoredPFCContract();
    const deployMethod = await accountManager.getDeployMethod();
    await deployMethod
      .send({
        from: AztecAddress.ZERO, // Signerless deployment
        fee: {
          paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.instance.address),
        },
        // Don't skip publication - we need public keys on-chain for others to send us notes
      })
      .wait({ timeout: 120 });
    logger.info('Account deployed successfully');

    // Store in localStorage
    localStorage.setItem(
      LocalStorageKey,
      JSON.stringify({
        address: accountManager.address.toString(),
        secretKey: secretKey.toString(),
        salt: salt.toString(),
      })
    );

    this.connectedAccount = accountManager.address;
    logger.info('Account created:', accountManager.address.toString());

    return this.connectedAccount;
  }

  /**
   * Connect existing account from localStorage
   */
  async connectExistingAccount(): Promise<AztecAddress | null> {
    const stored = localStorage.getItem(LocalStorageKey);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    const secretKey = Fr.fromString(parsed.secretKey);
    const salt = Fr.fromString(parsed.salt);
    const signingKey = GrumpkinScalar.fromBuffer(secretKey.toBuffer());

    const accountManager = await AccountManager.create(
      this,
      secretKey,
      new SchnorrAccountContract(signingKey),
      salt
    );

    await this.registerAccount(accountManager);
    this.accounts.set(
      accountManager.address.toString(),
      await accountManager.getAccount()
    );

    this.connectedAccount = accountManager.address;
    logger.info('Connected existing account:', this.connectedAccount.toString());

    return this.connectedAccount;
  }

  /**
   * Get stored account credentials (for transfers)
   */
  getStoredCredentials(): { secretKey: string; salt: string } | null {
    const stored = localStorage.getItem(LocalStorageKey);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    return {
      secretKey: parsed.secretKey,
      salt: parsed.salt,
    };
  }
}

export { AztecAddress, Fr };
