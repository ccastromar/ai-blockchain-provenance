import { ethers } from 'ethers';

const providers = new Map<string, ethers.JsonRpcProvider>();

/**
 * One JSON-RPC provider per URL for the life of the process.
 *
 * ethers v6 providers are long-lived objects: each one detects the network in the
 * background and keeps retrying if the RPC endpoint is unhappy. Creating a new provider
 * per call (per anchor, per health probe) leaked one such retry loop each time, and under
 * load turned a rate-limited RPC (Infura "Too Many Requests") into a flood of requests and,
 * eventually, an unhandled rejection that killed the process. Batching is disabled so a
 * rate-limit reply is attributed to its own request instead of failing a whole batch with
 * "missing response for request".
 */
export function rpcProvider(url: string): ethers.JsonRpcProvider {
  let provider = providers.get(url);
  if (!provider) {
    provider = new ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 });
    providers.set(url, provider);
  }
  return provider;
}
