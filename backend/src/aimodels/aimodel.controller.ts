import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Logger, Query, UseGuards } from '@nestjs/common';
import { ApiConflictResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AIModelService } from './aimodel.service';
import { UpdateModelStatusDto } from './dto/update-model-status.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { OrgId } from '../common/org-id.decorator';
import { ApiKeyGuard } from '../common/api-key.guard';

@ApiTags('Models')
@Controller('api/models')
export class AIModelController {
  private readonly logger = new Logger(AIModelController.name);

  constructor(private readonly modelService: AIModelService) {}

  @Get()
  @ApiOperation({ summary: 'Return registered model records (paginated). Scope to an org with X-Ernest-Org-Id.' })
  @ApiHeader({ name: 'X-Ernest-Org-Id', required: false, description: 'Filter results by organization' })
  @ApiOkResponse({ description: 'Paginated registered model records.' })
  async findAll(@Query() pagination: PaginationDto, @OrgId() orgId?: string) {
    this.logger.log('Fetching all AI models');
    return await this.modelService.findAll(pagination.page, pagination.limit, orgId);
  }

  @Get(':modelId')
  @ApiOperation({ summary: 'Return one registered model record by model ID.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'Registered model record.' })
  async findOne(@Param('modelId') modelId: string) {
    return await this.modelService.findOne(modelId);
  }

  @Patch(':modelId/status')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Update model status (active | deprecated | archived).' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'Updated model record.' })
  @ApiConflictResponse({ description: 'The model is governed by another system of record; change its status there.' })
  async updateStatus(
    @Param('modelId') modelId: string,
    @Body() dto: UpdateModelStatusDto,
  ) {
    // A system governed elsewhere (Prudence's registry, with four-eyes approval) must not get
    // a second, weaker lifecycle here.
    const existing: any = await this.modelService.findOne(modelId);
    const owner = existing?.governance?.systemOfRecord;
    if (owner) {
      throw new ConflictException(`Model ${modelId} is governed by ${owner}; change its status there.`);
    }
    const updated = await this.modelService.update(modelId, { status: dto.status });
    if (!updated) throw new NotFoundException(`Model ${modelId} not found`);
    return updated;
  }

}
