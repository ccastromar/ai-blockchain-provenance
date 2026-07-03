import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, ParseIntPipe, Logger, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiCreatedResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PaginationDto } from '../common/dto/pagination.dto';
import { OrgId } from '../common/org-id.decorator';
import { ApiService } from './api.service';
import { RegisterModelDto } from './dto/register-model.dto';
import { LogInferenceDto } from './dto/log-inference.dto';
import { AnchorEventsService } from './anchor-events.service';
import { ApiKeyGuard } from '../common/api-key.guard';

@ApiTags('Provenance')
@Controller('api')
export class ApiController {
  private readonly logger = new Logger(ApiController.name);

  constructor(private readonly apiService: ApiService,
    private readonly anchorEventsService: AnchorEventsService
  ) {}

  @Post('models')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Register a model and append a model block to the hashchain.' })
  @ApiHeader({ name: 'X-Ernest-Org-Id', required: false, description: 'Organization scope (overrides body.organizationId)' })
  @ApiCreatedResponse({ description: 'Model registered and stored in the hashchain.' })
  async registerModel(@Body() dto: RegisterModelDto, @OrgId() orgId?: string) {
    this.logger.log(`Received registerModel request for model: ${dto.modelName}`);
    return await this.apiService.registerModel({ ...dto, organizationId: orgId ?? dto.organizationId });
  }

  @Post('inferences')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Log an inference using input/output hashes and append an inference block.' })
  @ApiOkResponse({ description: 'Inference logged and stored in the hashchain.' })
  async logInference(@Body() dto: LogInferenceDto) {
    this.logger.log(`Received logInference request for model ID: ${dto.modelId}`);
    return await this.apiService.logInference(dto);
  }

  @Post('demo/seed')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Seed a ready-to-audit demo evidence packet.' })
  @ApiCreatedResponse({ description: 'Demo model and inference evidence are available.' })
  async seedDemoData() {
    this.logger.log('Received demo seed request');
    return await this.apiService.seedDemoData();
  }

  @Get('provenances')
  @ApiOperation({ summary: 'Return provenance blocks for a model.' })
  @ApiQuery({ name: 'modelId', example: 'openai-community/gpt2', description: 'Model identifier. Query form supports IDs containing slashes.' })
  @ApiQuery({ name: 'type', required: false, enum: ['model_registration', 'inference'], description: 'Filter by block type' })
  @ApiQuery({ name: 'from', required: false, type: Number, description: 'Unix timestamp (seconds) - start of range' })
  @ApiQuery({ name: 'to', required: false, type: Number, description: 'Unix timestamp (seconds) - end of range' })
  @ApiHeader({ name: 'X-Ernest-Org-Id', required: false, description: 'Scope results to an organization' })
  @ApiOkResponse({ description: 'Model provenance and current chain verification status.' })
  async getProvenanceByQuery(
    @Query('modelId') modelId: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @OrgId() orgId?: string,
  ) {
    return await this.apiService.getProvenance(modelId, {
      type,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      organizationId: orgId,
    });
  }

  @Get('provenances/:modelId')
  @ApiOperation({ summary: 'Return provenance blocks for a model.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiQuery({ name: 'type', required: false, enum: ['model_registration', 'inference'], description: 'Filter by block type' })
  @ApiQuery({ name: 'from', required: false, type: Number, description: 'Unix timestamp (seconds) - start of range' })
  @ApiQuery({ name: 'to', required: false, type: Number, description: 'Unix timestamp (seconds) - end of range' })
  @ApiHeader({ name: 'X-Ernest-Org-Id', required: false, description: 'Scope results to an organization' })
  @ApiOkResponse({ description: 'Model provenance and current chain verification status.' })
  async getProvenance(
    @Param('modelId') modelId: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @OrgId() orgId?: string,
  ) {
    return await this.apiService.getProvenance(modelId, {
      type,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      organizationId: orgId,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Return hashchain statistics and latest anchor metadata.' })
  @ApiOkResponse({ description: 'Hashchain block count, model count, last block, verification status, and latest anchor if available.' })
  async getStats() {
    return await this.apiService.getChainStats();
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verify hashchain integrity.' })
  @ApiOkResponse({ description: 'Chain verification result and any integrity errors.' })
  async verifyChain() {
    return await this.apiService.verifyChain();
  }

  @Post('anchors')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Compute the current Merkle root and submit it to the configured anchor contract.' })
  @ApiAcceptedResponse({ description: 'Anchor transaction was accepted or anchoring metadata was returned.' })
  async anchorMerkleRoot() {
    return await this.apiService.anchorMerkleRoot();
  }

  @Get('anchors/status')
  @ApiOperation({ summary: 'Return anchoring configuration and local/Sepolia RPC reachability.' })
  @ApiOkResponse({ description: 'Anchoring mode, RPC reachability, contract address, and latest stored anchor.' })
  async getAnchorStatus() {
    return await this.apiService.getAnchorStatus();
  }

  @Get('blocks')
  @ApiOperation({ summary: 'Return raw hashchain blocks (paginated).' })
  @ApiOkResponse({ description: 'Paginated raw hashchain blocks.' })
  async getAllBlocks(@Query() pagination: PaginationDto) {
    return await this.apiService.getAllBlocks(pagination.page, pagination.limit);
  }

  // Declared before blocks/:index so "export" is not captured by the ParseIntPipe param.
  @Get('blocks/export')
  @ApiOperation({ summary: 'Export the full hashchain as a flat JSON bundle for offline verification (e.g. ernest CLI --file mode).' })
  @ApiOkResponse({ description: 'All blocks sorted by index, stripped of Mongo internals.' })
  async exportAllBlocks() {
    return await this.apiService.exportAllBlocks();
  }

  @Get('blocks/:index/proof')
  @ApiOperation({ summary: 'SPV-style inclusion receipt: Merkle proof connecting a block to its covering confirmed anchor. Verifiable offline (ernest proof verify).' })
  @ApiParam({ name: 'index', example: 42, type: Number })
  @ApiOkResponse({ description: 'Self-contained evidence receipt: block, proof path, anchored Merkle root and anchor transaction metadata.' })
  @ApiNotFoundResponse({ description: 'Block not found.' })
  async getBlockProof(@Param('index', ParseIntPipe) index: number) {
    const receipt = await this.apiService.getBlockProof(index);
    if (!receipt) {
      throw new NotFoundException('Block not found');
    }
    return receipt;
  }

  @Get('blocks/:index')
  @ApiOperation({ summary: 'Return a raw hashchain block by index.' })
  @ApiParam({ name: 'index', example: 1, type: Number })
  @ApiOkResponse({ description: 'Raw hashchain block.' })
  @ApiNotFoundResponse({ description: 'Block not found.' })
  async getBlockByIndex(@Param('index', ParseIntPipe) index: number) {
    const block = await this.apiService.getBlockByIndex(index);
    if (!block) {
      throw new NotFoundException('Block not found');
    }
    return block;
  }

  @Get('debug/data-structure')
  async debugDataStructure() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException('Not found');
    }

    const { items: blocks } = await this.apiService.getAllBlocks(1, 200);

    return blocks.map(block => ({
      index: block.index,
      type: block.data.type,
      fields: Object.keys(block.data).sort(),
      hasUndefined: Object.values(block.data).some(v => v === undefined),
      dataStringified: JSON.stringify(block.data, Object.keys(block.data).sort())
    }));
  }

  @Get('provenances/:modelId/export')
  @ApiOperation({ summary: 'Export provenance for a model as a signed JSON bundle.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'Signed provenance bundle (HMAC-SHA256 using ERNEST_API_KEY).' })
  async exportProvenance(@Param('modelId') modelId: string) {
    return await this.apiService.exportProvenance(modelId);
  }

  @Get('provenances/:modelId/export/cyclonedx')
  @ApiOperation({ summary: 'Export provenance for a model as a CycloneDX 1.6 AI/ML-BOM document.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'CycloneDX BOM with a machine-learning-model component describing this model.' })
  async exportProvenanceCycloneDx(@Param('modelId') modelId: string) {
    return await this.apiService.exportProvenanceCycloneDx(modelId);
  }

  @Get('models/:modelId/integrity')
  @ApiOperation({ summary: 'Verify hashchain integrity for a specific model.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'Integrity check result for the model blocks.' })
  async verifyModelIntegrity(@Param('modelId') modelId: string) {
    return await this.apiService.verifyModelIntegrity(modelId);
  }

  @Get('models/ids')
  @ApiOperation({ summary: 'Return registered model identifiers.' })
  @ApiOkResponse({ description: 'List of registered model IDs.' })
  async getModelIds() {
    const { items } = await this.apiService.getAllModels();
    return items.map(m => m.modelId);
  }

  @Get('events')
  @ApiOperation({ summary: 'Return all on-chain anchor events discovered for the configured contract.' })
  @ApiOkResponse({ description: 'Anchor events from the configured blockchain provider.' })
  async getAllEvents() {
    return await this.anchorEventsService.getAllAnchoredEvents();
  }

  @Get('events/address')
  @ApiOperation({ summary: 'Return anchor events created by an Ethereum address.' })
  @ApiQuery({ name: 'address', example: '0x0000000000000000000000000000000000000000' })
  @ApiOkResponse({ description: 'Anchor events for the requested address.' })
  async getEventsByAddress(@Query('address') address: string) {
    return await this.anchorEventsService.getAnchorsByAddress(address);
  }

  @Get('events/organization')
  @ApiOperation({ summary: 'Return anchor events for an organization ID.' })
  @ApiQuery({ name: 'orgId', example: 'ernest-demo' })
  @ApiOkResponse({ description: 'Anchor events for the requested organization ID.' })
  async getEventsByOrgId(@Query('orgId') orgId: string) {
    return await this.anchorEventsService.getAnchorsByOrganizationId(orgId);
  }

}
