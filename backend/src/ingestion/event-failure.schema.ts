import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type EventFailureDocument = EventFailure & Document;

@Schema({ collection: 'event_failures' })
export class EventFailure {
  @Prop({ required: true, index: true })
  sourceStreamId: string;

  @Prop({ index: true })
  source?: string;

  @Prop({ index: true })
  sourceEventId?: string;

  @Prop({ index: true })
  eventType?: string;

  @Prop()
  rawEventHash?: string;

  @Prop({ required: true })
  error: string;

  @Prop({ index: true })
  failureKind?: string;

  @Prop({ index: true })
  authFailureType?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  payload?: Record<string, any>;

  @Prop({ index: true })
  failedAt?: Date;
}

export const EventFailureSchema = SchemaFactory.createForClass(EventFailure);

EventFailureSchema.index({ failedAt: -1 });
EventFailureSchema.index({ source: 1, eventType: 1 });
