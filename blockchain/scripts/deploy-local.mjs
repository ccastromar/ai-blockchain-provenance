import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(__dirname, '../artifacts/contracts/ErnestMerkleAnchor.sol/ErnestMerkleAnchor.json');
const rpcUrl = process.env.LOCAL_CHAIN_RPC_URL ?? 'http://local-chain:8545';
const privateKey = process.env.LOCAL_CHAIN_PRIVATE_KEY
  ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const outputPath = process.env.LOCAL_CHAIN_DEPLOYMENT_ENV ?? '/deployments/local-chain.env';

async function waitForRpc(provider) {
  const deadline = Date.now() + 60_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await provider.getBlockNumber();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 1_000));
    }
  }

  throw new Error(`Local chain did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
const provider = new ethers.JsonRpcProvider(rpcUrl);
await waitForRpc(provider);

const wallet = new ethers.Wallet(privateKey, provider);
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const contract = await factory.deploy();
const receipt = await contract.deploymentTransaction()?.wait();
const address = await contract.getAddress();
const network = await provider.getNetwork();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, [
  `INFURA_URL=${rpcUrl}`,
  `PRIVATE_KEY=${privateKey}`,
  `CONTRACT_ADDRESS=${address}`,
  `LOCAL_CHAIN_ID=${network.chainId.toString()}`,
  ''
].join('\n'));

console.log(`ErnestMerkleAnchor deployed to ${address}`);
console.log(`chainId=${network.chainId.toString()} block=${receipt?.blockNumber ?? 'unknown'}`);
console.log(`deploymentEnv=${outputPath}`);
