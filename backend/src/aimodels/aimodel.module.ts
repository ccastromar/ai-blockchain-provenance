import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AIModelService } from './aimodel.service';
import { AIModel, AIModelSchema } from './aimodel.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AIModel.name, schema: AIModelSchema }
    ])
  ],
  providers: [AIModelService],
  exports: [AIModelService],
})
export class AIModelModule {}
