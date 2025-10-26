// backend/src/blockchain/models/anchor.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Anchor {
  @Prop() merkleRoot: string;
  @Prop() lastBlockIndex: number;
  @Prop() txHash: string;
  @Prop() blockNumber: number;
  @Prop() chainId: number;
  @Prop() anchoredAt: Date;
  @Prop({ default: 'pending' }) status: string;
}
export type AnchorDocument = Anchor & Document;
export const AnchorSchema = SchemaFactory.createForClass(Anchor);
