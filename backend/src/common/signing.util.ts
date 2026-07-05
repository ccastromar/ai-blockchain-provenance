import { createHash, createPublicKey, verify as cryptoVerify } from 'crypto';
import { canonicalizeEx } from 'json-canonicalize';

// ADR-001 signed submissions: Ed25519 over DSSE PAE of the same canonical bytes the
// block hash uses. Pinned cross-language by testdata/signed-submission-golden.json.

export const SIGNATURE_PAYLOAD_TYPE = 'application/vnd.ernest.provenance+json';
export const EXCLUDED_KEYS = ['__v', '_id', 'createdAt', 'updatedAt', 'hash'];
// Fields the server adds to block data AFTER the client signed; every verifier
// strips exactly these (plus `signature`) before checking. Fixed by ADR-001.
export const SERVER_AUGMENTED_FIELDS = ['executedAt'];

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface SignatureEnvelope {
  alg: string;
  keyId: string;
  publicKey: string;
  signedAt: string;
  sig: string;
}

export function keyIdOf(publicKeyBase64: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 16);
}

export function pae(payloadType: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${payloadType.length} ${payloadType} ${body.length} `, 'utf8'),
    body,
  ]);
}

/** The exact bytes an emitter signs: block data minus `signature` minus
 * server-augmented fields, canonicalized, wrapped in DSSE PAE. */
export function signedBytes(data: Record<string, any>): Buffer {
  const stripped: Record<string, any> = { ...data };
  delete stripped.signature;
  for (const field of SERVER_AUGMENTED_FIELDS) delete stripped[field];
  const canonical = canonicalizeEx(stripped, { exclude: EXCLUDED_KEYS });
  return pae(SIGNATURE_PAYLOAD_TYPE, Buffer.from(canonical, 'utf8'));
}

export type SignatureFailure =
  | 'unsupported_algorithm'
  | 'key_id_mismatch'
  | 'malformed_key_or_signature'
  | 'signature_invalid';

/** Cryptographic check only (registry/admission policy is the caller's job). */
export function verifyEnvelope(
  data: Record<string, any>,
  envelope: SignatureEnvelope,
): { ok: true } | { ok: false; reason: SignatureFailure } {
  if (envelope.alg !== 'ed25519') {
    return { ok: false, reason: 'unsupported_algorithm' };
  }
  if (keyIdOf(envelope.publicKey) !== envelope.keyId) {
    return { ok: false, reason: 'key_id_mismatch' };
  }
  try {
    const raw = Buffer.from(envelope.publicKey, 'base64');
    if (raw.length !== 32) {
      return { ok: false, reason: 'malformed_key_or_signature' };
    }
    const keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    const valid = cryptoVerify(null, signedBytes(data), keyObject, Buffer.from(envelope.sig, 'base64'));
    return valid ? { ok: true } : { ok: false, reason: 'signature_invalid' };
  } catch {
    return { ok: false, reason: 'malformed_key_or_signature' };
  }
}
