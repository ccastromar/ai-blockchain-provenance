import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProvenanceBlock, ProvenanceBlockSchema } from '../blockchain/models/provenance-block.schema';
import { Anchor, AnchorSchema } from '../blockchain/models/anchor.schema';
import { LegalHold, LegalHoldSchema } from './legal-hold.schema';
import { LifecycleService } from './lifecycle.service';
import { LifecycleController } from './lifecycle.controller';

// ADR-003 data lifecycle (retention, legal hold, archive planning). Re-registers the
// block/anchor models for read access; they are also registered in BlockchainModule.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProvenanceBlock.name, schema: ProvenanceBlockSchema },
      { name: Anchor.name, schema: AnchorSchema },
      { name: LegalHold.name, schema: LegalHoldSchema },
    ]),
  ],
  controllers: [LifecycleController],
  providers: [LifecycleService],
  exports: [LifecycleService],
})
export class LifecycleModule {}
