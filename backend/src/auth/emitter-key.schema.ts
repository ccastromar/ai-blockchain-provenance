import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Registered emitter signing keys (ADR-001). The registry is ADMISSION control only:
// a block's embedded signature stays verifiable offline forever; revocation stops a
// key from signing NEW submissions, it does not retroactively disavow history.
@Schema({ timestamps: true })
export class EmitterKey {
  // First 16 hex chars of sha256(raw public key) — deterministic and printable.
  @Prop({ required: true, unique: true }) keyId: string;
  @Prop({ required: true }) publicKey: string; // base64, raw 32 bytes
  @Prop({ required: true }) label: string;
  @Prop({ type: String, enum: ['ed25519'], default: 'ed25519' }) algorithm: string;
  @Prop() expiresAt?: Date;
  @Prop() revokedAt?: Date;
  @Prop() lastUsedAt?: Date;
}

export type EmitterKeyDocument = EmitterKey & Document;
export const EmitterKeySchema = SchemaFactory.createForClass(EmitterKey);
