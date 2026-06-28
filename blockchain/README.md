# Ernest Blockchain

Hardhat project for the `ErnestMerkleAnchor` contract used by the backend anchoring flow.

The contract stores no private AI data. It emits an `Anchored` event with:

- Merkle root.
- Technical wallet address.
- Organization ID and name.
- Domain.
- Block timestamp.

## Local Chain

Run a local Hardhat chain for self-contained anchoring demos:

```bash
pnpm --filter blockchain local:node
```

Deploy the contract to a running local chain:

```bash
LOCAL_CHAIN_RPC_URL=http://127.0.0.1:8545 pnpm --filter blockchain local:deploy
```

The Docker Compose path is usually easier:

```bash
cp .env.local-chain.example .env.local-chain
docker compose -f docker-compose.yml -f docker-compose.local-chain.yml --env-file .env.local-chain up -d --build
```

The backend then uses:

```text
INFURA_URL=http://local-chain:8545
CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
```

That address is the deterministic first deployment address for the default Hardhat account on a fresh local chain.

## Compile

```bash
pnpm --filter blockchain compile
```

## Sepolia

For public proof-of-existence demos, configure the backend with a Sepolia RPC URL, a low-fund private key, and a deployed `ErnestMerkleAnchor` address.
