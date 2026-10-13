import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { LogInferenceDto } from './log-inference.dto';

export const MAX_INFERENCE_BATCH = 500;

export class LogInferenceBatchDto {
  @ApiProperty({
    description: `Up to ${MAX_INFERENCE_BATCH} inferences, each validated and admitted exactly as POST /api/inferences would.`,
    type: [LogInferenceDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INFERENCE_BATCH)
  @ValidateNested({ each: true })
  @Type(() => LogInferenceDto)
  items: LogInferenceDto[];
}
