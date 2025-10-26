import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/global.exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: true }));

  app.useGlobalFilters(new GlobalExceptionFilter());

  
  const port = process.env.PORT || 3001;
  await app.listen(port);
  
  console.log(`API running on http://localhost:${port}`);
  console.log(`Chain stats: http://localhost:${port}/api/stats`);
}

bootstrap();
