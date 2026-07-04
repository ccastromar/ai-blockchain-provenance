/* tslint:disable */
/* eslint-disable */
/**
 * Verify an Ernest evidence receipt (GET /api/blocks/:index/proof) fully
 * offline: block data must reproduce the block hash (shared canonicalization,
 * pinned by testdata/hash-golden-vectors.json) and the hash must climb the
 * Merkle proof to the anchored root (keccak256, sorted pairs, pinned by
 * testdata/merkle-proof-golden.json). Returns a JSON verdict object.
 */
export function verify_receipt(receipt_json: string): string;
/**
 * Calculate the Merkle root from an array of hash strings
 * 
 * # Arguments
 * * `hashes` - Vector of hex-encoded hash strings
 * 
 * # Returns
 * * `Result<String, JsValue>` - Merkle root as hex string or error
 */
export function calculate_merkle_root(hashes: string[]): string;
/**
 * Hash a string using SHA-256
 * 
 * # Arguments
 * * `data` - String to hash
 * 
 * # Returns
 * * Hex-encoded SHA-256 hash
 */
export function hash_data(data: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly verify_receipt: (a: number, b: number) => [number, number];
  readonly calculate_merkle_root: (a: number, b: number) => [number, number, number, number];
  readonly hash_data: (a: number, b: number) => [number, number];
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
