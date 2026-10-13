import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BlockchainModule } from './blockchain/blockchain.module';
import { MlflowModule } from './mlflow/mlflow.module';
import { ApiController } from './api/api.controller';
import { ApiService } from './api/api.service';
import { AIModelModule } from './aimodels/aimodel.module';
import { AIModelController } from './aimodels/aimodel.controller';
import { AnchorEventsService } from './api/anchor-events.service';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { ApiKeyGuard } from './common/api-key.guard';
import { ReadAccessGuard } from './common/read-access.guard';
import { Anchor, AnchorSchema } from './blockchain/models/anchor.schema';
import { IntegrityCheck, IntegrityCheckSchema } from './blockchain/models/integrity-check.schema';
import { IngestionModule } from './ingestion/ingestion.module';
import { AccessResolutionMiddleware, openAccessMode } from './common/access-resolution.middleware';
import { ErnestThrottlerGuard, isAuthenticated } from './common/ernest-throttler.guard';

const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Per route, per caller (see ErnestThrottlerGuard): authenticated callers get their own
    // budget; anonymous ones keep the old per-IP 100/min. In open dev mode (no credential
    // configured) everyone gets the authenticated budget.
    ThrottlerModule.forRoot([{
      ttl: envInt('THROTTLE_TTL_MS', 60_000),
      limit: (context) => {
        const req = context.switchToHttp().getRequest();
        return isAuthenticated(req) || openAccessMode(!!process.env.OIDC_ISSUER)
          ? envInt('THROTTLE_AUTHENTICATED_LIMIT', 6000)
          : envInt('THROTTLE_ANONYMOUS_LIMIT', 100);
      },
    }]),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/healthtrace'
    ),
    MongooseModule.forFeature([
      { name: Anchor.name, schema: AnchorSchema },
      { name: IntegrityCheck.name, schema: IntegrityCheckSchema },
    ]),
    BlockchainModule,
    LifecycleModule,
    MlflowModule,
    AIModelModule,
    IngestionModule,
    AuthModule
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
    ReadAccessGuard,
    { provide: APP_GUARD, useClass: ErnestThrottlerGuard },
    { provide: APP_GUARD, useClass: ReadAccessGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AccessResolutionMiddleware).forRoutes('*');
  }
}
