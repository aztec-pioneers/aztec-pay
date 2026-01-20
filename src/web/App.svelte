<script lang="ts">
  import "./app.css";

  let address = $state("");
  let secret = $state("");
  let salt = $state("");
  let balance = $state("0");
  let status = $state("Checking server...");
  let isLoading = $state(false);
  let serverReady = $state(false);

  // Check server health and load saved account on mount
  $effect(() => {
    checkServerHealth();

    const savedAddress = localStorage.getItem("aztec_address");
    const savedSecret = localStorage.getItem("aztec_secret");
    const savedSalt = localStorage.getItem("aztec_salt");

    if (savedAddress && savedSecret && savedSalt) {
      address = savedAddress;
      secret = savedSecret;
      salt = savedSalt;
    }
  });

  // Refresh balance when server is ready and account exists
  $effect(() => {
    if (serverReady && address && secret && salt) {
      refreshBalance();
    }
  });

  async function checkServerHealth() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();

      if (data.status === "ok") {
        serverReady = true;
        status = "Ready";
      } else if (data.status === "initializing") {
        status = "Server initializing, please wait...";
        setTimeout(checkServerHealth, 2000);
      }
    } catch {
      status = "Server not available. Make sure to run: npm run server";
      setTimeout(checkServerHealth, 3000);
    }
  }

  async function generateAccount() {
    isLoading = true;
    status = "Generating account...";

    try {
      const response = await fetch("/api/account", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate account");
      }

      address = data.address;
      secret = data.secret;
      salt = data.salt;
      balance = "0";

      // Save to localStorage
      localStorage.setItem("aztec_address", address);
      localStorage.setItem("aztec_secret", secret);
      localStorage.setItem("aztec_salt", salt);

      status = "Account generated!";
    } catch (error) {
      status = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
    } finally {
      isLoading = false;
    }
  }

  async function requestFaucet() {
    if (!address) {
      status = "Please generate an account first";
      return;
    }

    isLoading = true;
    status = "Requesting USDC...";

    try {
      const response = await fetch("/api/faucet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to request faucet");
      }

      status = `Received ${data.amount} USDC!`;

      await refreshBalance();
    } catch (error) {
      status = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
    } finally {
      isLoading = false;
    }
  }

  async function refreshBalance() {
    if (!secret || !salt) return;

    try {
      const response = await fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, salt }),
      });

      const data = await response.json();

      if (response.ok) {
        balance = data.balance;
      }
    } catch (error) {
      console.error("Failed to refresh balance:", error);
    }
  }
</script>

<main>
  <div class="container">
    <h1>AZTEC PAY FAUCET</h1>

    <div class="card">
      <button onclick={generateAccount} disabled={isLoading || !serverReady}>
        {isLoading ? "Loading..." : "Generate Account"}
      </button>

      {#if address}
        <div class="info">
          <label>Your Address:</label>
          <code class="address">{address}</code>
        </div>

        <div class="info">
          <label>Balance:</label>
          <span class="balance">{balance} USDC</span>
        </div>

        <button onclick={requestFaucet} disabled={isLoading || !serverReady} class="faucet-btn">
          {isLoading ? "Processing..." : "Request 1000 USDC"}
        </button>

        <button onclick={refreshBalance} disabled={isLoading || !serverReady} class="refresh-btn">
          Refresh Balance
        </button>
      {/if}

      <div class="status">
        Status: {status}
      </div>
    </div>
  </div>
</main>
