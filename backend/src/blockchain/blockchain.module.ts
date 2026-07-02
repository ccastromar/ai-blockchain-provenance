import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlockchainService } from './blockchain.service';
import { ProvenanceBlock, ProvenanceBlockSchema } from './models/provenance-block.schema';
import { Anchor, AnchorSchema } from './models/anchor.schema';
import { IntegrityCheck, IntegrityCheckSchema } from './models/integrity-check.schema';
import { ScheduledBlockchainService } from './scheduled.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProvenanceBlock.name, schema: ProvenanceBlockSchema },
      { name: Anchor.name, schema: AnchorSchema },
      { name: IntegrityCheck.name, schema: IntegrityCheckSchema }
    ]),
    ScheduleModule.forRoot(),
  ],
  providers: [BlockchainService, ScheduledBlockchainService],
  exports: [BlockchainService]
})
export class BlockchainModule {}
