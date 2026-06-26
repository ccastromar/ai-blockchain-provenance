import { IsHash, IsObject, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MlflowMetadataDto {
  @IsHash('sha256')
  modelHash: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{7,40}$/, {
    message: 'gitCommit must be a short or full hexadecimal Git commit hash',
  })
  gitCommit: string;
}

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
  @ValidateNested()
  @Type(() => MlflowMetadataDto)
  mlflow: MlflowMetadataDto;

}
