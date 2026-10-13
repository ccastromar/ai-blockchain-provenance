//! Offline verification of ADR-004 event proofs (GET /api/events/{source}/{eventId}/proof):
//! event data → leaf → RFC 6962 audit path → batch root committed in the block (or, for a
//! per-event block, data identical to the block's), the block's own hash, any embedded
//! emitter signature, and the keccak anchor path from the block when an anchor covers it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{canonical, receipt, rfc6962, signing};

#[derive(Deserialize)]
struct EventProof {
    status: String,
    event: ProofEvent,
    inclusion: Inclusion,
    block: ProofBlock,
    anchor: Option<AnchorPart>,
}

#[derive(Deserialize)]
struct ProofEvent {
    data: Value,
}

#[derive(Deserialize)]
struct Inclusion {
    kind: String,
    #[serde(rename = "leafHash", default)]
    leaf_hash: String,
    #[serde(rename = "leafIndex", default)]
    leaf_index: u64,
    #[serde(rename = "treeSize", default)]
    tree_size: u64,
    #[serde(rename = "auditPath", default)]
    audit_path: Vec<String>,
    #[serde(default)]
    root: String,
}

#[derive(Deserialize)]
struct ProofBlock {
    index: i64,
    timestamp: i64,
    #[serde(rename = "previousHash")]
    previous_hash: String,
    hash: String,
    data: Value,
}

#[derive(Deserialize)]
struct AnchorPart {
    proof: Vec<String>,
    #[serde(rename = "merkleRoot")]
    merkle_root: String,
}

#[derive(Serialize, Default)]
pub struct EventVerification {
    pub valid: bool,
    pub kind: String,
    #[serde(rename = "leafMatchesData")]
    pub leaf_matches_data: bool,
    #[serde(rename = "inclusionReachesBlock")]
    pub inclusion_reaches_block: bool,
    #[serde(rename = "dataMatchesHash")]
    pub data_matches_hash: bool,
    pub anchored: bool,
    #[serde(rename = "anchorProofReachesRoot")]
    pub anchor_proof_reaches_root: bool,
    #[serde(rename = "signaturePresent")]
    pub signature_present: bool,
    #[serde(rename = "signatureValid")]
    pub signature_valid: bool,
    #[serde(rename = "signedBy")]
    pub signed_by: String,
    #[serde(rename = "auditPathLength")]
    pub audit_path_length: usize,
    pub error: Option<String>,
}

fn failed(error: String) -> EventVerification {
    EventVerification { error: Some(error), ..Default::default() }
}

pub fn verify_event_proof_json(json: &str) -> EventVerification {
    let p: EventProof = match serde_json::from_str(json) {
        Ok(p) => p,
        Err(e) => return failed(format!("event proof is not valid JSON: {}", e)),
    };
    if p.status != "chained" {
        return failed(format!("event is still {:?}: no proof until it is chained", p.status));
    }

    let computed = match canonical::block_hash(p.block.index, p.block.timestamp, &p.block.data, &p.block.previous_hash) {
        Ok(h) => h,
        Err(e) => return failed(format!("cannot canonicalize block data: {}", e)),
    };
    let data_matches_hash = computed == p.block.hash.trim_start_matches("0x");

    let (leaf_matches_data, inclusion_reaches_block) = match p.inclusion.kind.as_str() {
        "batch" => {
            let leaf = match rfc6962::leaf_hash(&p.event.data) {
                Ok(l) => l,
                Err(e) => return failed(format!("cannot canonicalize event data: {}", e)),
            };
            let bd = &p.block.data;
            let commits = bd["type"] == "batch"
                && bd["treeAlg"] == rfc6962::TREE_ALG
                && bd["root"].as_str() == Some(p.inclusion.root.as_str())
                && bd["size"].as_u64() == Some(p.inclusion.tree_size);
            let path_ok = match rfc6962::verify_inclusion(&leaf, p.inclusion.leaf_index, p.inclusion.tree_size, &p.inclusion.audit_path, &p.inclusion.root) {
                Ok(ok) => ok,
                Err(e) => return failed(e),
            };
            (leaf == p.inclusion.leaf_hash, commits && path_ok)
        }
        "block" => {
            let same = match (canonical::canonical_json(&p.event.data), canonical::canonical_json(&p.block.data)) {
                (Ok(a), Ok(b)) => a == b,
                (Err(e), _) | (_, Err(e)) => return failed(e),
            };
            (same, same)
        }
        other => return failed(format!("unknown inclusion kind {:?}", other)),
    };

    let (anchored, anchor_ok) = match &p.anchor {
        None => (false, true),
        Some(a) => match receipt::proof_reaches_root(&p.block.hash, &a.proof, &a.merkle_root) {
            Ok(ok) => (true, ok),
            Err(e) => return failed(e),
        },
    };

    let signature = signing::check_embedded_signature(&p.event.data);

    EventVerification {
        valid: data_matches_hash && leaf_matches_data && inclusion_reaches_block && anchor_ok && signature.valid,
        kind: p.inclusion.kind,
        leaf_matches_data,
        inclusion_reaches_block,
        data_matches_hash,
        anchored,
        anchor_proof_reaches_root: anchor_ok,
        signature_present: signature.present,
        signature_valid: signature.valid,
        signed_by: signature.key_id,
        audit_path_length: p.inclusion.audit_path.len(),
        error: signature.error,
    }
}
