import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class RegisterEmitterKeyDto {
  @ApiProperty({ example: 'Training pipeline - credit risk' })
  @IsString()
  @MinLength(1)
  label: string;

  @ApiProperty({ description: 'Raw 32-byte Ed25519 public key, base64-encoded.' })
  @IsBase64()
  publicKey: string;

  @ApiProperty({ required: false, example: 365, description: 'Key expires this many days after registration. Omit for no expiry.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
