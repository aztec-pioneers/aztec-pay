/**
 * AztecPay Configuration
 * 
 * This module handles environment detection and configuration for both localnet and devnet.
 * Set AZTEC_ENV=devnet to use devnet, otherwise defaults to localnet.
 */

// Environment detection
export const AZTEC_ENV = process.env.AZTEC_ENV || 'localnet';
export const IS_DEVNET = AZTEC_ENV === 'devnet';
export const IS_LOCALNET = AZTEC_ENV === 'localnet';

// Canonical SponsoredFPC address (deployed at genesis with salt=0, same for all sandbox instances)
const CANONICAL_SPONSORED_FPC_ADDRESS = '0x09a4df73aa47f82531a038d1d51abfc85b27665c4b7ca751e2d4fa9f19caffb2';

// Default FPC addresses per environment
const DEFAULT_DEVNET_FPC = '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e';

// Network-specific constants
export const NETWORKS = {
  localnet: {
    name: 'localnet',
    nodeUrl: process.env.AZTEC_NODE_URL || 'http://localhost:8080',
    sponsoredFpcAddress: CANONICAL_SPONSORED_FPC_ADDRESS,
    proverEnabled: false,
    apiBaseUrl: process.env.API_BASE_URL || '',
  },
  devnet: {
    name: 'devnet',
    nodeUrl: process.env.AZTEC_NODE_URL || 'https://devnet-6.aztec-labs.com',
    sponsoredFpcAddress: process.env.SPONSORED_FPC_ADDRESS || DEFAULT_DEVNET_FPC,
    proverEnabled: true, // Devnet requires proving
    apiBaseUrl: process.env.API_BASE_URL || '',
  },
};

// Current network configuration
export const NETWORK = IS_DEVNET ? NETWORKS.devnet : NETWORKS.localnet;

// Export individual config values for convenience
export const AZTEC_NODE_URL = NETWORK.nodeUrl;
export const SPONSORED_FPC_ADDRESS = NETWORK.sponsoredFpcAddress;
export const PROVER_ENABLED = NETWORK.proverEnabled;
export const API_BASE_URL = NETWORK.apiBaseUrl;

/**
 * Log current configuration
 */
export function logConfig(): void {
  console.log('='.repeat(60));
  console.log('AztecPay Configuration');
  console.log('='.repeat(60));
  console.log(`Environment: ${AZTEC_ENV}`);
  console.log(`Network: ${NETWORK.name}`);
  console.log(`Node URL: ${AZTEC_NODE_URL}`);
  console.log(`Prover Enabled: ${PROVER_ENABLED}`);
  if (SPONSORED_FPC_ADDRESS) {
    console.log(`Sponsored FPC: ${SPONSORED_FPC_ADDRESS}`);
  }
  console.log('='.repeat(60));
}

/**
 * Get fee payment method for transactions
 * On localnet, returns undefined (no fees)
 * On devnet, returns sponsored fee payment method
 */
export async function getFeePaymentMethod(): Promise<any> {
  if (!SPONSORED_FPC_ADDRESS) {
    return undefined;
  }
  
  // Dynamic import to avoid loading on localnet
  const { SponsoredFeePaymentMethod } = await import('@aztec/aztec.js/fee');
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');
  
  return new SponsoredFeePaymentMethod(AztecAddress.fromString(SPONSORED_FPC_ADDRESS));
}

/**
 * Get sponsored FPC contract instance
 */
export async function getSponsoredFPCContract(node: any): Promise<any> {
  if (!SPONSORED_FPC_ADDRESS) {
    return undefined;
  }
  
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');
  const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
  
  const address = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  const instance = await node.getContract(address);
  
  if (!instance) {
    throw new Error(`SponsoredFPC contract not found at ${SPONSORED_FPC_ADDRESS}`);
  }
  
  return { instance, artifact: SponsoredFPCContract.artifact, address };
}
