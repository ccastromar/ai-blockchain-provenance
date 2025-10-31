import { IsString, IsObject, IsOptional } from 'class-validator';

export class LogInferenceDto {
  @IsString()
  modelId: string;

  @IsString()
  inferenceId: string;

  @IsString()
  inputHash: string;
  
  @IsString()
  outputHash: string;
  
  @IsObject()
  @IsOptional()
  params?: Record<string, any>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
