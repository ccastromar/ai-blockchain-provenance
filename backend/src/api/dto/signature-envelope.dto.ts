import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsIn, IsISO8601, IsString, Matches } from 'class-validator';

/** ADR-001 signature envelope: Ed25519 over DSSE PAE of the Ernest-canonical
 * submission payload (block data minus `signature` minus server-augmented fields). */
export class SignatureEnvelopeDto {
  @ApiProperty({ enum: ['ed25519'] })
  @IsIn(['ed25519'])
  alg: string;

  @ApiProperty({ description: 'First 16 hex chars of sha256(raw public key).' })
  @Matches(/^[0-9a-f]{16}$/)
  keyId: string;

  @ApiProperty({ description: 'Raw 32-byte Ed25519 public key, base64-encoded.' })
  @IsBase64()
  publicKey: string;

  @ApiProperty({ description: 'Client-claimed signing time (ISO 8601). Informational; the chain and anchors bound the recorded time.' })
  @IsISO8601()
  signedAt: string;

  @ApiProperty({ description: '64-byte Ed25519 signature, base64-encoded.' })
  @IsBase64()
  @IsString()
  sig: string;
}
