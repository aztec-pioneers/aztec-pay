/**
 * AztecPay - Browser-based private payments
 *
 * All Aztec operations run in the browser:
 * - Account creation
 * - Balance queries
 * - Token transfers
 *
 * Server only handles faucet (minting test tokens)
 */

import './style.css';
import { AztecAddress, Fr, EmbeddedWallet } from './embedded-wallet';
import { TokenContract } from '@defi-wonderland/aztec-standards/artifacts/Token';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';

// Configuration
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const STORAGE_KEY = 'aztec-pay-account';

// State
let wallet: EmbeddedWallet;
let tokenAddress: string | null = null;
let tokenContract: typeof TokenContract.prototype | null = null;
let userBalance = '0';

// DOM Elements
const loadingScreen = document.getElementById('loading-screen')!;
const mainApp = document.getElementById('main-app')!;
const statusText = document.getElementById('status-text')!;
const balanceDisplay = document.getElementById('balance-display')!;
const faucetBtn = document.getElementById('faucet-btn')!;
const amountInput = document.getElementById('amount-input') as HTMLInputElement;
const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
const generateBtn = document.getElementById('generate-btn')!;
const errorMessage = document.getElementById('error-message')!;

// Success view elements
const createView = document.getElementById('create-view')!;
const successView = document.getElementById('success-view')!;
const generatedLink = document.getElementById('generated-link') as HTMLInputElement;
const copyBtn = document.getElementById('copy-btn')!;
const newLinkBtn = document.getElementById('new-link-btn')!;
const successAmount = document.getElementById('success-amount')!;

// Initialize on page load
document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
  try {
    // Step 1: Check server for token address
    updateStatus('Checking server...');
    const healthData = await checkServerHealth();

    if (!healthData) {
      updateStatus('Waiting for server to initialize...');
      setTimeout(initialize, 2000);
      return;
    }

    tokenAddress = healthData.tokenAddress;

    // Step 2: Initialize Aztec wallet in browser
    updateStatus('Initializing Aztec client...');
    wallet = await EmbeddedWallet.initialize(AZTEC_NODE_URL);

    // Step 3: Register token contract
    updateStatus('Registering token contract...');
    await registerTokenContract();

    // Step 4: Load or create account
    updateStatus('Setting up account...');
    let account = await wallet.connectExistingAccount();

    if (!account) {
      updateStatus('Creating new account...');
      account = await wallet.createAccountAndConnect();
    }

    // Step 5: Refresh balance
    updateStatus('Loading balance...');
    await refreshBalance();

    // Show main app
    loadingScreen.style.display = 'none';
    mainApp.style.display = 'block';

    // Setup event listeners
    setupEventListeners();
  } catch (error) {
    console.error('Initialization error:', error);
    updateStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    setTimeout(initialize, 3000);
  }
}

async function checkServerHealth(): Promise<{ tokenAddress: string } | null> {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();

    if (data.status === 'ok' && data.tokenAddress) {
      return { tokenAddress: data.tokenAddress };
    }
    return null;
  } catch {
    return null;
  }
}

async function registerTokenContract() {
  if (!tokenAddress) throw new Error('Token address not set');

  // Fetch the contract instance from the Aztec node (not local PXE)
  const address = AztecAddress.fromString(tokenAddress);

  // Get contract instance from the node (which knows about all deployed contracts)
  const contractInstance = await wallet.getContractInstanceFromNode(address);
  if (contractInstance) {
    // Register with local PXE so we can interact with it
    await wallet.registerContract(contractInstance, TokenContract.artifact);
  } else {
    throw new Error(`Token contract not found at ${tokenAddress}`);
  }

  tokenContract = TokenContract.at(address, wallet);
}

async function refreshBalance() {
  if (!tokenContract || !wallet.connectedAccount) return;

  try {
    console.log('[Balance] Account:', wallet.connectedAccount.toString());
    console.log('[Balance] Token:', tokenAddress);

    // Register the account as a sender so PXE tracks notes for it
    console.log('[Balance] Registering sender...');
    await wallet.registerSender(wallet.connectedAccount);

    // Sync private state to discover any new notes (e.g., from mints)
    console.log('[Balance] Syncing private state...');
    await tokenContract.methods
      .sync_private_state()
      .simulate({ from: wallet.connectedAccount });

    // Query public balance (using public mint for debugging)
    console.log('[Balance] Querying PUBLIC balance...');
    const balance = await tokenContract.methods
      .balance_of_public(wallet.connectedAccount)
      .simulate({ from: wallet.connectedAccount });

    console.log('[Balance] Raw balance:', balance);
    userBalance = (balance / 1000000n).toString();
    balanceDisplay.textContent = `${userBalance} USDC`;
    console.log('[Balance] Display balance:', userBalance);
  } catch (error) {
    console.error('Failed to fetch balance:', error);
  }
}

async function faucet() {
  if (!wallet.connectedAccount) return;

  faucetBtn.setAttribute('disabled', 'true');
  faucetBtn.textContent = '...';

  try {
    console.log('[Faucet] Requesting mint for:', wallet.connectedAccount.toString());
    const response = await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet.connectedAccount.toString() }),
    });
    console.log('[Faucet] Response:', response.status);

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Faucet failed');
    }

    await refreshBalance();
  } catch (error) {
    showError(`Faucet failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    faucetBtn.removeAttribute('disabled');
    faucetBtn.textContent = '+';
  }
}

async function generatePaymentLink() {
  const amount = parseFloat(amountInput.value);
  const message = messageInput.value;

  if (!amount || amount <= 0) {
    showError('Please enter an amount greater than 0');
    return;
  }

  if (amount > parseFloat(userBalance)) {
    showError(`Insufficient balance. You have ${userBalance} USDC`);
    return;
  }

  if (!wallet.connectedAccount || !tokenContract || !tokenAddress) {
    showError('Wallet not initialized');
    return;
  }

  generateBtn.setAttribute('disabled', 'true');
  generateBtn.textContent = 'Generating...';
  hideError();

  try {
    // Step 1: Generate ephemeral account credentials
    const ephemeralSecret = Fr.random();
    const ephemeralSalt = Fr.random();

    // Step 2: Create ephemeral account in browser
    const ephemeralAccount = await wallet.createSchnorrAccount(ephemeralSecret, ephemeralSalt);

    // Step 3: Transfer from user account to ephemeral account
    const transferAmount = BigInt(Math.floor(amount * 1000000));
    const credentials = wallet.getStoredCredentials();

    if (!credentials) {
      throw new Error('No account credentials found');
    }

    // Get the sender's account registered
    const senderSecret = Fr.fromString(credentials.secretKey);
    const senderSalt = Fr.fromString(credentials.salt);
    await wallet.createSchnorrAccount(senderSecret, senderSalt);

    console.log(`[Transfer] From: ${wallet.connectedAccount.toString()}`);
    console.log(`[Transfer] To: ${ephemeralAccount.address.toString()}`);
    console.log(`[Transfer] Amount: ${transferAmount}`);

    // Using public_to_private since we're using public balance for now
    await tokenContract.methods
      .transfer_public_to_private(
        wallet.connectedAccount,
        ephemeralAccount.address,
        transferAmount,
        0n
      )
      .send({ from: wallet.connectedAccount })
      .wait({ timeout: 120 });

    // Step 4: Create payment link
    const linkData = btoa(
      JSON.stringify({
        secret: ephemeralSecret.toString(),
        salt: ephemeralSalt.toString(),
        amount: amount.toString(),
        message: message || '',
        tokenAddress: tokenAddress,
      })
    );

    const link = `${window.location.origin}/claim?data=${linkData}`;

    // Show success view
    generatedLink.value = link;
    successAmount.textContent = amount.toFixed(2);
    createView.style.display = 'none';
    successView.style.display = 'block';

    // Refresh balance
    await refreshBalance();
  } catch (error) {
    console.error('Failed to generate payment link:', error);
    showError(error instanceof Error ? error.message : 'Something went wrong');
  } finally {
    generateBtn.removeAttribute('disabled');
    generateBtn.textContent = 'Generate Payment Link';
  }
}

function setupEventListeners() {
  faucetBtn.addEventListener('click', faucet);
  generateBtn.addEventListener('click', generatePaymentLink);

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(generatedLink.value);
      copyBtn.textContent = '✓';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 2000);
    } catch {
      showError('Failed to copy to clipboard');
    }
  });

  newLinkBtn.addEventListener('click', () => {
    amountInput.value = '';
    messageInput.value = '';
    successView.style.display = 'none';
    createView.style.display = 'block';
    hideError();
  });
}

function updateStatus(message: string) {
  statusText.textContent = message;
}

function showError(message: string) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
}

function hideError() {
  errorMessage.style.display = 'none';
}
