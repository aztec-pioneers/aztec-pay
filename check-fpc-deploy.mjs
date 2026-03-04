import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { Fr } from '@aztec/aztec.js/fields';

const node = createAztecNodeClient('http://localhost:8080');

// Check node info - what L1 contracts are deployed?
const nodeInfo = await node.getNodeInfo();
console.log('L1 Chain ID:', nodeInfo.l1ChainId);
console.log('L1 Contract Addresses:', JSON.stringify(nodeInfo.l1ContractAddresses, null, 2).slice(0, 1000));

// Check if there are any protocol contract addresses
console.log('\nProtocol Contract Addresses:', JSON.stringify(nodeInfo.protocolContractAddresses, null, 2));
