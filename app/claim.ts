/**
 * AztecPay Claim Page
 *
 * Handles claiming payment links and bridging to Base Sepolia
 *
 * Flow:
 * 1. Decode link to get ephemeral account credentials
 * 2. Reconstruct ephemeral account in browser
 * 3. User enters EVM address
 * 4. Call bridge/initiate to get deposit address
 * 5. Transfer from ephemeral account to bridge deposit address
 * 6. Bridge monitors and mints on EVM
 */

// TypeScript declaration for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] | object }) => Promise<any>;
      isMetaMask?: boolean;
    };
  }
}

import './style.css';
import { EmbeddedWallet, Fr, AztecAddress } from './embedded-wallet';
import { TokenContract } from '@defi-wonderland/aztec-standards/artifacts/Token';

interface PaymentData {
  secret: string;
  salt: string;
  ephemeralAddress?: string; // Added for verification
  senderAddress?: string; // CRITICAL: needed for note discovery
  amount: string;
  message: string;
  tokenAddress: string;
}

// Configuration - use environment variables or defaults
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const API_BASE_URL = process.env.API_BASE_URL || ''; // Empty string = relative URLs (proxied by nginx)
const SERVER_TIMESTAMP_KEY = 'aztec-pay-server-timestamp';

// DOM Elements
const loadingScreen = document.getElementById('loading-screen')!;
const mainApp = document.getElementById('main-app')!;
const statusText = document.getElementById('status-text')!;

// Claim view elements
const claimView = document.getElementById('claim-view')!;
const paymentAmount = document.getElementById('payment-amount')!;
const messageBox = document.getElementById('message-box')!;
const paymentMessage = document.getElementById('payment-message')!;
const evmAddressInput = document.getElementById('evm-address') as HTMLInputElement;
const claimBtn = document.getElementById('claim-btn')!;
const errorMessage = document.getElementById('error-message')!;

// Processing view elements
const processingView = document.getElementById('processing-view')!;
const processingStatus = document.getElementById('processing-status')!;

// Success view elements
const successView = document.getElementById('success-view')!;
const successAmount = document.getElementById('success-amount')!;
const txLink = document.getElementById('tx-link') as HTMLAnchorElement;
const switchNetworkBtn = document.getElementById('switch-network-btn')!;
const addTokenBtn = document.getElementById('add-token-btn')!;

// Manual setup elements
const toggleManualBtn = document.getElementById('toggle-manual-btn')!;
const manualDetails = document.getElementById('manual-details')!;
const manualTokenAddress = document.getElementById('manual-token-address')!;

// Error view elements
const errorView = document.getElementById('error-view')!;
const errorDetail = document.getElementById('error-detail')!;

// State
let paymentData: PaymentData | null = null;
let wallet: EmbeddedWallet | null = null;
let tokenContract: typeof TokenContract.prototype | null = null;
let ephemeralAddress: AztecAddress | null = null;
let evmTokenAddress: string | null = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
  try {
    // Parse URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const data = urlParams.get('data');

    if (!data) {
      showFatalError('Invalid payment link - no data found');
      return;
    }

    // Decode payment data
    updateStatus('Decoding payment data...');
    try {
      const decoded = atob(data);
      paymentData = JSON.parse(decoded) as PaymentData;
    } catch {
      showFatalError('Invalid payment link - could not decode data');
      return;
    }

    // Validate required fields
    if (!paymentData.secret || !paymentData.salt || !paymentData.tokenAddress) {
      showFatalError('Invalid payment link - missing required fields');
      return;
    }

    // Warn if sender address is missing (old links may not have it)
    if (!paymentData.senderAddress) {
      console.warn('[Claim] WARNING: Link does not contain sender address - note discovery may fail');
      console.warn('[Claim] This link may have been created with an older version of the app');
    } else {
      console.log('[Claim] Sender address found in link:', paymentData.senderAddress);
    }

    // Check server health
    updateStatus('Checking server...');
    const health = await checkServerHealth();

    if (!health) {
      updateStatus('Waiting for server...');
      setTimeout(initialize, 2000);
      return;
    }

    // Check if server restarted and clear stale localStorage if needed
    checkServerRestart(health.serverStartupTimestamp);

    if (!health.bridgeEnabled) {
      showFatalError('Bridge is not enabled on the server');
      return;
    }

    // Store EVM token address for wallet integration
    evmTokenAddress = health.evmTokenAddress;

    // Update manual details with token address
    if (evmTokenAddress) {
      manualTokenAddress.textContent = evmTokenAddress;
    }

    // Initialize Aztec wallet in browser
    updateStatus('Initializing Aztec client...');
    wallet = await EmbeddedWallet.initialize(AZTEC_NODE_URL);

    // Register token contract
    updateStatus('Registering token contract...');
    await registerTokenContract();

    // Reconstruct ephemeral account from link credentials
    // First just register it (don't deploy yet) to check balance
    updateStatus('Reconstructing payment account...');
    const secret = Fr.fromString(paymentData.secret);
    const salt = Fr.fromString(paymentData.salt);

    console.log('[Claim] Creating ephemeral account (not deployed yet)...');
    const ephemeralAccount = await wallet.createSchnorrAccount(secret, salt, false);
    ephemeralAddress = ephemeralAccount.address;

    console.log('[Claim] Ephemeral address (reconstructed):', ephemeralAddress.toString());

    // Verify address matches if it was included in the link
    if (paymentData.ephemeralAddress) {
      console.log('[Claim] Expected address (from link):', paymentData.ephemeralAddress);
      if (ephemeralAddress.toString() !== paymentData.ephemeralAddress) {
        console.error('[Claim] ADDRESS MISMATCH! Reconstructed address does not match link address.');
        showFatalError('Address mismatch - link may be corrupted');
        return;
      }
      console.log('[Claim] Address verified - matches link!');
    }

    // Wait for PXE to sync with the node
    updateStatus('Syncing with network...');
    console.log('[Claim] Checking sync status...');

    try {
      const blockNumber = await wallet.getBlockNumber();
      console.log('[Claim] Current node block:', blockNumber);

      const syncStatus = await wallet.getSyncStatus();
      console.log('[Claim] PXE sync status:', syncStatus);
    } catch (e) {
      console.warn('[Claim] Could not get sync status:', e);
    }

    // Wait a bit for PXE to process blocks
    console.log('[Claim] Waiting 5 seconds for block processing...');
    await sleep(5000);

    // Check balance on the ephemeral account
    updateStatus('Checking payment balance...');
    let balance = await checkEphemeralBalance();
    console.log('[Claim] Initial balance check:', balance);

    // If balance is 0, retry a few times (sync might need more time)
    if (balance === 0n) {
      console.log('[Claim] Balance is 0, retrying...');
      for (let i = 0; i < 3; i++) {
        updateStatus(`Syncing... (attempt ${i + 2})`);
        await sleep(2000);
        balance = await checkEphemeralBalance();
        console.log(`[Claim] Retry ${i + 1} balance:`, balance);
        if (balance > 0n) break;
      }
    }

    if (balance === 0n) {
      showFatalError('This payment has already been claimed or has no balance');
      return;
    }

    // Display payment info
    displayPaymentInfo();

    // Show main app
    loadingScreen.style.display = 'none';
    mainApp.style.display = 'block';

    // Setup event listeners
    setupEventListeners();
  } catch (error) {
    console.error('Initialization error:', error);
    showFatalError(error instanceof Error ? error.message : 'Failed to load payment');
  }
}

async function checkServerHealth(): Promise<{ bridgeEnabled: boolean; evmTokenAddress: string; serverStartupTimestamp: number } | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`);
    const data = await response.json();

    if (data.status === 'ok') {
      return {
        bridgeEnabled: data.bridgeEnabled,
        evmTokenAddress: data.evmTokenAddress,
        serverStartupTimestamp: data.serverStartupTimestamp,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function registerTokenContract() {
  if (!wallet || !paymentData) throw new Error('Wallet or payment data not initialized');

  const address = AztecAddress.fromString(paymentData.tokenAddress);

  // Get contract instance from the node
  const contractInstance = await wallet.getContractInstanceFromNode(address);
  if (contractInstance) {
    await wallet.registerContract(contractInstance, TokenContract.artifact);
  } else {
    throw new Error(`Token contract not found at ${paymentData.tokenAddress}`);
  }

  tokenContract = TokenContract.at(address, wallet.getWallet());
}

async function checkEphemeralBalance(): Promise<bigint> {
  if (!tokenContract || !ephemeralAddress || !wallet) return 0n;

  try {
    console.log('[Claim] Ephemeral address:', ephemeralAddress.toString());
    console.log('[Claim] Token address:', paymentData?.tokenAddress);

    // CRITICAL: Register the SENDER address so PXE knows to look for note tags from them
    // This is required for note discovery across different PXE instances
    if (paymentData?.senderAddress) {
      console.log('[Claim] Registering SENDER address for note discovery:', paymentData.senderAddress);
      const senderAddr = AztecAddress.fromString(paymentData.senderAddress);
      await wallet.registerSender(senderAddr);
    } else {
      console.warn('[Claim] WARNING: No sender address in link data - note discovery may fail');
    }

    // Also register ephemeral address as sender
    console.log('[Claim] Registering ephemeral address as sender...');
    await wallet.registerSender(ephemeralAddress);

    // CRITICAL: Sync PXE to discover the ephemeral account's signing key note
    // This note was created when the account was deployed during link generation
    console.log('[Claim] Syncing PXE to discover signing key note...');
    try {
      await wallet.syncPXE();
      console.log('[Claim] PXE sync completed');
    } catch (e) {
      console.warn('[Claim] PXE sync warning:', e);
    }

    // Also sync token private state
    console.log('[Claim] Calling sync_private_state...');
    try {
      await tokenContract.methods
        .sync_private_state()
        .simulate({ from: ephemeralAddress });
      console.log('[Claim] sync_private_state completed');
    } catch (syncError) {
      console.warn('[Claim] sync_private_state warning:', syncError);
    }

    // Check private balance
    console.log('[Claim] Checking private balance...');
    const privateBalance = await tokenContract.methods
      .balance_of_private(ephemeralAddress)
      .simulate({ from: ephemeralAddress });
    console.log('[Claim] Private balance:', privateBalance);

    return privateBalance;
  } catch (error) {
    console.error('[Claim] Error checking balance:', error);
    return 0n;
  }
}

function displayPaymentInfo() {
  if (!paymentData) return;

  // Display amount
  paymentAmount.textContent = `${paymentData.amount} USDC`;

  // Display message if present
  if (paymentData.message && paymentData.message.trim()) {
    paymentMessage.textContent = paymentData.message;
    messageBox.style.display = 'block';
  }
}

function setupEventListeners() {
  claimBtn.addEventListener('click', handleClaim);

  // Real-time EVM address validation
  evmAddressInput.addEventListener('input', validateEvmAddressInput);
  evmAddressInput.addEventListener('paste', () => {
    // Validate after paste event completes
    setTimeout(validateEvmAddressInput, 0);
  });

  // Enter key on input triggers claim (only if valid)
  evmAddressInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && isValidEvmAddress(evmAddressInput.value.trim())) {
      handleClaim();
    }
  });

  // Wallet action buttons
  switchNetworkBtn.addEventListener('click', switchToBaseSepolia);
  addTokenBtn.addEventListener('click', addTokenToWallet);

  // Manual setup toggle
  toggleManualBtn.addEventListener('click', toggleManualDetails);

  // Copy token address on click
  manualTokenAddress.addEventListener('click', copyTokenAddress);

  // Initial state - disable claim button
  claimBtn.setAttribute('disabled', 'true');
}

/**
 * Check if a string is a valid EVM address
 */
function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate EVM address input and update UI accordingly
 */
function validateEvmAddressInput() {
  const address = evmAddressInput.value.trim();

  // Remove previous validation classes
  evmAddressInput.classList.remove('valid', 'invalid');
  hideError();

  // Empty input - neutral state
  if (!address) {
    claimBtn.setAttribute('disabled', 'true');
    return;
  }

  // Check if it starts with 0x
  if (!address.startsWith('0x')) {
    evmAddressInput.classList.add('invalid');
    claimBtn.setAttribute('disabled', 'true');
    showError('Address must start with 0x');
    return;
  }

  // Check length (0x + 40 hex chars = 42 total)
  if (address.length !== 42) {
    evmAddressInput.classList.add('invalid');
    claimBtn.setAttribute('disabled', 'true');
    if (address.length < 42) {
      showError(`Address too short (${address.length}/42 characters)`);
    } else {
      showError(`Address too long (${address.length}/42 characters)`);
    }
    return;
  }

  // Check if all characters after 0x are valid hex
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    evmAddressInput.classList.add('invalid');
    claimBtn.setAttribute('disabled', 'true');
    showError('Address contains invalid characters (only 0-9, a-f, A-F allowed)');
    return;
  }

  // Valid address
  evmAddressInput.classList.add('valid');
  claimBtn.removeAttribute('disabled');
}

async function handleClaim() {
  const evmAddress = evmAddressInput.value.trim();

  // Validate EVM address
  if (!evmAddress) {
    showError('Please enter your Base Sepolia address');
    return;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
    showError('Invalid address format. Must be a valid EVM address (0x...)');
    return;
  }

  if (!paymentData || !wallet || !tokenContract || !ephemeralAddress) {
    showError('Wallet not initialized');
    return;
  }

  // Show processing view
  hideError();
  claimView.style.display = 'none';
  processingView.style.display = 'block';

  try {
    // Step 1: Initiate bridge session
    // CRITICAL: Pass the ephemeral address as the sender so the bridge can discover notes
    updateProcessingStatus('Initiating bridge session...');
    console.log('[Claim] Initiating bridge for EVM address:', evmAddress);
    console.log('[Claim] Sender address (ephemeral):', ephemeralAddress.toString());

    const bridgeResponse = await fetch(`${API_BASE_URL}/api/bridge/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evmAddress,
        senderAddress: ephemeralAddress.toString(), // Required for bridge to discover notes
      }),
    });

    const bridgeData = await bridgeResponse.json();

    if (!bridgeResponse.ok) {
      throw new Error(bridgeData.error || 'Failed to initiate bridge');
    }

    const bridgeDepositAddress = AztecAddress.fromString(bridgeData.aztecDepositAddress);
    console.log('[Claim] Bridge deposit address:', bridgeDepositAddress.toString());

    // Step 2: Get current balance
    updateProcessingStatus('Checking payment balance...');
    const balance = await checkEphemeralBalance();
    console.log('[Claim] Balance to transfer:', balance);

    if (balance === 0n) {
      throw new Error('Payment has no balance to claim');
    }

    // Step 3: Setup ephemeral account (deploy if needed, create signing key note in THIS PXE)
    updateProcessingStatus('Setting up claim account...');
    console.log('[Claim] Setting up ephemeral account...');

    const secret = Fr.fromString(paymentData.secret);
    const salt = Fr.fromString(paymentData.salt);
    
    // Step 3: Deploy ephemeral account (if needed) and ensure signing key is in our PXE
    // Check if account is already deployed on-chain
    const existingInstance = await wallet.getContractInstanceFromNode(ephemeralAddress);
    
    // CRITICAL: Register the ephemeral address BEFORE deploying so PXE discovers signing key note
    console.log('[Claim] Registering ephemeral address for note discovery...');
    await wallet.registerSender(ephemeralAddress);
    
    if (existingInstance) {
      console.log('[Claim] Account already deployed on-chain, deploying to get signing key in PXE...');
    } else {
      console.log('[Claim] Account not yet deployed, will deploy fresh...');
    }
    
    // Create/deploy the account - this creates/gets the signing key note in claimer's PXE
    const ephemeralAccount = await wallet.createSchnorrAccount(secret, salt, true);
    console.log('[Claim] Account ready at:', ephemeralAccount.address.toString());
    
    // CRITICAL: Wait and sync multiple times to ensure signing key note is discovered
    console.log('[Claim] Waiting for signing key note to be discovered...');
    await sleep(3000);
    await wallet.syncPXE();
    await sleep(2000);
    
    // Also sync to discover shielded token notes
    console.log('[Claim] Syncing to discover shielded token notes...');
    await wallet.syncPXE();

    // Step 4: Transfer from ephemeral account to bridge deposit address
    updateProcessingStatus('Transferring to bridge...');
    console.log('[Claim] Transferring', balance, 'from ephemeral to bridge deposit');

    // Register the bridge deposit address so we can send to it
    await wallet.registerSender(bridgeDepositAddress);

    // Get fee payment method for devnet
    const feePaymentMethod = await wallet.getFeePaymentMethod();

    // Transfer private notes to bridge
    const txOptions: any = { from: ephemeralAddress };
    if (feePaymentMethod) {
      txOptions.fee = { paymentMethod: feePaymentMethod };
    }

    // Send private transfer
    try {
      const tx = tokenContract.methods
        .transfer_private_to_private(ephemeralAddress, bridgeDepositAddress, balance, 0n)
        .send(txOptions);

      console.log('[Claim] Transaction sent, waiting for confirmation...');
      await tx.wait({ timeout: 180 });
      console.log('[Claim] Transfer complete');
    } catch (txError) {
      console.error('[Claim] Transfer error:', txError);

      const errorMsg = txError instanceof Error ? txError.message : String(txError);

      // Check if it's an IDB error or nullifier error - the tx might have already gone through
      if (errorMsg.includes('IDB') || errorMsg.includes('nullifier') || errorMsg.includes('Existing nullifier')) {
        console.log('[Claim] Possible duplicate tx - checking if transfer already succeeded...');
        updateProcessingStatus('Verifying transfer status...');
        await sleep(3000);

        // Check if balance was transferred (balance should now be 0)
        const remainingBalance = await checkEphemeralBalance();
        console.log('[Claim] Remaining balance after error:', remainingBalance);

        if (remainingBalance === 0n) {
          console.log('[Claim] Balance is 0 - transfer already succeeded!');
          // Continue to bridge waiting
        } else if (remainingBalance < balance) {
          console.log('[Claim] Partial transfer detected - continuing...');
          // Some tokens transferred, continue
        } else {
          // Balance unchanged, actual failure
          throw new Error('Transfer failed. Please refresh and try again.');
        }
      } else {
        throw txError;
      }
    }

    // Step 4: Wait for bridge to process
    updateProcessingStatus('Waiting for bridge to mint on Base Sepolia...');
    console.log('[Claim] Waiting for bridge to detect deposit and mint...');

    // Poll for bridge completion (session will be removed when complete)
    const txHash = await waitForBridgeCompletion(bridgeData.aztecDepositAddress, evmAddress);

    // Show success
    successAmount.textContent = paymentData.amount;

    if (txHash) {
      txLink.href = `https://sepolia.basescan.org/tx/${txHash}`;
      txLink.textContent = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;
    } else {
      txLink.href = `https://sepolia.basescan.org/address/${evmAddress}`;
      txLink.textContent = 'View on BaseScan';
    }

    processingView.style.display = 'none';
    successView.style.display = 'block';
  } catch (error) {
    console.error('Claim error:', error);
    processingView.style.display = 'none';
    claimView.style.display = 'block';
    showError(error instanceof Error ? error.message : 'Failed to claim payment');
  }
}

async function waitForBridgeCompletion(aztecDepositAddress: string, evmAddress: string): Promise<string | null> {
  const maxWaitTime = 120000; // 2 minutes
  const pollInterval = 3000; // 3 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/bridge/status/${aztecDepositAddress}`);
      const data = await response.json();

      console.log('[Claim] Bridge status:', data.status);

      if (data.status === 'not_found') {
        // Session removed = bridge completed
        console.log('[Claim] Bridge completed!');
        return null; // We don't have the tx hash from the status endpoint
      }

      if (data.status === 'expired') {
        throw new Error('Bridge session expired');
      }

      updateProcessingStatus(`Waiting for bridge... ${Math.floor((Date.now() - startTime) / 1000)}s`);
    } catch (error) {
      console.error('[Claim] Error checking bridge status:', error);
    }

    await sleep(pollInterval);
  }

  throw new Error('Bridge timed out - please check BaseScan for your transaction');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateStatus(message: string) {
  statusText.textContent = message;
}

function updateProcessingStatus(message: string) {
  processingStatus.textContent = message;
}

function showError(message: string) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
}

function hideError() {
  errorMessage.style.display = 'none';
}

function showFatalError(message: string) {
  loadingScreen.style.display = 'none';
  mainApp.style.display = 'block';
  claimView.style.display = 'none';
  processingView.style.display = 'none';
  successView.style.display = 'none';
  errorView.style.display = 'block';
  errorDetail.textContent = message;
}

// Base Sepolia chain configuration
const BASE_SEPOLIA_CHAIN_ID = '0x14a34'; // 84532 in hex
const BASE_SEPOLIA_CONFIG = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  chainName: 'Base Sepolia',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://sepolia.base.org'],
  blockExplorerUrls: ['https://sepolia.basescan.org'],
};

/**
 * Switch the user's wallet to Base Sepolia network
 */
async function switchToBaseSepolia() {
  if (typeof window.ethereum === 'undefined') {
    alert('No wallet detected. Please install MetaMask or another Web3 wallet.');
    return;
  }

  switchNetworkBtn.setAttribute('disabled', 'true');
  const originalText = switchNetworkBtn.innerHTML;
  switchNetworkBtn.innerHTML = '<span class="spinner" style="width: 18px; height: 18px; border-width: 2px;"></span> Switching...';

  try {
    // Try to switch to Base Sepolia
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
    });

    // Success
    switchNetworkBtn.classList.add('success');
    switchNetworkBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      Switched to Base Sepolia
    `;
    console.log('[Wallet] Successfully switched to Base Sepolia');
  } catch (switchError: any) {
    // Chain not added, try to add it
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [BASE_SEPOLIA_CONFIG],
        });

        // Success after adding
        switchNetworkBtn.classList.add('success');
        switchNetworkBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Added & Switched to Base Sepolia
        `;
        console.log('[Wallet] Added and switched to Base Sepolia');
      } catch (addError) {
        console.error('[Wallet] Failed to add Base Sepolia:', addError);
        switchNetworkBtn.classList.add('error');
        switchNetworkBtn.innerHTML = originalText;
        switchNetworkBtn.removeAttribute('disabled');
        alert('Failed to add Base Sepolia network. Please add it manually.');
        return;
      }
    } else if (switchError.code === 4001) {
      // User rejected
      console.log('[Wallet] User rejected network switch');
      switchNetworkBtn.innerHTML = originalText;
      switchNetworkBtn.removeAttribute('disabled');
      return;
    } else {
      console.error('[Wallet] Failed to switch network:', switchError);
      switchNetworkBtn.classList.add('error');
      switchNetworkBtn.innerHTML = originalText;
      switchNetworkBtn.removeAttribute('disabled');
      alert('Failed to switch network. Please try manually.');
      return;
    }
  }

  // Keep button disabled after success (no need to switch again)
}

/**
 * Add the bUSDC token to the user's wallet
 */
async function addTokenToWallet() {
  if (typeof window.ethereum === 'undefined') {
    alert('No wallet detected. Please install MetaMask or another Web3 wallet.');
    return;
  }

  if (!evmTokenAddress) {
    alert('Token address not available. Please try again.');
    return;
  }

  addTokenBtn.setAttribute('disabled', 'true');
  const originalText = addTokenBtn.innerHTML;
  addTokenBtn.innerHTML = '<span class="spinner" style="width: 18px; height: 18px; border-width: 2px;"></span> Adding...';

  try {
    const wasAdded = await window.ethereum.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: evmTokenAddress,
          symbol: 'bUSDC',
          decimals: 6,
        },
      },
    });

    if (wasAdded) {
      addTokenBtn.classList.add('success');
      addTokenBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
        Token Added
      `;
      console.log('[Wallet] Token added to wallet');
    } else {
      console.log('[Wallet] User declined to add token');
      addTokenBtn.innerHTML = originalText;
      addTokenBtn.removeAttribute('disabled');
    }
  } catch (error) {
    console.error('[Wallet] Failed to add token:', error);
    addTokenBtn.classList.add('error');
    addTokenBtn.innerHTML = originalText;
    addTokenBtn.removeAttribute('disabled');
    alert('Failed to add token. Please add it manually.');
  }

  // Keep button disabled after success (no need to add again)
}

/**
 * Toggle visibility of manual setup details
 */
function toggleManualDetails() {
  const isHidden = manualDetails.style.display === 'none';
  manualDetails.style.display = isHidden ? 'block' : 'none';
  toggleManualBtn.classList.toggle('open', isHidden);

  // Update token address when showing details
  if (isHidden && evmTokenAddress) {
    manualTokenAddress.textContent = evmTokenAddress;
  }
}

/**
 * Copy token address to clipboard
 */
async function copyTokenAddress() {
  if (!evmTokenAddress) return;

  try {
    await navigator.clipboard.writeText(evmTokenAddress);

    // Visual feedback
    const originalText = manualTokenAddress.textContent;
    manualTokenAddress.textContent = 'Copied!';
    manualTokenAddress.style.background = 'var(--success)';
    manualTokenAddress.style.color = 'white';

    setTimeout(() => {
      manualTokenAddress.textContent = originalText;
      manualTokenAddress.style.background = '';
      manualTokenAddress.style.color = '';
    }, 1500);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}

/**
 * Detect if the server was restarted by comparing startup timestamps.
 * If timestamp differs, clear localStorage (user must manually clear site data for IndexedDB issues).
 */
function checkServerRestart(serverTimestamp: number): void {
  const savedTimestamp = localStorage.getItem(SERVER_TIMESTAMP_KEY);

  console.log(`[Server Check] Server timestamp: ${serverTimestamp}, Saved timestamp: ${savedTimestamp}`);

  // First load - just save timestamp
  if (!savedTimestamp) {
    console.log('[Server Check] First load - saving server timestamp');
    localStorage.setItem(SERVER_TIMESTAMP_KEY, serverTimestamp.toString());
    return;
  }

  // Timestamps match - all good
  if (savedTimestamp === serverTimestamp.toString()) {
    console.log('[Server Check] Timestamps match - no restart detected');
    return;
  }

  // Server restarted - clear localStorage
  console.log('[Server Check] Server restart detected! Clearing localStorage...');
  localStorage.clear();
  localStorage.setItem(SERVER_TIMESTAMP_KEY, serverTimestamp.toString());
  console.log('[Server Check] localStorage cleared. If issues persist, clear site data manually.');
}
