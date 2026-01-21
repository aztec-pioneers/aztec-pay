// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/BridgedUSDC.sol";

contract DeployScript is Script {
    function run() external {
        // Use the private key passed via --private-key flag
        vm.startBroadcast();

        BridgedUSDC token = new BridgedUSDC();

        console.log("BridgedUSDC deployed at:", address(token));

        vm.stopBroadcast();

        // Write deployment address to file for server to pick up
        string memory deploymentInfo = vm.toString(address(token));
        vm.writeFile("../evm-deployment.json", string.concat('{"address":"', deploymentInfo, '"}'));
        console.log("Deployment info written to evm-deployment.json");
    }
}
