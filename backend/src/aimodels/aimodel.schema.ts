import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class AIModel {
  @Prop({ required: true })
  modelId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  version: string;

  @Prop({ type: Object })
  parameters: Record<string, any>;

  @Prop({ type: Object })
  metrics: Record<string, any>;

  @Prop({ type: Object })
  metadata: Record<string, any>;
}

export type AIModelDocument = AIModel & Document;
export const AIModelSchema = SchemaFactory.createForClass(AIModel);

AIModelSchema.index({ name: 1, version: 1 }, { unique: true });

