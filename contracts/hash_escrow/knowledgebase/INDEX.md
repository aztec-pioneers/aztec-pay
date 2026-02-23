# Aztec Web Development Knowledgebase - Index

Welcome to the Aztec Web Development Knowledgebase. This collection of documents contains all the knowledge needed to build browser-based Aztec applications that deploy to devnet.

## Knowledgebase Structure

### Getting Started

| File | Description |
|------|-------------|
| [README.md](./README.md) | Comprehensive guide covering all aspects of Aztec web development |
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | Copy-paste templates and quick fixes for common issues |

### Guides

| File | Description |
|------|-------------|
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | Step-by-step guide for deploying contracts to devnet |
| [TEMPLATES.md](./TEMPLATES.md) | Complete, ready-to-use code templates |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common issues and their solutions |
| [IMPORTS_REFERENCE.md](./IMPORTS_REFERENCE.md) | Complete reference for Aztec SDK imports |

## Quick Links

### Most Common Tasks

- **Setup new project**: See [TEMPLATES.md](./TEMPLATES.md#project-structure)
- **Fix build errors**: See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#build-errors)
- **Deploy contract**: See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md#step-by-step-deployment)
- **Copy config files**: See [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)

### Critical Information

- **Current devnet version**: `3.0.0-devnet.6-patch.1`
- **Devnet URL**: `https://devnet-6.aztec-labs.com`
- **SponsoredFPC**: `0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e`

## Important Reminders

When building Aztec web applications, always remember:

1. **Use Webpack, not Vite** - Better WASM support
2. **Enable proving** - `proverEnabled: true` required for devnet
3. **Register SponsoredFPC** - Must register before using for fees
4. **Use AztecAddress.ZERO** - For account contract deployment
5. **Lazy import TestWallet** - `await import("@aztec/test-wallet/client/lazy")`
6. **Store node separately** - `wallet.getNode()` doesn't work in browser
7. **Match versions exactly** - All @aztec/* packages must use same version

## Version Information

- **Knowledgebase Version**: 1.0.0
- **Last Updated**: 2026-02-16
- **Devnet Version**: 3.0.0-devnet.6-patch.1
- **Compatible Aztec CLI**: 0.70.0+

## Resources

- [Official Aztec Docs](https://docs.aztec.network/)
- [Aztec Web Starter](https://github.com/AztecProtocol/aztec-web-starter)
- [Aztec Examples](https://github.com/AztecProtocol/aztec-examples)
- [Aztec Playground](https://playground.aztec.network)
- [AztecScan Explorer](https://aztecscan.xyz/)
