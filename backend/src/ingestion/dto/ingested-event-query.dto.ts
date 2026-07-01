import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class IngestedEventQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'appended' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'sagemaker' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: 'model.approved' })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({ example: 'provider_secret' })
  @IsOptional()
  @IsString()
  verificationStatus?: string;
}
