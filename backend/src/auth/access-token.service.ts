import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccessToken, AccessTokenDocument, AccessTokenRole } from './access-token.schema';
import { generateToken, hashToken } from './token.util';

export interface ResolvedToken {
  role: AccessTokenRole;
  label: string;
}

@Injectable()
export class AccessTokenService {
  constructor(@InjectModel(AccessToken.name) private readonly model: Model<AccessTokenDocument>) {}

  async create(label: string, role: AccessTokenRole, expiresAt?: Date) {
    const { token, tokenHash } = generateToken(role);
    const doc = await this.model.create({ tokenHash, label, role, expiresAt });
    // The raw token is returned exactly once and never stored -- only its hash is persisted.
    return { id: doc._id.toString(), token, label, role, expiresAt: doc.expiresAt ?? null, createdAt: (doc as any).createdAt };
  }

  async list() {
    const docs = await this.model.find().sort({ createdAt: -1 }).select('-tokenHash').lean();
    return docs.map((d) => ({
      id: d._id.toString(),
      label: d.label,
      role: d.role,
      expiresAt: d.expiresAt ?? null,
      revokedAt: d.revokedAt ?? null,
      lastUsedAt: d.lastUsedAt ?? null,
      createdAt: (d as any).createdAt,
    }));
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.model.updateOne({ _id: id, revokedAt: { $exists: false } }, { revokedAt: new Date() });
    return result.modifiedCount > 0;
  }

  /** Returns the role/label for a live (non-expired, non-revoked) token, or null. */
  async resolve(rawToken: string): Promise<ResolvedToken | null> {
    const doc = await this.model.findOne({ tokenHash: hashToken(rawToken) });
    if (!doc) return null;
    if (doc.revokedAt) return null;
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) return null;

    // Best-effort usage tracking -- does not block the auth decision on write latency.
    this.model.updateOne({ _id: doc._id }, { lastUsedAt: new Date() }).exec();

    return { role: doc.role, label: doc.label };
  }
}
