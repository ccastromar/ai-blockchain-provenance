import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from './pagination.dto';

export const MODEL_SORTS = ['recent', 'name', 'risk', 'activity', 'governed'] as const;
export const MODEL_KINDS = ['all', 'models', 'records'] as const;
export type ModelSort = (typeof MODEL_SORTS)[number];
export type ModelKind = (typeof MODEL_KINDS)[number];

/** Model list: pagination plus which kind of entry and in which order. */
export class ModelListQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Order: recent (newest record first, the default), name, risk (prohibited first), activity (latest update first), governed (systems governed elsewhere first).',
    enum: MODEL_SORTS,
    default: 'recent',
  })
  @IsOptional()
  @IsIn(MODEL_SORTS as unknown as string[])
  sort?: ModelSort;

  @ApiPropertyOptional({
    description:
      'Which entries: models (AI systems and models), records (governance registers such as Prudence incidents, reviews and attestations), or all.',
    enum: MODEL_KINDS,
    default: 'all',
  })
  @IsOptional()
  @IsIn(MODEL_KINDS as unknown as string[])
  kind?: ModelKind;
}
