<script lang="ts">
  import "./app.css";
  import {
    initializeAztec,
    isAztecReady,
    createAccount,
    getBalance,
    transferPrivate,
    generateRandomSecret,
  } from "./aztec-client";

  type View = 'create' | 'success';

  interface AccountCredentials {
    secret: string;
    salt: string;
    address: string;
  }

  let amount = $state<number | null>(null);
  let message = $state("");
  let isGenerating = $state(false);
  let generatedLink = $state("");
  let currentView = $state<View>('create');
  let serverReady = $state(false);
  let aztecReady = $state(false);
  let errorMessage = $state("");
  let copySuccess = $state(false);
  let initStatus = $state("Connecting to server...");

  // User account state
  let userAccount = $state<AccountCredentials | null>(null);
  let balance = $state<string>("0");
  let isFauceting = $state(false);
  let isLoadingBalance = $state(false);
  let tokenAddress = $state<string | null>(null);

  const STORAGE_KEY = "aztecAccount";

  // Initialize on mount
  $effect(() => {
    initialize();
  });

  async function initialize() {
    try {
      // Step 1: Check server health to get token address
      initStatus = "Checking server...";
      const healthData = await checkServerHealth();

      if (!healthData) {
        return; // Will retry via setTimeout
      }

      tokenAddress = healthData.tokenAddress;
      serverReady = true;

      // Step 2: Initialize Aztec client in browser
      initStatus = "Initializing Aztec client...";
      await initializeAztec();
      aztecReady = true;

      // Step 3: Load or create user account
      initStatus = "Setting up account...";
      await initializeAccount();

      initStatus = "Ready!";
    } catch (error) {
      console.error("Initialization error:", error);
      initStatus = `Error: ${error instanceof Error ? error.message : String(error)}`;
      setTimeout(initialize, 3000);
    }
  }

  async function checkServerHealth(): Promise<{ tokenAddress: string } | null> {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();

      if (data.status === "ok" && data.tokenAddress) {
        return { tokenAddress: data.tokenAddress };
      } else if (data.status === "initializing") {
        initStatus = "Server is deploying contracts...";
        setTimeout(initialize, 2000);
        return null;
      }
      return null;
    } catch {
      initStatus = "Waiting for server...";
      setTimeout(initialize, 3000);
      return null;
    }
  }

  async function initializeAccount() {
    // Check localStorage for existing account
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Re-register account with browser's Aztec client
      const account = await createAccount(parsed.secret, parsed.salt);
      userAccount = {
        secret: parsed.secret,
        salt: parsed.salt,
        address: account.address,
      };
      await refreshBalance();
    } else {
      await createNewAccount();
    }
  }

  async function createNewAccount() {
    try {
      // Generate secrets and create account in browser
      const secret = generateRandomSecret();
      const salt = generateRandomSecret();

      const account = await createAccount(secret, salt);

      userAccount = { secret, salt, address: account.address };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userAccount));
      await refreshBalance();
    } catch (error) {
      console.error("Failed to create account:", error);
      errorMessage = `Failed to create account: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function refreshBalance() {
    if (!userAccount || !tokenAddress) return;

    isLoadingBalance = true;
    try {
      // Query balance directly from browser
      const rawBalance = await getBalance(tokenAddress, userAccount.address);
      const formattedBalance = (rawBalance / 1000000n).toString();
      balance = formattedBalance;
    } catch (error) {
      console.error("Failed to fetch balance:", error);
    } finally {
      isLoadingBalance = false;
    }
  }

  async function faucet() {
    if (!userAccount || isFauceting) return;

    isFauceting = true;
    try {
      // Only API call - server mints tokens to our address
      const response = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: userAccount.address }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Faucet failed");
      }

      // Refresh balance from browser
      await refreshBalance();
    } catch (error) {
      console.error("Faucet failed:", error);
      errorMessage = `Faucet failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isFauceting = false;
    }
  }

  async function generatePaymentLink() {
    if (!amount || amount <= 0) {
      errorMessage = "Please enter an amount greater than 0";
      return;
    }

    if (!userAccount || !tokenAddress) {
      errorMessage = "Account not initialized";
      return;
    }

    // Check if user has sufficient balance
    const currentBalance = parseFloat(balance);
    if (amount > currentBalance) {
      errorMessage = `Insufficient balance. You have ${balance} USDC`;
      return;
    }

    isGenerating = true;
    errorMessage = "";

    try {
      // Step 1: Generate ephemeral account credentials in browser
      const ephemeralSecret = generateRandomSecret();
      const ephemeralSalt = generateRandomSecret();

      // Step 2: Create ephemeral account in browser
      const ephemeralAccount = await createAccount(ephemeralSecret, ephemeralSalt);

      // Step 3: Transfer from user account to ephemeral account (browser-direct)
      const transferAmount = BigInt(Math.floor(amount * 1000000));
      await transferPrivate(
        tokenAddress,
        userAccount.secret,
        userAccount.salt,
        ephemeralAccount.address,
        transferAmount
      );

      // Encode data as base64
      const linkData = btoa(JSON.stringify({
        secret: ephemeralSecret,
        salt: ephemeralSalt,
        amount: amount.toString(),
        message: message || "",
        tokenAddress: tokenAddress
      }));

      // Create the payment link
      generatedLink = `${window.location.origin}/claim?data=${linkData}`;
      currentView = 'success';

      // Refresh balance after transfer
      await refreshBalance();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Something went wrong";
    } finally {
      isGenerating = false;
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(generatedLink);
      copySuccess = true;
      setTimeout(() => {
        copySuccess = false;
      }, 2000);
    } catch {
      errorMessage = "Failed to copy to clipboard";
    }
  }

  function createNewLink() {
    amount = null;
    message = "";
    generatedLink = "";
    currentView = 'create';
    errorMessage = "";
    copySuccess = false;
  }

  function formatAmountDisplay(val: number | null): string {
    if (val === null) return "0.00";
    return val.toFixed(2);
  }
</script>

{#if !serverReady || !aztecReady}
  <!-- Loading/Initialization Screen -->
  <div class="loading-screen">
    <h1 class="logo">Aztec<span>Pay</span></h1>
    <p class="tagline">Private payments, simplified</p>

    <div class="loader">
      <div class="spinner"></div>
      <p class="loader-text">{initStatus}<span class="loading-dots"></span></p>
    </div>
  </div>
{:else}
  <!-- Main App -->
  <main class="container fade-in">
    <!-- Header -->
    <header class="header">
      <div class="header-logo">
        <div class="logo-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </div>
        <span class="logo-text">Aztec<span>Pay</span></span>
      </div>
      <div class="balance-section">
        <span class="balance-amount">
          {#if isLoadingBalance}
            <span class="balance-loading">...</span>
          {:else}
            {balance} USDC
          {/if}
        </span>
        <button
          class="faucet-btn"
          onclick={faucet}
          disabled={isFauceting}
          title="Get test USDC from faucet"
        >
          {#if isFauceting}
            <span class="spinner faucet-spinner"></span>
          {:else}
            +
          {/if}
        </button>
      </div>
    </header>

    {#if currentView === 'create'}
      <!-- Create Payment Link View -->
      <div class="card">
        <div class="card-content">
          <h2 class="card-title">Create a payment link</h2>
          <p class="card-subtitle">Enter the details below to generate your link</p>

          <div class="form-group">
            <label class="form-label" for="amount">Amount</label>
            <div class="input-with-select">
              <input
                id="amount"
                type="number"
                class="form-input"
                placeholder="0.00"
                min="0.01"
                step="0.01"
                bind:value={amount}
              />
              <div class="currency-select">
                <span>USDC</span>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="message">Message (optional)</label>
            <textarea
              id="message"
              class="form-textarea"
              placeholder="Add a note for the recipient..."
              rows="3"
              bind:value={message}
            ></textarea>
          </div>

          <div class="tip-box">
            <span class="tip-icon">💡</span>
            <span class="tip-text">Tip: All operations run in your browser - fully private!</span>
          </div>

          {#if errorMessage}
            <div class="error-message">{errorMessage}</div>
          {/if}

          <button
            class="btn btn-primary btn-generate"
            onclick={generatePaymentLink}
            disabled={isGenerating || !amount}
          >
            {#if isGenerating}
              <span class="spinner btn-spinner"></span>
              Generating...
            {:else}
              Generate Payment Link
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            {/if}
          </button>
        </div>
      </div>

      <!-- Feature Badges -->
      <div class="feature-badges">
        <div class="feature-badge">
          <span class="feature-icon">🔒</span>
          <span class="feature-text">Secure</span>
        </div>
        <div class="feature-badge">
          <span class="feature-icon">⚡</span>
          <span class="feature-text">Instant</span>
        </div>
        <div class="feature-badge">
          <span class="feature-icon">🖥️</span>
          <span class="feature-text">Browser-native</span>
        </div>
      </div>

    {:else if currentView === 'success'}
      <!-- Success View -->
      <div class="card success-card">
        <div class="card-content">
          <div class="success-icon-wrapper">
            <div class="success-icon">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h2 class="success-title">Payment link created!</h2>
          <p class="success-subtitle">Share this link to receive <strong>{formatAmountDisplay(amount)} USDC</strong></p>

          {#if message}
            <div class="message-preview">
              <span class="message-label">Message:</span>
              <span class="message-content">"{message}"</span>
            </div>
          {/if}

          <div class="link-box">
            <input
              type="text"
              class="link-input"
              value={generatedLink}
              readonly
            />
            <button class="btn-copy" onclick={copyToClipboard}>
              {#if copySuccess}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              {/if}
            </button>
          </div>

          {#if copySuccess}
            <p class="copy-feedback">Copied to clipboard!</p>
          {/if}

          <button class="btn btn-secondary" onclick={createNewLink}>
            Create another link
          </button>
        </div>
      </div>
    {/if}
  </main>
{/if}
