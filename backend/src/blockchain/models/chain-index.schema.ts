import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * ADR-006 read models: facts derived from validated blocks, never evidence themselves. Each row
 * remembers the last block applied to it, so applying a block twice is a no-op. Dropping these
 * collections makes the indexer rebuild them from block 0.
 */

/** Where the indexer stands: the last block validated and applied (`_id` names the chain). */
@Schema({ collection: 'chain_index_state' })
export class ChainIndexState {
  @Prop({ type: String }) _id: string;
  @Prop() index?: number;
  @Prop() hash?: string;
  @Prop() updatedAt?: Date;
  /** Set while the indexer is stopped at an invalid block (the tip does not move past it). */
  @Prop() stalledAt?: number;
  @Prop() error?: string;
  /** Read-model schema version; an older (or missing) version makes the indexer rebuild. */
  @Prop() version?: number;
}
export type ChainIndexStateDocument = ChainIndexState & Document<string>;
export const ChainIndexStateSchema = SchemaFactory.createForClass(ChainIndexState);

/** Evidence per model: per-event blocks plus batched events. */
@Schema({ collection: 'model_index' })
export class ModelIndex {
  @Prop({ required: true }) modelId: string;
  @Prop({ default: 0 }) events: number;
  @Prop() firstBlockIndex?: number;
  @Prop({ required: true }) lastBlockIndex: number;
  @Prop() updatedAt?: Date;
}
export type ModelIndexDocument = ModelIndex & Document;
export const ModelIndexSchema = SchemaFactory.createForClass(ModelIndex);

/** Execution evidence per AI system (`metadata.stage = execution`), for policy-drift checks. */
@Schema({ collection: 'system_index' })
export class SystemIndex {
  @Prop({ required: true }) aiSystemId: string;
  @Prop({ default: 0 }) executions: number;
  /** Latest execution time: the event's own `occurredAt`, else when Ernest received it. */
  @Prop() lastExecutionAt?: Date;
  @Prop({ required: true }) lastBlockIndex: number;
  @Prop() updatedAt?: Date;
}
export type SystemIndexDocument = SystemIndex & Document;
export const SystemIndexSchema = SchemaFactory.createForClass(SystemIndex);
