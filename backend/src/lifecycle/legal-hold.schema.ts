import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// ADR-003 legal hold: while an active hold matches a block, the block is exempt from any
// retention archival/pruning regardless of age. Scopes: 'global' (everything), or
// 'organization'/'model' with a `target` id. Clearing a hold keeps the record (audit),
// it does not delete it.
@Schema({ timestamps: true })
export class LegalHold {
  @Prop({ required: true, enum: ['global', 'organization', 'model'] }) scope: string;
  @Prop() target?: string; // organizationId or modelId; absent for 'global'
  @Prop({ required: true }) reason: string;
  @Prop({ default: true }) active: boolean;
  @Prop() setBy?: string; // resolved caller identity (OIDC subject / token label), when known
  @Prop() clearedAt?: Date;
  @Prop() clearedBy?: string;
}

export type LegalHoldDocument = LegalHold & Document;
export const LegalHoldSchema = SchemaFactory.createForClass(LegalHold);
