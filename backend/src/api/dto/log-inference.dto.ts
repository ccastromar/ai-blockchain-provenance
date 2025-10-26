import { IsString, IsObject, IsOptional } from 'class-validator';

export class LogInferenceDto {
  @IsString()
  modelId: string;

  @IsObject()
  input: any;

  @IsObject()
  @IsOptional()
  params?: Record<string, any>;

  @IsOptional()
  @IsObject()
  metadata?: any;
}
