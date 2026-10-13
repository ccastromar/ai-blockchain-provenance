// backend/src/blockchain/models/batcher-lease.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** One active evidence batcher across replicas (ADR-004 §2). `_id` names the chain. */
@Schema({ collection: 'batcher_leases' })
export class BatcherLease {
  @Prop({ type: String }) _id: string;
  @Prop({ required: true }) owner: string;
  @Prop({ required: true }) expiresAt: Date;
}
export type BatcherLeaseDocument = BatcherLease & Document<string>;
export const BatcherLeaseSchema = SchemaFactory.createForClass(BatcherLease);
