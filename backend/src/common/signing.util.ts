import { createHash, createPublicKey, verify as cryptoVerify, X509Certificate } from 'crypto';
import { canonicalizeEx } from 'json-canonicalize';

// ADR-001 signed submissions: Ed25519 over DSSE PAE of the same canonical bytes the
// block hash uses. Pinned cross-language by testdata/signed-submission-golden.json.
//
// ADR-002 B2 (scaffolding): the SAME DSSE PAE bytes may instead be signed with a
// qualified electronic seal -- a QTSP-issued X.509 certificate (alg `qeseal-*`, chain in
// `x5c`). Only the envelope carrier differs; the signed bytes do not. What remains to make
// it production-qualified: (1) the client produces the seal via a QTSP remote-signing API
// (CSC) -- out of this process; (2) validateSealTrustChain is pointed at an EU Trusted List
// (LOTL) snapshot. The cryptographic verification below is complete.

export const SIGNATURE_PAYLOAD_TYPE = 'application/vnd.ernest.provenance+json';
export const EXCLUDED_KEYS = ['__v', '_id', 'createdAt', 'updatedAt', 'hash'];
// Fields the server adds to block data AFTER the client signed; every verifier
// strips exactly these (plus `signature`) before checking. Fixed by ADR-001.
export const SERVER_AUGMENTED_FIELDS = ['executedAt'];

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// Qualified-seal algorithms (ADR-002 B2). The value encodes the signature scheme used
// with the certificate's key; the digest is SHA-256 in all cases.
export const QSEAL_ALGS = ['qeseal-ecdsa-p256', 'qeseal-rsa-sha256'] as const;
export type QsealAlg = (typeof QSEAL_ALGS)[number];

export interface SignatureEnvelope {
  alg: string;
  keyId: string;
  // Ed25519 (ADR-001): raw 32-byte public key, base64. Absent for qualified seals.
  publicKey?: string;
  // Qualified seal (ADR-002 B2): X.509 chain, leaf first, each a base64 DER cert.
  x5c?: string[];
  signedAt: string;
  sig: string;
}

export function keyIdOf(publicKeyBase64: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 16);
}

/** keyId for a qualified seal: the SHA-256 fingerprint prefix of the leaf certificate. */
export function keyIdOfCert(certDerBase64: string): string {
  return createHash('sha256').update(Buffer.from(certDerBase64, 'base64')).digest('hex').slice(0, 16);
}

export function isQsealAlg(alg: string): alg is QsealAlg {
  return (QSEAL_ALGS as readonly string[]).includes(alg);
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

/** Cryptographic check only (registry/admission/trust-list policy is the caller's job). */
export function verifyEnvelope(
  data: Record<string, any>,
  envelope: SignatureEnvelope,
): { ok: true } | { ok: false; reason: SignatureFailure } {
  if (envelope.alg === 'ed25519') return verifyEd25519(data, envelope);
  if (isQsealAlg(envelope.alg)) return verifyQseal(data, envelope);
  return { ok: false, reason: 'unsupported_algorithm' };
}

function verifyEd25519(
  data: Record<string, any>,
  envelope: SignatureEnvelope,
): { ok: true } | { ok: false; reason: SignatureFailure } {
  if (!envelope.publicKey || keyIdOf(envelope.publicKey) !== envelope.keyId) {
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

/**
 * ADR-002 B2: verify a qualified electronic seal cryptographically -- the signature over
 * the DSSE PAE bytes made with the key in the leaf X.509 certificate (x5c[0]). This does
 * NOT establish qualified status; that is validateSealTrustChain's job (cert chain to an EU
 * Trusted List anchor). Signature and keyId are verified here.
 */
function verifyQseal(
  data: Record<string, any>,
  envelope: SignatureEnvelope,
): { ok: true } | { ok: false; reason: SignatureFailure } {
  const leafDer = envelope.x5c?.[0];
  if (!leafDer || keyIdOfCert(leafDer) !== envelope.keyId) {
    return { ok: false, reason: 'key_id_mismatch' };
  }
  try {
    const cert = new X509Certificate(Buffer.from(leafDer, 'base64'));
    const publicKey = cert.publicKey;
    const sig = Buffer.from(envelope.sig, 'base64');
    const bytes = signedBytes(data);
    const valid =
      envelope.alg === 'qeseal-ecdsa-p256'
        ? cryptoVerify('sha256', bytes, { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig)
        : cryptoVerify('sha256', bytes, publicKey, sig); // qeseal-rsa-sha256 (PKCS#1 v1.5)
    return valid ? { ok: true } : { ok: false, reason: 'signature_invalid' };
  } catch {
    return { ok: false, reason: 'malformed_key_or_signature' };
  }
}

export type SealTrustResult =
  | { trusted: true; subject: string }
  | { trusted: false; reason: 'trust_list_not_configured' | 'chain_incomplete' | 'chain_untrusted' | 'certificate_expired' | 'malformed_chain' };

let cachedAnchors: X509Certificate[] | undefined;

/**
 * ADR-002 B2 (trust boundary): validates a qualified-seal certificate chain to a trust
 * anchor. Anchors are loaded from a PEM bundle at QSEAL_TRUSTED_CA_PEM. Today that file is
 * supplied manually; the remaining production step is to source and refresh it from the EU
 * List of Trusted Lists (LOTL) so "trusted" means "qualified under eIDAS". The chain walk,
 * link verification and validity-window check below are complete.
 */
export function validateSealTrustChain(x5c: string[] | undefined, atIso?: string): SealTrustResult {
  const anchors = loadTrustAnchors();
  if (!anchors) return { trusted: false, reason: 'trust_list_not_configured' };
  if (!x5c || x5c.length === 0) return { trusted: false, reason: 'chain_incomplete' };

  try {
    const chain = x5c.map((der) => new X509Certificate(Buffer.from(der, 'base64')));
    const at = atIso ? new Date(atIso) : new Date();

    // Validity window for every cert in the presented chain.
    for (const cert of chain) {
      if (at < new Date(cert.validFrom) || at > new Date(cert.validTo)) {
        return { trusted: false, reason: 'certificate_expired' };
      }
    }
    // Each cert must be issued and signed by the next one up.
    for (let i = 0; i < chain.length - 1; i++) {
      if (!chain[i].checkIssued(chain[i + 1]) || !chain[i].verify(chain[i + 1].publicKey)) {
        return { trusted: false, reason: 'chain_untrusted' };
      }
    }
    // The top of the presented chain must be issued by (or equal to) a trust anchor.
    const top = chain[chain.length - 1];
    const anchored = anchors.some(
      (anchor) =>
        (top.checkIssued(anchor) && top.verify(anchor.publicKey)) ||
        top.fingerprint256 === anchor.fingerprint256,
    );
    if (!anchored) return { trusted: false, reason: 'chain_untrusted' };

    return { trusted: true, subject: chain[0].subject };
  } catch {
    return { trusted: false, reason: 'malformed_chain' };
  }
}

function loadTrustAnchors(): X509Certificate[] | undefined {
  if (cachedAnchors) return cachedAnchors;
  const path = process.env.QSEAL_TRUSTED_CA_PEM?.trim();
  if (!path) return undefined;
  // Lazy require so the pure signing path has no fs dependency at import time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pem = require('fs').readFileSync(path, 'utf8') as string;
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  cachedAnchors = blocks.map((b) => new X509Certificate(b));
  return cachedAnchors.length ? cachedAnchors : undefined;
}
