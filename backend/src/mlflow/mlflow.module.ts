import { Module } from '@nestjs/common';
import { MlflowService } from './mock.mlflow.service';

@Module({
  providers: [MlflowService],
  exports: [MlflowService]
})
export class MlflowModule {}
