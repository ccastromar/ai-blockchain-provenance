import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BlockchainModule } from './blockchain/blockchain.module';
import { MlflowModule } from './mlflow/mlflow.module';
import { ApiController } from './api/api.controller';
import { ApiService } from './api/api.service';
import { AIModelModule } from './aimodels/aimodel.module';
import { AIModelController } from './aimodels/aimodel.controller';
import { AnchorEventsService } from './api/anchor-events.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/healthtrace'
    ),
    BlockchainModule,
    MlflowModule,
    AIModelModule
  ],
  controllers: [
    ApiController,
    AIModelController
  ],
  providers: [
    ApiService,
    AnchorEventsService],
})
export class AppModule {}
