import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventFailure, EventFailureSchema } from './event-failure.schema';
import { IngestedEventController } from './ingested-event.controller';
import { IngestedEvent, IngestedEventSchema } from './ingested-event.schema';
import { IngestedEventService } from './ingested-event.service';
import { IngestorProxyController } from './ingestor-proxy.controller';
import { IngestorProxyService } from './ingestor-proxy.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IngestedEvent.name, schema: IngestedEventSchema },
      { name: EventFailure.name, schema: EventFailureSchema },
    ]),
  ],
  controllers: [IngestedEventController, IngestorProxyController],
  providers: [IngestedEventService, IngestorProxyService],
})
export class IngestionModule {}
