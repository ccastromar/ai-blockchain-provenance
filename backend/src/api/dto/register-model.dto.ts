import { IsHash, IsObject, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MlflowMetadataDto {
  @ApiProperty({
    description: 'SHA-256 hash of the model artifact.',
    example: '8caa1ff8cf0eb5080f6fc2c157e53b1a239a2b58075b0cc9ed01215d7ac0dc45',
  })
  @IsHash('sha256')
  modelHash: string;

  @ApiProperty({
    description: 'Short or full hexadecimal Git commit hash for the training code.',
    example: 'a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2',
  })
  @IsString()
  @Matches(/^[0-9a-fA-F]{7,40}$/, {
    message: 'gitCommit must be a short or full hexadecimal Git commit hash',
  })
  gitCommit: string;
}

export class RegisterModelDto {
  @ApiProperty({
    description: 'Stable public identifier for the model.',
    example: 'credit-risk-logreg-v1',
  })
  @IsString()
  modelId: string;

  @ApiProperty({
    description: 'Human-readable model name.',
    example: 'Credit Risk logistic regression version 1',
  })
  @IsString()
  modelName: string;

  @ApiProperty({
    description: 'Model version label.',
    example: '1.0.0',
  })
  @IsString()
  version: string;

  @ApiPropertyOptional({
    description: 'Optional path or URI where the model artifact is stored.',
    example: 's3://ernest-demo/models/credit-risk-logreg-v1.pkl',
  })
  @IsString()
  @IsOptional()
  modelPath?: string;

  @ApiPropertyOptional({
    description: 'Training parameters or model configuration.',
    example: { model_type: 'LogisticRegression', solver: 'liblinear' },
    type: Object,
  })
  @IsObject()
  @IsOptional()
  params?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Model evaluation metrics.',
    example: { roc_auc: 0.81, accuracy: 0.76 },
    type: Object,
  })
  @IsObject()
  @IsOptional()
  metrics?: Record<string, number>;

  @ApiPropertyOptional({
    description: 'Additional model provenance metadata.',
    example: { framework: 'scikit-learn', training_data: 'German Credit Risk Dataset' },
    type: Object,
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiProperty({
    description: 'MLflow-style artifact hash and source commit metadata.',
    type: MlflowMetadataDto,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => MlflowMetadataDto)
  mlflow: MlflowMetadataDto;

}
