import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from './pagination.dto';

export class BlockListQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Page order by block index: `asc` (genesis first, default) or `desc` (newest first). Ignored with `after`, which always walks forward.',
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
