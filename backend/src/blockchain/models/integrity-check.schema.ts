// backend/src/blockchain/models/integrity-check.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'integritychecks', timestamps: true })
export class IntegrityCheck {
  @Prop({ required: true }) isValid: boolean;
  @Prop({ type: [String], default: [] }) errors: string[];
  @Prop({ required: true }) checkedAt: Date;

  // 'full' re-hashes the whole chain; 'incremental' verifies from the previous
  // checkpoint to the tip. See ScheduledBlockchainService.checkChainIntegrity for
  // what each mode can and cannot detect.
  @Prop({ type: String, enum: ['full', 'incremental'], default: 'full' }) mode: string;
  @Prop() blocksVerified?: number;
  // Checkpoint for the next incremental run: last verified block and its hash.
  @Prop() lastVerifiedIndex?: number;
  @Prop() lastVerifiedHash?: string;
  // Whether the latest confirmed anchor's Merkle root was still reproducible.
  @Prop() anchorRootOk?: boolean;
  // Local clock offset vs NTP_CHECK_SERVER in ms (positive = local clock behind).
  // Only present when the opt-in drift check ran successfully.
  @Prop() clockDriftMs?: number;
}
export type IntegrityCheckDocument = IntegrityCheck & Document;
export const IntegrityCheckSchema = SchemaFactory.createForClass(IntegrityCheck);
