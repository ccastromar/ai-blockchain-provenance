import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BlockchainModule } from './blockchain/blockchain.module';
import { MlflowModule } from './mlflow/mlflow.module';
import { ApiController } from './api/api.controller';
import { ApiService } from './api/api.service';
import { AIModelModule } from './aimodels/aimodel.module';
import { AIModelController } from './aimodels/aimodel.controller';
import { AnchorEventsService } from './api/anchor-events.service';
import { HealthController } from './health/health.controller';
import { ApiKeyGuard } from './common/api-key.guard';
import { Anchor, AnchorSchema } from './blockchain/models/anchor.schema';
import { IngestionModule } from './ingestion/ingestion.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/healthtrace'
    ),
    MongooseModule.forFeature([{ name: Anchor.name, schema: AnchorSchema }]),
    BlockchainModule,
    MlflowModule,
    AIModelModule,
    IngestionModule
  ],
  controllers: [
    ApiController,
    AIModelController,
    HealthController
  ],
  providers: [
    ApiService,
    AnchorEventsService,
    ApiKeyGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
