use wasm_bindgen::prelude::*;
use sha2::{Sha256, Digest};

pub mod canonical;
pub mod receipt;
pub mod signing;

/// Verify an Ernest evidence receipt (GET /api/blocks/:index/proof) fully
/// offline: block data must reproduce the block hash (shared canonicalization,
/// pinned by testdata/hash-golden-vectors.json) and the hash must climb the
/// Merkle proof to the anchored root (keccak256, sorted pairs, pinned by
/// testdata/merkle-proof-golden.json). Returns a JSON verdict object.
#[wasm_bindgen]
pub fn verify_receipt(receipt_json: &str) -> String {
    let verification = receipt::verify_receipt_json(receipt_json);
    serde_json::to_string(&verification)
        .unwrap_or_else(|e| format!("{{\"valid\":false,\"error\":\"serialize: {}\"}}", e))
}

#[cfg(target_arch = "wasm32")]
fn js_error(message: &str) -> JsValue {
    JsValue::from_str(message)
}

#[cfg(not(target_arch = "wasm32"))]
fn js_error(_message: &str) -> JsValue {
    JsValue::NULL
}

/// Calculate the Merkle root from an array of hash strings
/// 
/// # Arguments
/// * `hashes` - Vector of hex-encoded hash strings
/// 
/// # Returns
/// * `Result<String, JsValue>` - Merkle root as hex string or error
#[wasm_bindgen]
pub fn calculate_merkle_root(hashes: Vec<String>) -> Result<String, JsValue> {
    if hashes.is_empty() {
        return Err(js_error("Cannot calculate merkle root from empty array"));
    }

    // Convert hex strings to byte arrays
    let mut leaves: Vec<Vec<u8>> = Vec::new();
    for hash_str in hashes {
        let bytes = hex::decode(&hash_str)
            .map_err(|e| js_error(&format!("Invalid hex string: {}", e)))?;
        leaves.push(bytes);
    }

    // Build merkle tree
    let root = build_merkle_tree(leaves)?;
    
    // Convert result to hex string
    Ok(hex::encode(root))
}

/// Build a Merkle tree from leaf nodes
fn build_merkle_tree(mut layer: Vec<Vec<u8>>) -> Result<Vec<u8>, JsValue> {
    if layer.is_empty() {
        return Err(js_error("Empty layer"));
    }

    // Continue hashing pairs until only root remains
    while layer.len() > 1 {
        let mut next_layer = Vec::new();
        
        // Process pairs of nodes
        for i in (0..layer.len()).step_by(2) {
            if i + 1 < layer.len() {
                // Hash pair of nodes
                let combined = hash_pair(&layer[i], &layer[i + 1]);
                next_layer.push(combined);
            } else {
                // Odd number of nodes - duplicate the last one
                let combined = hash_pair(&layer[i], &layer[i]);
                next_layer.push(combined);
            }
        }
        
        layer = next_layer;
    }

    Ok(layer[0].clone())
}

/// Hash two nodes together using SHA-256
fn hash_pair(left: &[u8], right: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().to_vec()
}

/// Hash a string using SHA-256
/// 
/// # Arguments
/// * `data` - String to hash
/// 
/// # Returns
/// * Hex-encoded SHA-256 hash
#[wasm_bindgen]
pub fn hash_data(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_data() {
        let data = "test";
        let hash = hash_data(data);
        // SHA-256 of "test"
        let expected = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
        assert_eq!(hash, expected);
    }

    #[test]
    fn test_merkle_root_single() {
        let hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".to_string();
        let result = calculate_merkle_root(vec![hash.clone()]);
        assert!(result.is_ok());
    }

    #[test]
    fn test_merkle_root_empty() {
        let result = calculate_merkle_root(vec![]);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_hex() {
        let invalid_hash = "not_valid_hex".to_string();
        let result = calculate_merkle_root(vec![invalid_hash]);
        assert!(result.is_err());
    }
}
