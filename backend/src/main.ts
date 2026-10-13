import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/global.exception.filter';

// Last line of defence: a failure in background work (anchoring, RPC polling, webhooks)
// must never take the evidence service down. Log it loudly and keep serving.
process.on('unhandledRejection', (reason: any) => {
  console.error('Unhandled promise rejection (process kept alive):', reason?.stack || reason);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Express defaults to 100 kB JSON bodies; POST /api/inferences/batch carries up to 500
  // records (~250 kB). MAX_JSON_BODY overrides (e.g. "4mb").
  app.useBodyParser('json', { limit: process.env.MAX_JSON_BODY || '2mb' });
  
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors(corsOrigin
    ? {
        origin: corsOrigin === '*'
          ? true
          : corsOrigin.split(',').map(origin => origin.trim()).filter(Boolean),
      }
    : undefined);
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  app.useGlobalFilters(new GlobalExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ernest API')
    .setDescription('AI provenance, hashchain verification, and blockchain anchoring API.')
    .setVersion('0.2.0-alpha')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Ernest-Api-Key',
        in: 'header',
      },
      'ernest-api-key',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'oidc-bearer',
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    customSiteTitle: 'Ernest API Docs',
    jsonDocumentUrl: 'api/docs-json',
  });

  
  const port = process.env.PORT || 3001;
  await app.listen(port);
  
  console.log(`API running on http://localhost:${port}`);
  console.log(`API docs: http://localhost:${port}/api/docs`);
  console.log(`Chain stats: http://localhost:${port}/api/stats`);
}

bootstrap();
