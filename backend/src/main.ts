import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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

  
  const port = process.env.PORT || 3001;
  await app.listen(port);
  
  console.log(`API running on http://localhost:${port}`);
  console.log(`Chain stats: http://localhost:${port}/api/stats`);
}

bootstrap();
