// backend/src/blockchain/models/anchor.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Anchor {
  @Prop() merkleRoot: string;
  @Prop() lastBlockIndex: number;
  @Prop() txHash: string;
  // 'evm' (contract anchoring) or 'ots' (OpenTimestamps on Bitcoin). Legacy anchors
  // predate the field and are treated as 'evm'.
  @Prop({ type: String, enum: ['evm', 'ots'], default: 'evm' }) provider: string;
  // Serialized .ots proof (base64): pending at stamp time, replaced by the upgraded
  // proof once the calendars aggregate into a Bitcoin block.
  @Prop() otsProof?: string;
  @Prop() bitcoinBlockHeight?: number;
  // ADR-002 B1: optional, additive RFC 3161 qualified timestamp over the same Merkle
  // root, requested alongside OTS/EVM. Base64 DER of the full TimeStampResp (the ".tsr"),
  // verifiable offline with `openssl ts -verify` against the TSA's certificate chain.
  @Prop() qtsToken?: string;
  @Prop() qtsTsaUrl?: string;
  @Prop() qtsTimestampedAt?: Date;
  @Prop() blockNumber: number;
  @Prop() chainId: number;
  @Prop() contractAddress: string;
  @Prop() walletAddress: string;
  @Prop() organizationId: string;
  @Prop() organizationName: string;
  @Prop() domain: string;
  @Prop() anchoredAt: Date;
  @Prop() confirmedAt: Date;
  @Prop({ default: 'pending' }) status: string;
}
export type AnchorDocument = Anchor & Document;
export const AnchorSchema = SchemaFactory.createForClass(Anchor);
