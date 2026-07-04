import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/global.exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
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
