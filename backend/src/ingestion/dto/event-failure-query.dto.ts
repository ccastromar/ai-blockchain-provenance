import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class EventFailureQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'sagemaker' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: 'model.approved' })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({ example: 'auth_rejected' })
  @IsOptional()
  @IsString()
  failureKind?: string;
}
