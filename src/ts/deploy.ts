import { writeFileSync } from "fs";
import { setupSandbox, getTestWallet, deployToken } from "./utils.js";

async function main() {
  console.log("Connecting to Aztec sandbox...");
  const node = await setupSandbox();

  console.log("Creating test wallet with minter account...");
  const { wallet, accounts } = await getTestWallet(node);
  const minterAddress = accounts[0];
  console.log(`Minter address: ${minterAddress.toString()}`);

  console.log("Deploying USDC token...");
  const token = await deployToken(wallet, minterAddress, "USDC", "USDC", 6);
  const tokenAddress = token.address.toString();
  console.log(`Token deployed at: ${tokenAddress}`);

  const deployment = {
    tokenAddress,
    minterAddress: minterAddress.toString(),
  };

  writeFileSync("deployment.json", JSON.stringify(deployment, null, 2));
  console.log("Deployment saved to deployment.json");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
