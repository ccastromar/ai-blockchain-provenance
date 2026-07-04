//! Offline verification of Ernest evidence receipts (GET /api/blocks/:index/proof)
//! for the browser: block data → block hash (canonical.rs, pinned by
//! testdata/hash-golden-vectors.json) and block hash → anchored Merkle root
//! (keccak256, sorted pairs, pinned by testdata/merkle-proof-golden.json).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tiny_keccak::{Hasher, Keccak};

use crate::canonical;

#[derive(Deserialize)]
struct Receipt {
    block: ReceiptBlock,
    proof: Vec<String>,
    #[serde(rename = "merkleRoot")]
    merkle_root: String,
}

#[derive(Deserialize)]
struct ReceiptBlock {
    index: i64,
    timestamp: i64,
    #[serde(rename = "previousHash")]
    previous_hash: String,
    hash: String,
    data: Value,
}

#[derive(Serialize)]
pub struct Verification {
    pub valid: bool,
    #[serde(rename = "dataMatchesHash")]
    pub data_matches_hash: bool,
    #[serde(rename = "proofReachesRoot")]
    pub proof_reaches_root: bool,
    #[serde(rename = "computedHash")]
    pub computed_hash: String,
    #[serde(rename = "proofLength")]
    pub proof_length: usize,
    pub error: Option<String>,
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak::v256();
    let mut output = [0u8; 32];
    hasher.update(data);
    hasher.finalize(&mut output);
    output
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    hex::decode(value.trim_start_matches("0x")).map_err(|e| format!("invalid hex {:?}: {}", value, e))
}

/// Walks a sorted-pairs keccak256 proof path from a leaf to a root.
pub fn proof_reaches_root(leaf_hash: &str, proof: &[String], merkle_root: &str) -> Result<bool, String> {
    let mut current = decode_hex(leaf_hash)?;
    let root = decode_hex(merkle_root)?;

    for sibling in proof {
        let sibling_bytes = decode_hex(sibling)?;
        let mut pair = Vec::with_capacity(current.len() + sibling_bytes.len());
        if current <= sibling_bytes {
            pair.extend_from_slice(&current);
            pair.extend_from_slice(&sibling_bytes);
        } else {
            pair.extend_from_slice(&sibling_bytes);
            pair.extend_from_slice(&current);
        }
        current = keccak256(&pair).to_vec();
    }

    Ok(current == root)
}

/// Full receipt verification from the raw JSON string.
pub fn verify_receipt_json(receipt_json: &str) -> Verification {
    let failed = |error: String| Verification {
        valid: false,
        data_matches_hash: false,
        proof_reaches_root: false,
        computed_hash: String::new(),
        proof_length: 0,
        error: Some(error),
    };

    let receipt: Receipt = match serde_json::from_str(receipt_json) {
        Ok(r) => r,
        Err(e) => return failed(format!("receipt is not valid JSON: {}", e)),
    };

    let computed_hash = match canonical::block_hash(
        receipt.block.index,
        receipt.block.timestamp,
        &receipt.block.data,
        &receipt.block.previous_hash,
    ) {
        Ok(h) => h,
        Err(e) => return failed(format!("cannot canonicalize block data: {}", e)),
    };
    let data_matches_hash = computed_hash == receipt.block.hash.trim_start_matches("0x");

    let proof_ok = match proof_reaches_root(&receipt.block.hash, &receipt.proof, &receipt.merkle_root) {
        Ok(ok) => ok,
        Err(e) => return failed(e),
    };

    Verification {
        valid: data_matches_hash && proof_ok,
        data_matches_hash,
        proof_reaches_root: proof_ok,
        computed_hash,
        proof_length: receipt.proof.len(),
        error: None,
    }
}
