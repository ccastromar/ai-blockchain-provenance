import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

/**
 * RFC 3161 trusted-timestamp client (ADR-002, Decision B1 — qualified electronic
 * timestamp). Requests a signed TimeStampToken over a Merkle root's hash from a Time
 * Stamping Authority. Point QTS_TSA_URL at a *qualified* TSA operated by an EU QTSP and
 * the resulting timestamp carries eIDAS legal presumption; point it at any RFC 3161 TSA
 * and you get the same cryptographic proof without the legal qualification.
 *
 * Additive and fail-soft by design: this runs *alongside* OTS/EVM anchoring, never
 * instead of it, and the caller swallows failures so a TSA outage can never block an
 * anchor. Verification is offline and independent (`openssl ts -verify` against the TSA's
 * certificate chain) -- the same "verify with a tool you don't control" model as OTS.
 *
 * The request DER is built by hand (a fixed, tiny structure) to avoid a heavy ASN.1
 * dependency; the response is parsed just enough to confirm the TSA granted it.
 */
@Injectable()
export class Rfc3161Client {
  private readonly logger = new Logger(Rfc3161Client.name);

  private readonly tsaUrl = process.env.QTS_TSA_URL?.trim();
  private readonly auth = process.env.QTS_TSA_AUTH?.trim(); // optional "user:pass"

  get enabled(): boolean {
    return (process.env.ANCHOR_QTS_ENABLED || '').toLowerCase() === 'true' && Boolean(this.tsaUrl);
  }

  /**
   * Requests a timestamp over sha256(rootBytes). Returns the full DER TimeStampResp
   * (the ".tsr"), which `openssl ts -verify -in <tsr> -data <rootfile>` checks offline.
   */
  async timestamp(rootHex: string): Promise<{ token: Buffer; tsaUrl: string; timestampedAt: Date }> {
    if (!this.enabled) throw new Error('RFC 3161 timestamping is not configured');
    const rootBytes = Buffer.from(rootHex.replace(/^0x/, ''), 'hex');
    const hash = createHash('sha256').update(rootBytes).digest();

    const request = buildTimeStampRequest(hash);
    const headers: Record<string, string> = {
      'Content-Type': 'application/timestamp-query',
      Accept: 'application/timestamp-reply',
    };
    if (this.auth) headers.Authorization = `Basic ${Buffer.from(this.auth).toString('base64')}`;

    const res = await fetch(this.tsaUrl!, { method: 'POST', headers, body: request });
    if (!res.ok) {
      throw new Error(`TSA ${this.tsaUrl} returned HTTP ${res.status}`);
    }
    const response = Buffer.from(await res.arrayBuffer());

    const status = readPkiStatus(response);
    if (status !== 0 && status !== 1) {
      // 0 = granted, 1 = grantedWithMods; anything else is a rejection.
      throw new Error(`TSA rejected the request (PKIStatus ${status})`);
    }

    return { token: response, tsaUrl: this.tsaUrl!, timestampedAt: new Date() };
  }
}

// ── Minimal DER encoding (request) ───────────────────────────────────────────

function encodeLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLen(content.length), content]);
}

function encodeInteger(value: Buffer): Buffer {
  let v = value;
  let i = 0;
  while (i < v.length - 1 && v[i] === 0) i++; // strip leading zeros
  v = v.subarray(i);
  if (v.length === 0) v = Buffer.from([0]);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]); // keep it positive
  return tlv(0x02, v);
}

// AlgorithmIdentifier for SHA-256: SEQUENCE { OID 2.16.840.1.101.3.4.2.1, NULL }.
const SHA256_ALG_ID = Buffer.from([
  0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00,
]);

/**
 * TimeStampReq ::= SEQUENCE {
 *   version INTEGER (1),
 *   messageImprint SEQUENCE { hashAlgorithm AlgorithmIdentifier, hashedMessage OCTET STRING },
 *   nonce INTEGER OPTIONAL,        -- replay protection
 *   certReq BOOLEAN DEFAULT FALSE  -- ask the TSA to include its signing cert
 * }
 */
function buildTimeStampRequest(hash: Buffer): Buffer {
  const version = encodeInteger(Buffer.from([1]));
  const messageImprint = tlv(0x30, Buffer.concat([SHA256_ALG_ID, tlv(0x04, hash)]));
  const nonce = encodeInteger(randomBytes(16));
  const certReq = Buffer.from([0x01, 0x01, 0xff]); // BOOLEAN true
  return tlv(0x30, Buffer.concat([version, messageImprint, nonce, certReq]));
}

// ── Minimal DER reading (response status) ────────────────────────────────────

interface Tlv {
  tag: number;
  contentStart: number;
  contentEnd: number;
}

function readTlv(buf: Buffer, offset: number): Tlv {
  const tag = buf[offset];
  let p = offset + 1;
  let len = buf[p++];
  if (len & 0x80) {
    const numBytes = len & 0x7f;
    len = 0;
    for (let k = 0; k < numBytes; k++) len = (len << 8) | buf[p++];
  }
  return { tag, contentStart: p, contentEnd: p + len };
}

/**
 * Reads PKIStatus from a TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken? }
 * where PKIStatusInfo ::= SEQUENCE { status PKIStatus (INTEGER), ... }.
 */
function readPkiStatus(response: Buffer): number {
  const outer = readTlv(response, 0); // TimeStampResp SEQUENCE
  const statusInfo = readTlv(response, outer.contentStart); // PKIStatusInfo SEQUENCE
  const statusInt = readTlv(response, statusInfo.contentStart); // PKIStatus INTEGER
  const value = response.subarray(statusInt.contentStart, statusInt.contentEnd);
  return value[value.length - 1]; // small non-negative integer
}
