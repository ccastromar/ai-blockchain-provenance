/*
 * AI Model Provenance & Auditing PoC
 * Copyright (c) 2025 Carlos Castro Martos
 * Licensed under the MIT License – see root LICENSE
 */

/**
 * RFC 6962 / RFC 9162 Merkle Tree Hash over SHA-256, used for evidence batches (ADR-004).
 * Leaves and interior nodes are domain-separated (0x00 / 0x01 prefixes) and pairs are NOT
 * sorted, so a leaf can never be passed off as an interior node. This is deliberately a
 * different construction from the anchoring tree (keccak256, sorted pairs), which stays
 * unchanged because existing anchor receipts depend on it.
 */
import * as crypto from 'crypto';
import { canonicalizeEx } from 'json-canonicalize';

export const TREE_ALG = 'rfc6962-sha256';

const sha256 = (...parts: Buffer[]): Buffer => {
    const h = crypto.createHash('sha256');
    for (const p of parts) h.update(p);
    return h.digest();
};

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/** Same canonical form the block hash uses for `data` (JCS, Mongo internals excluded). */
export function canonicalEventData(data: Record<string, any>): string {
    return canonicalizeEx(data, { exclude: ['__v', '_id', 'createdAt', 'updatedAt', 'hash'] });
}

/** Leaf hash of one event: SHA-256(0x00 || JCS(data)), hex. */
export function leafHashOf(data: Record<string, any>): string {
    return sha256(LEAF_PREFIX, Buffer.from(canonicalEventData(data), 'utf8')).toString('hex');
}

const nodeHash = (left: Buffer, right: Buffer): Buffer => sha256(NODE_PREFIX, left, right);

/** Largest power of two strictly less than n (n >= 2). */
const splitPoint = (n: number): number => {
    let k = 1;
    while (k << 1 < n) k <<= 1;
    return k;
};

function mth(leaves: Buffer[]): Buffer {
    if (leaves.length === 0) return sha256();
    if (leaves.length === 1) return leaves[0];
    const k = splitPoint(leaves.length);
    return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

function path(m: number, leaves: Buffer[]): Buffer[] {
    if (leaves.length <= 1) return [];
    const k = splitPoint(leaves.length);
    return m < k
        ? [...path(m, leaves.slice(0, k)), mth(leaves.slice(k))]
        : [...path(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

const toBuffers = (leafHashes: string[]) => leafHashes.map(h => Buffer.from(h, 'hex'));

/** Root over leaf hashes (hex, in leaf order). */
export function merkleRoot(leafHashes: string[]): string {
    return mth(toBuffers(leafHashes)).toString('hex');
}

/** Audit path for leaf `index`, bottom-up, hex. */
export function auditPath(leafHashes: string[], index: number): string[] {
    if (index < 0 || index >= leafHashes.length) {
        throw new RangeError(`leaf index ${index} outside tree of size ${leafHashes.length}`);
    }
    return path(index, toBuffers(leafHashes)).map(b => b.toString('hex'));
}

/** RFC 9162 §2.1.3.2 inclusion verification. */
export function verifyInclusion(leafHash: string, index: number, size: number, proof: string[], root: string): boolean {
    if (index < 0 || index >= size) return false;
    let fn = index;
    let sn = size - 1;
    let r = Buffer.from(leafHash, 'hex');
    for (const hex of proof) {
        const p = Buffer.from(hex, 'hex');
        if (sn === 0) return false;
        if (fn % 2 === 1 || fn === sn) {
            r = nodeHash(p, r);
            if (fn % 2 === 0) {
                while (fn % 2 === 0 && fn !== 0) {
                    fn >>= 1;
                    sn >>= 1;
                }
            }
        } else {
            r = nodeHash(r, p);
        }
        fn >>= 1;
        sn >>= 1;
    }
    return sn === 0 && r.toString('hex') === root;
}
