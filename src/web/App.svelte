<script lang="ts">
  import "./app.css";

  type View = 'create' | 'success';

  let amount = $state<number | null>(null);
  let message = $state("");
  let isGenerating = $state(false);
  let generatedLink = $state("");
  let currentView = $state<View>('create');
  let serverReady = $state(false);
  let errorMessage = $state("");
  let copySuccess = $state(false);

  // Check server health on mount
  $effect(() => {
    checkServerHealth();
  });

  async function checkServerHealth() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();

      if (data.status === "ok") {
        serverReady = true;
      } else if (data.status === "initializing") {
        setTimeout(checkServerHealth, 2000);
      }
    } catch {
      setTimeout(checkServerHealth, 3000);
    }
  }

  async function generatePaymentLink() {
    if (!amount || amount <= 0 || amount > 100) {
      errorMessage = "Please enter an amount between 0 and 100 USDC";
      return;
    }

    isGenerating = true;
    errorMessage = "";

    try {
      const response = await fetch("/api/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, message }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate payment link");
      }

      // Encode data as base64
      const linkData = btoa(JSON.stringify({
        secret: data.secret,
        salt: data.salt,
        amount: data.amount,
        message: data.message,
        tokenAddress: data.tokenAddress
      }));

      // Create the payment link
      generatedLink = `${window.location.origin}/claim?data=${linkData}`;
      currentView = 'success';
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

{#if !serverReady}
  <!-- Loading/Initialization Screen -->
  <div class="loading-screen">
    <h1 class="logo">Aztec<span>Pay</span></h1>
    <p class="tagline">Private payments, simplified</p>

    <div class="loader">
      <div class="spinner"></div>
      <p class="loader-text">Initializing your payment experience<span class="loading-dots"></span></p>
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
                max="100"
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
            <span class="tip-text">Tip: Recipients can claim on any blockchain</span>
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
          <span class="feature-icon">🌐</span>
          <span class="feature-text">Any blockchain</span>
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
