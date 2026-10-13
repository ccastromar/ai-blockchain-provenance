// backend/src/blockchain/models/evidence-event.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

/**
 * ADR-004 event store: one document per accepted evidence event, stored before it is
 * chained. Pending events have no `seq`; the batcher assigns it when it takes them, so seq
 * order is chain order (an in-flight insert can never land behind a chained range). Indexes are
 * created explicitly by EvidenceService.ensureIndexes (named, like the block indexes).
 */
@Schema({ collection: 'evidence_events', timestamps: true })
export class EvidenceEvent {
  // Who emitted the event and its id there: unique together (idempotent submission).
  @Prop({ required: true }) source: string;
  @Prop({ required: true }) eventId: string;

  // Exactly the block `data` a per-event block would carry (already cleanObject'ed).
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) data: Record<string, any>;
  @Prop() modelId?: string;
  @Prop() type?: string;

  // SHA-256(0x00 || JCS(data)), hex -- the RFC 6962 leaf.
  @Prop({ required: true }) leafHash: string;

  // pending -> assigned (seq stamped, block not yet appended) -> chained.
  @Prop({ type: String, enum: ['pending', 'assigned', 'chained'], default: 'pending' }) state: string;

  // Assigned by the batcher (absent while pending). Unique and increasing in chain
  // order; a batch is the events whose seq falls in its block's [firstSeq, lastSeq].
  @Prop() seq?: number;
  // Which block this event goes into: a per-event block or a batch, keyed by the first
  // seq that block chains (the block's eventSeq). Lets a new leader resume a crashed one.
  @Prop({ type: Object }) chain?: { kind: 'block' | 'batch'; firstSeq: number };
  // Block that chains this event, and the event's position in that block's tree
  // (leafIndex is 0 for a per-event block).
  @Prop() blockIndex?: number;
  @Prop() leafIndex?: number;
}
export type EvidenceEventDocument = EvidenceEvent & Document;
export const EvidenceEventSchema = SchemaFactory.createForClass(EvidenceEvent);
