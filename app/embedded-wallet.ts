/**
 * Embedded Wallet for AztecPay
 * 
 * A simplified wallet that runs in the browser for handling Aztec transactions.
 * Supports both localnet (proving disabled) and devnet (proving enabled with sponsored fees).
 */

import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import { Fr } from '@aztec/aztec.js/fields';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { TokenContract } from '@defi-wonderland/aztec-standards/artifacts/src/artifacts/Token.js';
import type { ContractInstance } from '@aztec/stdlib/contract';
import type { ContractArtifact } from '@aztec/stdlib/abi';

// Environment detection
const AZTEC_ENV = process.env.AZTEC_ENV || 'localnet';
const IS_DEVNET = AZTEC_ENV === 'devnet';
const SPONSORED_FPC_ADDRESS = process.env.SPONSORED_FPC_ADDRESS || '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e';

// Sandbox pre-funded test account (first account — already deployed with fee juice on localnet)
const TEST_ACCOUNT_SECRET = '0x2153536ff6628eee01cf4024889ff977a18d9fa61d0e414422f7681cf085c281';
const TEST_ACCOUNT_SALT = '0x0000000000000000000000000000000000000000000000000000000000000000';

export { Fr, AztecAddress };

// Storage keys
const STORAGE_KEY = 'aztec-pay-account';

/**
 * Stored account credentials
 */
export interface StoredCredentials {
  secretKey: string;
  salt: string;
  address: string;
}

/**
 * Account information
 */
export interface AccountInfo {
  address: AztecAddress;
  secret: Fr;
  salt: Fr;
}

/**
 * Embedded wallet that handles Aztec interactions in the browser
 */
export class EmbeddedWallet {
  private node: AztecNode;
  private wallet: any;
  private accounts: Map<string, AccountInfo> = new Map();
  private _connectedAccount: AztecAddress | null = null;
  private _storedCredentials: StoredCredentials | null = null;

  private constructor(node: AztecNode, wallet: any) {
    this.node = node;
    this.wallet = wallet;
  }

  /**
   * Initialize the embedded wallet
   */
  static async initialize(nodeUrl: string): Promise<EmbeddedWallet> {
    console.log(`[EmbeddedWallet] Initializing with ${nodeUrl} (environment: ${AZTEC_ENV})...`);

    const node = createAztecNodeClient(nodeUrl);

    // Create wallet with appropriate proving settings
    const { EmbeddedWallet: AztecWallet } = await import('@aztec/wallets/embedded');
    const wallet = await AztecWallet.create(node, { pxeConfig: { proverEnabled: IS_DEVNET } });
    console.log(`[EmbeddedWallet] ${IS_DEVNET ? 'Devnet' : 'Localnet'} mode - proving ${IS_DEVNET ? 'enabled' : 'disabled'}`);

    const embeddedWallet = new EmbeddedWallet(node, wallet);

    // Register SponsoredFPC on devnet
    if (IS_DEVNET) {
      await embeddedWallet.registerSponsoredFPC();
    }

    return embeddedWallet;
  }

  /**
   * Register the SponsoredFPC contract for devnet fee payment
   */
  private async registerSponsoredFPC(): Promise<void> {
    try {
      const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
      const address = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
      
      console.log('[EmbeddedWallet] Registering SponsoredFPC at', address.toString());
      
      const instance = await this.node.getContract(address);
      if (instance) {
        await this.wallet.registerContract(instance, SponsoredFPCContract.artifact);
        console.log('[EmbeddedWallet] SponsoredFPC registered successfully');
      } else {
        console.warn('[EmbeddedWallet] SponsoredFPC contract not found at expected address');
      }
    } catch (error) {
      console.error('[EmbeddedWallet] Failed to register SponsoredFPC:', error);
    }
  }

  /**
   * Get the currently connected account
   */
  get connectedAccount(): AztecAddress | null {
    return this._connectedAccount;
  }

  /**
   * Get stored credentials from localStorage
   */
  getStoredCredentials(): StoredCredentials | null {
    if (this._storedCredentials) {
      return this._storedCredentials;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this._storedCredentials = JSON.parse(stored) as StoredCredentials;
        return this._storedCredentials;
      }
    } catch (error) {
      console.error('[EmbeddedWallet] Failed to read credentials from localStorage:', error);
    }

    return null;
  }

  /**
   * Save credentials to localStorage
   */
  private saveCredentials(credentials: StoredCredentials): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
      this._storedCredentials = credentials;
    } catch (error) {
      console.error('[EmbeddedWallet] Failed to save credentials to localStorage:', error);
    }
  }

  /**
   * Connect to an existing account from localStorage
   * @returns The connected account address or null if no stored account
   */
  async connectExistingAccount(): Promise<AztecAddress | null> {
    const credentials = this.getStoredCredentials();
    
    if (!credentials) {
      console.log('[EmbeddedWallet] No existing account found in storage');
      return null;
    }

    console.log('[EmbeddedWallet] Connecting to existing account:', credentials.address);

    try {
      const secret = Fr.fromString(credentials.secretKey);
      const salt = Fr.fromString(credentials.salt);

      // Create the account (this registers it with the wallet)
      const accountInfo = await this.createSchnorrAccount(secret, salt, false);

      // Verify the address matches
      if (accountInfo.address.toString() !== credentials.address) {
        console.error('[EmbeddedWallet] Address mismatch! Stored:', credentials.address, 'Generated:', accountInfo.address.toString());
        return null;
      }

      this._connectedAccount = accountInfo.address;
      console.log('[EmbeddedWallet] Connected to existing account:', this._connectedAccount.toString());
      return this._connectedAccount;
    } catch (error) {
      console.error('[EmbeddedWallet] Failed to connect to existing account:', error);
      return null;
    }
  }

  /**
   * Create a new account and connect to it
   * @returns The new account address
   */
  async createAccountAndConnect(): Promise<AztecAddress> {
    console.log('[EmbeddedWallet] Creating new account...');

    let secret: Fr;
    let salt: Fr;
    let deploy: boolean;

    if (IS_DEVNET) {
      // Devnet: create random account and deploy with sponsored fees
      secret = Fr.random();
      salt = Fr.random();
      deploy = true;
    } else {
      // Localnet: use sandbox's pre-funded test account (already deployed)
      console.log('[EmbeddedWallet] Using sandbox test account for localnet');
      secret = Fr.fromString(TEST_ACCOUNT_SECRET);
      salt = Fr.fromString(TEST_ACCOUNT_SALT);
      deploy = false;
    }

    // Create the account
    const accountInfo = await this.createSchnorrAccount(secret, salt, deploy);

    // Save credentials
    this.saveCredentials({
      secretKey: secret.toString(),
      salt: salt.toString(),
      address: accountInfo.address.toString(),
    });

    this._connectedAccount = accountInfo.address;
    console.log('[EmbeddedWallet] Created and connected to new account:', this._connectedAccount.toString());
    
    return this._connectedAccount;
  }

  /**
   * Create a Schnorr account
   * @param secret The secret key
   * @param salt The salt for deterministic address generation
   * @param deploy Whether to deploy the account (needed for devnet)
   */
  async createSchnorrAccount(secret: Fr, salt: Fr, deploy: boolean = false): Promise<AccountInfo> {
    const cacheKey = `${secret.toString()}:${salt.toString()}`;

    // Check cache but don't return early if we need to deploy
    const cached = this.accounts.get(cacheKey);
    if (cached && !deploy) {
      // Return from cache only if we're not deploying
      return cached;
    }

    console.log(`[EmbeddedWallet] Creating Schnorr account (deploy=${deploy})...`);

    const account = await this.wallet.createSchnorrAccount(secret, salt);

    const accountInfo: AccountInfo = {
      address: account.address,
      secret,
      salt,
    };

    // Always cache the account info
    this.accounts.set(cacheKey, accountInfo);

    // Deploy account if requested (required for signing transactions)
    if (deploy) {
      console.log('[EmbeddedWallet] Deploying account (this may take 1-2 minutes)...');

      const deployMethod = await account.getDeployMethod();

      try {
        if (IS_DEVNET) {
          // Devnet: use sponsored fees
          const { SponsoredFeePaymentMethod } = await import('@aztec/aztec.js/fee');
          const sponsoredFpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
          const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFpcAddress);
          await deployMethod.send({ from: AztecAddress.ZERO, fee: { paymentMethod } });
        } else {
          // Localnet: no fees needed
          await deployMethod.send({ from: AztecAddress.ZERO });
        }
        console.log('[EmbeddedWallet] Account deployed successfully');
      } catch (deployError: any) {
        // If deployment fails because account already exists, that's OK
        if (deployError?.message?.includes('already deployed') || deployError?.message?.includes('duplicate')) {
          console.log('[EmbeddedWallet] Account already deployed on-chain');
        } else {
          console.warn('[EmbeddedWallet] Deployment error (may be already deployed):', deployError);
        }
      }

      // CRITICAL: Register the account address so PXE discovers notes addressed to it
      console.log('[EmbeddedWallet] Registering account for note discovery:', account.address.toString());
      await this.wallet.registerSender(account.address, 'deployed-account');

      // CRITICAL: Sync PXE to discover the signing key note that was just created
      console.log('[EmbeddedWallet] Syncing PXE to discover signing key note...');
      await this.syncPXE();
      console.log('[EmbeddedWallet] PXE sync complete');
    }

    return accountInfo;
  }

  /**
   * Get the underlying wallet
   */
  getWallet(): any {
    return this.wallet;
  }

  /**
   * Get the node client
   */
  getNode(): AztecNode {
    return this.node;
  }

  /**
   * Register a contract with the wallet
   */
  async registerContract(instance: ContractInstance, artifact: ContractArtifact): Promise<void> {
    await this.wallet.registerContract(instance, artifact);
  }

  /**
   * Register a sender address for note discovery
   */
  async registerSender(address: AztecAddress, alias: string = 'sender'): Promise<void> {
    await this.wallet.registerSender(address, alias);
  }

  /**
   * Get contract instance from node
   */
  async getContractInstanceFromNode(address: AztecAddress): Promise<ContractInstance | undefined> {
    return await this.node.getContract(address);
  }

  /**
   * Get the current block number
   */
  async getBlockNumber(): Promise<number> {
    return await this.node.getBlockNumber();
  }

  /**
   * Get sync status
   */
  async getSyncStatus(): Promise<any> {
    // Try to get sync status from the wallet's PXE
    try {
      const pxe = (this.wallet as any).pxe;
      if (pxe) {
        return await pxe.getSyncStatus();
      }
    } catch (e) {
      console.warn('[EmbeddedWallet] Could not get sync status:', e);
    }
    return null;
  }

  /**
   * Sync the PXE to discover new notes
   */
  async syncPXE(): Promise<void> {
    try {
      const pxe = (this.wallet as any).pxe;
      if (pxe && pxe.sync) {
        await pxe.sync();
      }
    } catch (e) {
      console.warn('[EmbeddedWallet] Could not sync PXE:', e);
    }
  }

  /**
   * Sync a specific account to discover its notes
   */
  async syncAccount(address: AztecAddress): Promise<any> {
    try {
      // Register as sender first
      await this.wallet.registerSender(address, 'sync-account');
      
      // Try to get PXE and sync
      const pxe = (this.wallet as any).pxe;
      if (pxe) {
        // Sync the PXE
        await pxe.sync();
        
        // Get the current block number
        const blockNumber = await this.node.getBlockNumber();
        
        return {
          syncedTo: blockNumber,
          address: address.toString(),
        };
      }
    } catch (e) {
      console.warn('[EmbeddedWallet] Could not sync account:', e);
    }
    return null;
  }

  /**
   * Get the fee payment method for devnet transactions
   */
  async getFeePaymentMethod(): Promise<any> {
    if (!IS_DEVNET) {
      return undefined;
    }

    const { SponsoredFeePaymentMethod } = await import('@aztec/aztec.js/fee');
    const address = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
    return new SponsoredFeePaymentMethod(address);
  }
}

/**
 * Get a TokenContract instance
 */
export async function getTokenContract(wallet: EmbeddedWallet, address: AztecAddress): Promise<typeof TokenContract.prototype> {
  return TokenContract.at(address, wallet.getWallet());
}
