//! ADR-004 evidence batches: RFC 6962 / RFC 9162 Merkle trees over SHA-256, with
//! domain-separated leaves (0x00) and interior nodes (0x01) and no pair sorting.
//! Mirrors backend/src/blockchain/merkle-rfc6962.ts; pinned cross-language by
//! testdata/rfc6962-golden.json. Distinct from the keccak sorted-pair anchor tree.

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::canonical;

pub const TREE_ALG: &str = "rfc6962-sha256";

fn leaf_of_bytes(bytes: &[u8]) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update([0x00]);
    h.update(bytes);
    h.finalize().to_vec()
}

fn node(left: &[u8], right: &[u8]) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update([0x01]);
    h.update(left);
    h.update(right);
    h.finalize().to_vec()
}

/// SHA-256(0x00 || JCS(data)), hex -- same canonical bytes as the block hash's `data`.
pub fn leaf_hash(data: &Value) -> Result<String, String> {
    Ok(hex::encode(leaf_of_bytes(canonical::canonical_json(data)?.as_bytes())))
}

/// Leaf hash of raw bytes (the CT reference vectors).
pub fn raw_leaf_hash(bytes: &[u8]) -> String {
    hex::encode(leaf_of_bytes(bytes))
}

fn split_point(n: usize) -> usize {
    let mut k = 1;
    while k << 1 < n {
        k <<= 1;
    }
    k
}

fn mth(leaves: &[Vec<u8>]) -> Vec<u8> {
    match leaves.len() {
        0 => Sha256::digest([]).to_vec(),
        1 => leaves[0].clone(),
        n => {
            let k = split_point(n);
            node(&mth(&leaves[..k]), &mth(&leaves[k..]))
        }
    }
}

fn decode_all(hexes: &[String]) -> Result<Vec<Vec<u8>>, String> {
    hexes
        .iter()
        .map(|h| hex::decode(h).map_err(|e| format!("invalid hex {:?}: {}", h, e)))
        .collect()
}

/// Merkle Tree Hash over leaf hashes (hex, in leaf order).
pub fn root(leaf_hashes: &[String]) -> Result<String, String> {
    Ok(hex::encode(mth(&decode_all(leaf_hashes)?)))
}

/// RFC 9162 §2.1.3.2 inclusion verification.
pub fn verify_inclusion(leaf_hash: &str, index: u64, size: u64, proof: &[String], root: &str) -> Result<bool, String> {
    if index >= size {
        return Ok(false);
    }
    let mut r = hex::decode(leaf_hash).map_err(|e| format!("invalid leaf hash: {}", e))?;
    let want = hex::decode(root).map_err(|e| format!("invalid root: {}", e))?;
    let (mut fn_, mut sn) = (index, size - 1);
    for p in decode_all(proof)? {
        if sn == 0 {
            return Ok(false);
        }
        if fn_ % 2 == 1 || fn_ == sn {
            r = node(&p, &r);
            while fn_ % 2 == 0 && fn_ != 0 {
                fn_ >>= 1;
                sn >>= 1;
            }
        } else {
            r = node(&r, &p);
        }
        fn_ >>= 1;
        sn >>= 1;
    }
    Ok(sn == 0 && r == want)
}
