import { IsString, IsObject, IsOptional } from 'class-validator';

export class RegisterModelDto {
  
  @IsString()
  modelId: string;

  @IsString()
  modelName: string;

  @IsString()
  version: string;

  @IsString()
  @IsOptional()
  modelPath?: string;

  @IsObject()
  @IsOptional()
  params?: Record<string, any>;

  @IsObject()
  @IsOptional()
  metrics?: Record<string, number>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsObject()
  @IsOptional()
  mlflow?: Record<string, any>;

}
