import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ProvenanceBlockDocument = ProvenanceBlock & Document;

@Schema({ timestamps: true })
export class ProvenanceBlock {
  @Prop({ required: true, index: true })
  index: number;

  @Prop({ required: true, type: Number })
  timestamp: number;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  data: Record<string, any>;

//   @Prop({
//     type: {
//       type: { type: String, enum: ['model_registration', 'inference', 'model_update'], required: true },
//       modelId: { type: String, required: true },
//       version: String,
//       inputHash: String,
//       outputHash: String,
//       params: Object,
//       metadata: Object,
//     },
//     //required: true
//   })
//   data: {
//     type: 'model_registration' | 'inference' | 'model_update';
//     modelId: string;
//     version?: string;
//     inputHash?: string;
//     outputHash?: string;
//     params?: Record<string, any>;
//     metadata?: Record<string, any>;
//   };

  @Prop({ required: true })
  previousHash: string;

  @Prop({ required: true, index: true })
  hash: string;

 // @Prop({ default: 0 })
  //nonce: number;
}

export const ProvenanceBlockSchema = SchemaFactory.createForClass(ProvenanceBlock);

// Índices para consultas rápidas
ProvenanceBlockSchema.index({ 'data.modelId': 1 });
//ProvenanceBlockSchema.index({ index: 1 });
