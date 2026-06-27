import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ModelStatus } from '../aimodel.schema';

export class UpdateModelStatusDto {
  @ApiProperty({ enum: ['active', 'deprecated', 'archived'], example: 'deprecated' })
  @IsEnum(['active', 'deprecated', 'archived'])
  status: ModelStatus;
}
