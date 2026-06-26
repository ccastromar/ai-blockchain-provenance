import { IsHash, IsString, IsObject, IsOptional } from 'class-validator';

export class LogInferenceDto {
  @IsString()
  modelId: string;

  @IsString()
  inferenceId: string;

  @IsHash('sha256')
  inputHash: string;
  
  @IsHash('sha256')
  outputHash: string;
  
  @IsObject()
  @IsOptional()
  params?: Record<string, any>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
