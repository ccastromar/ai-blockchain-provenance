import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AccessTokenRole } from '../access-token.schema';

export class CreateAccessTokenDto {
  @ApiProperty({ example: 'Auditor - Acme Corp' })
  @IsString()
  @MinLength(1)
  label: string;

  @ApiProperty({ enum: ['read-write', 'read-only'], example: 'read-only' })
  @IsEnum(['read-write', 'read-only'])
  role: AccessTokenRole;

  @ApiProperty({ required: false, example: 30, description: 'Token expires this many days after creation. Omit for no expiry.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
