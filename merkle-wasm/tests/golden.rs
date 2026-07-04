//! Golden-fixture tests: this crate is the FOURTH implementation of Ernest's
//! canonical hash and the SECOND verifier of Merkle receipts, and it is only
//! allowed to exist because these fixtures hold every implementation to the
//! same bytes in CI. If either test fails, do not "fix" the fixture — fix the
//! implementation.

use serde_json::Value;

fn testdata(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("testdata")
        .join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {:?} (run the generator scripts): {}", path, e));
    serde_json::from_str(&raw).unwrap()
}

#[test]
fn hash_golden_vectors_reproduce_canonical_data_and_hashes() {
    let fixture = testdata("hash-golden-vectors.json");
    for vector in fixture["vectors"].as_array().unwrap() {
        let name = vector["name"].as_str().unwrap();
        let block = &vector["block"];

        let canonical = merkle_wasm::canonical::canonical_json(&block["data"])
            .unwrap_or_else(|e| panic!("vector {}: {}", name, e));
        assert_eq!(
            canonical,
            vector["expectedCanonicalData"].as_str().unwrap(),
            "canonical data mismatch in vector {}",
            name
        );

        let hash = merkle_wasm::canonical::block_hash(
            block["index"].as_i64().unwrap(),
            block["timestamp"].as_i64().unwrap(),
            &block["data"],
            block["previousHash"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            hash,
            vector["expectedHash"].as_str().unwrap(),
            "hash mismatch in vector {}",
            name
        );
    }
}

#[test]
fn merkle_proof_golden_vectors_verify() {
    let fixture = testdata("merkle-proof-golden.json");
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let root = case["merkleRoot"].as_str().unwrap();
        for proof in case["proofs"].as_array().unwrap() {
            let leaf = proof["blockHash"].as_str().unwrap();
            let path: Vec<String> = proof["proof"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p.as_str().unwrap().to_string())
                .collect();
            let ok = merkle_wasm::receipt::proof_reaches_root(leaf, &path, root)
                .unwrap_or_else(|e| panic!("case {}: {}", name, e));
            assert!(ok, "case {} proof for {} must reach root {}", name, leaf, root);
        }
    }
}

#[test]
fn tampered_leaf_fails() {
    let fixture = testdata("merkle-proof-golden.json");
    let case = &fixture["cases"].as_array().unwrap()[3]; // fifty-leaves
    let root = case["merkleRoot"].as_str().unwrap();
    let proof = &case["proofs"].as_array().unwrap()[0];
    let path: Vec<String> = proof["proof"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_string())
        .collect();
    let tampered = format!("f{}", &proof["blockHash"].as_str().unwrap()[1..]);
    let ok = merkle_wasm::receipt::proof_reaches_root(&tampered, &path, root).unwrap();
    assert!(!ok, "tampered leaf must not verify");
}

#[test]
fn full_receipt_roundtrip_and_tamper_detection() {
    // A minimal synthetic receipt: single-block chain, root == leaf, empty proof.
    let data = serde_json::json!({ "type": "inference", "modelId": "wasm-test", "score": 0.86 });
    let hash = merkle_wasm::canonical::block_hash(3, 1700000009, &data, "abc123").unwrap();
    let receipt = serde_json::json!({
        "block": { "index": 3, "timestamp": 1700000009, "previousHash": "abc123", "hash": hash, "data": data },
        "proof": [],
        "merkleRoot": format!("0x{}", hash),
    })
    .to_string();

    let verdict: Value = serde_json::from_str(&merkle_wasm::verify_receipt(&receipt)).unwrap();
    assert_eq!(verdict["valid"], true, "verdict: {}", verdict);

    let tampered = receipt.replace("wasm-test", "tampered");
    let verdict: Value = serde_json::from_str(&merkle_wasm::verify_receipt(&tampered)).unwrap();
    assert_eq!(verdict["valid"], false);
    assert_eq!(verdict["dataMatchesHash"], false);
}
