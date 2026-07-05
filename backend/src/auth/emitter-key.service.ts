import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { keyIdOf } from '../common/signing.util';
import { EmitterKey, EmitterKeyDocument } from './emitter-key.schema';

@Injectable()
export class EmitterKeyService {
  constructor(@InjectModel(EmitterKey.name) private readonly model: Model<EmitterKeyDocument>) {}

  async register(label: string, publicKeyBase64: string, expiresAt?: Date) {
    const raw = Buffer.from(publicKeyBase64, 'base64');
    if (raw.length !== 32) {
      throw new Error('publicKey must be 32 raw Ed25519 bytes, base64-encoded');
    }
    const keyId = keyIdOf(publicKeyBase64);
    const doc = await this.model.create({ keyId, publicKey: publicKeyBase64, label, expiresAt });
    return { keyId, label: doc.label, publicKey: doc.publicKey, expiresAt: doc.expiresAt ?? null, createdAt: (doc as any).createdAt };
  }

  async list() {
    const docs = await this.model.find().sort({ createdAt: -1 }).lean();
    return docs.map((d) => ({
      keyId: d.keyId,
      label: d.label,
      publicKey: d.publicKey,
      algorithm: d.algorithm,
      expiresAt: d.expiresAt ?? null,
      revokedAt: d.revokedAt ?? null,
      lastUsedAt: d.lastUsedAt ?? null,
      createdAt: (d as any).createdAt,
    }));
  }

  async revoke(keyId: string): Promise<boolean> {
    const result = await this.model.updateOne({ keyId, revokedAt: { $exists: false } }, { revokedAt: new Date() });
    return result.modifiedCount > 0;
  }

  /** Admission check: is this exact key registered, unrevoked and unexpired NOW? */
  async isAdmissible(keyId: string, publicKeyBase64: string): Promise<{ ok: true } | { ok: false; reason: 'unknown_key' | 'key_revoked' | 'key_expired' }> {
    const doc = await this.model.findOne({ keyId }).lean();
    if (!doc || doc.publicKey !== publicKeyBase64) {
      return { ok: false, reason: 'unknown_key' };
    }
    if (doc.revokedAt) {
      return { ok: false, reason: 'key_revoked' };
    }
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'key_expired' };
    }
    this.model.updateOne({ keyId }, { lastUsedAt: new Date() }).exec();
    return { ok: true };
  }
}
