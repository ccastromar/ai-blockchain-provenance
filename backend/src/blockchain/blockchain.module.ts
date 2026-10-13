import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlockchainService } from './blockchain.service';
import { OtsClient } from './ots.client';
import { Rfc3161Client } from './rfc3161.client';
import { ProvenanceBlock, ProvenanceBlockSchema } from './models/provenance-block.schema';
import { Anchor, AnchorSchema } from './models/anchor.schema';
import { IntegrityCheck, IntegrityCheckSchema } from './models/integrity-check.schema';
import { ScheduledBlockchainService } from './scheduled.service';
import { EvidenceService } from './evidence.service';
import { EvidenceEvent, EvidenceEventSchema } from './models/evidence-event.schema';
import { BatcherLease, BatcherLeaseSchema } from './models/batcher-lease.schema';
import { ScheduleModule } from '@nestjs/schedule';
import { ChainIndexerService } from './chain-indexer.service';
import {
  ChainIndexState, ChainIndexStateSchema, ModelIndex, ModelIndexSchema, SystemIndex, SystemIndexSchema,
} from './models/chain-index.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProvenanceBlock.name, schema: ProvenanceBlockSchema },
      { name: Anchor.name, schema: AnchorSchema },
      { name: IntegrityCheck.name, schema: IntegrityCheckSchema },
      { name: EvidenceEvent.name, schema: EvidenceEventSchema },
      { name: BatcherLease.name, schema: BatcherLeaseSchema },
      { name: ChainIndexState.name, schema: ChainIndexStateSchema },
      { name: ModelIndex.name, schema: ModelIndexSchema },
      { name: SystemIndex.name, schema: SystemIndexSchema },
    ]),
    ScheduleModule.forRoot(),
  ],
  providers: [BlockchainService, EvidenceService, ChainIndexerService, ScheduledBlockchainService, OtsClient, Rfc3161Client],
  exports: [BlockchainService, EvidenceService, ChainIndexerService]
})
export class BlockchainModule {}
