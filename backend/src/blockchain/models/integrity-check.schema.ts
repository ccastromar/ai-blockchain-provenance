// backend/src/blockchain/models/integrity-check.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'integritychecks', timestamps: true })
export class IntegrityCheck {
  @Prop({ required: true }) isValid: boolean;
  @Prop({ type: [String], default: [] }) errors: string[];
  @Prop({ required: true }) checkedAt: Date;
}
export type IntegrityCheckDocument = IntegrityCheck & Document;
export const IntegrityCheckSchema = SchemaFactory.createForClass(IntegrityCheck);
