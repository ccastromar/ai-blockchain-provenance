import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ModelStatus = 'active' | 'deprecated' | 'archived';

/// Set when another system owns this AI system's lifecycle (e.g. Prudence's registry): Ernest
/// keeps its evidence but does not manage it, so its status cannot be changed here.
export interface ModelGovernance {
  systemOfRecord: string;
  aiSystemId?: string;
  riskTier?: string;
}

@Schema({ timestamps: true })
export class AIModel {
  @Prop({ required: true })
  modelId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  version: string;

  @Prop({ type: String, enum: ['active', 'deprecated', 'archived'], default: 'active' })
  status: ModelStatus;

  @Prop({ type: String, index: true })
  organizationId?: string;

  @Prop({ type: Object })
  parameters: Record<string, any>;

  @Prop({ type: Object })
  metrics: Record<string, any>;

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ type: Object })
  governance?: ModelGovernance;
}

export type AIModelDocument = AIModel & Document;
export const AIModelSchema = SchemaFactory.createForClass(AIModel);

AIModelSchema.index({ modelId: 1, version: 1 }, { unique: true });

