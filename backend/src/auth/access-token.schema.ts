import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AccessTokenRole = 'read-write' | 'read-only';

@Schema({ timestamps: true })
export class AccessToken {
  @Prop({ required: true, unique: true }) tokenHash: string;
  @Prop({ required: true }) label: string;
  @Prop({ required: true, enum: ['read-write', 'read-only'] }) role: AccessTokenRole;
  @Prop() expiresAt?: Date;
  @Prop() revokedAt?: Date;
  @Prop() lastUsedAt?: Date;
}

export type AccessTokenDocument = AccessToken & Document;
export const AccessTokenSchema = SchemaFactory.createForClass(AccessToken);
