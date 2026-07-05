import { IsHash, IsString, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SignatureEnvelopeDto } from './signature-envelope.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LogInferenceDto {
  @ApiProperty({
    description: 'Identifier of an already registered model.',
    example: 'credit-risk-logreg-v1',
  })
  @IsString()
  modelId: string;

  @ApiProperty({
    description: 'Client-generated inference identifier.',
    example: 'f61c7b91-2e83-4f4a-8c9b-7c0cb90fca1e',
  })
  @IsString()
  inferenceId: string;

  @ApiProperty({
    description: 'SHA-256 hash of the raw inference input. Ernest stores hashes, not raw inputs.',
    example: 'e13236b63f7c5c5c8e7d1d52ebc4188e85f1dc474f0f3b2186e3b061087df6f5',
  })
  @IsHash('sha256')
  inputHash: string;
  
  @ApiProperty({
    description: 'SHA-256 hash of the raw inference output. Ernest stores hashes, not raw outputs.',
    example: '8caa1ff8cf0eb5080f6fc2c157e53b1a239a2b58075b0cc9ed01215d7ac0dc45',
  })
  @IsHash('sha256')
  outputHash: string;
  
  @ApiPropertyOptional({
    description: 'Inference parameters that are safe to expose as provenance metadata.',
    example: { return_probs: true },
    type: Object,
  })
  @IsObject()
  @IsOptional()
  params?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Additional inference metadata that is safe to expose.',
    example: { source: 'branch_app', scoring_request_id: 'score-20251027-1001' },
    type: Object,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'ADR-001 emitter signature over the canonical submission payload. Verified against the registered emitter keys; policy set by SIGNED_SUBMISSIONS.',
    type: SignatureEnvelopeDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SignatureEnvelopeDto)
  signature?: SignatureEnvelopeDto;
}
