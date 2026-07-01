import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IngestedEventDocument = IngestedEvent & Document;

@Schema({ collection: 'ingested_events' })
export class IngestedEvent {
  @Prop({ required: true, index: true })
  source: string;

  @Prop({ required: true, index: true })
  sourceEventId: string;

  @Prop({ required: true, index: true })
  eventType: string;

  @Prop({ required: true, index: true })
  status: string;

  @Prop()
  rawEventHash?: string;

  @Prop({ index: true })
  verificationStatus?: string;

  @Prop()
  verificationMethod?: string;

  @Prop()
  transportAuth?: string;

  @Prop({ index: true })
  blockIndex?: number;

  @Prop()
  blockHash?: string;

  @Prop()
  receivedAt?: Date;

  @Prop()
  appendedAt?: Date;

  @Prop()
  duplicateSeenAt?: Date;

  @Prop()
  duplicateCount?: number;
}

export const IngestedEventSchema = SchemaFactory.createForClass(IngestedEvent);

IngestedEventSchema.index({ source: 1, sourceEventId: 1, eventType: 1 }, { unique: true });
IngestedEventSchema.index({ blockIndex: -1 });
IngestedEventSchema.index({ verificationStatus: 1 });
