import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBase64, IsIn, IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Signature envelope over the DSSE PAE of the Ernest-canonical submission payload (block
 * data minus `signature` minus server-augmented fields).
 *  - ADR-001: `ed25519` with a raw `publicKey` (admitted against Ernest's key registry).
 *  - ADR-002 B2: a qualified electronic seal (`qeseal-*`) carrying an X.509 chain in `x5c`
 *    (trust established against an EU Trusted List; enable with SEAL_LEVEL=qualified).
 */
export class SignatureEnvelopeDto {
  @ApiProperty({ enum: ['ed25519', 'qeseal-ecdsa-p256', 'qeseal-rsa-sha256'] })
  @IsIn(['ed25519', 'qeseal-ecdsa-p256', 'qeseal-rsa-sha256'])
  alg: string;

  @ApiProperty({ description: 'First 16 hex chars of sha256(raw public key) for ed25519, or of the leaf certificate (DER) for a qualified seal.' })
  @Matches(/^[0-9a-f]{16}$/)
  keyId: string;

  @ApiPropertyOptional({ description: 'Raw 32-byte Ed25519 public key, base64 (ed25519 only).' })
  @IsOptional()
  @IsBase64()
  publicKey?: string;

  @ApiPropertyOptional({ description: 'X.509 certificate chain, leaf first, each a base64 DER cert (qualified seal only).', type: [String] })
  @IsOptional()
  @IsArray()
  @IsBase64({}, { each: true })
  x5c?: string[];

  @ApiProperty({ description: 'Client-claimed signing time (ISO 8601). Informational; the chain and anchors bound the recorded time.' })
  @IsISO8601()
  signedAt: string;

  @ApiProperty({ description: 'Signature over the DSSE PAE bytes, base64-encoded.' })
  @IsBase64()
  @IsString()
  sig: string;
}
