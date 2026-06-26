import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, ParseIntPipe, Logger, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
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
  @ApiCreatedResponse({ description: 'Model registered and stored in the hashchain.' })
  async registerModel(@Body() dto: RegisterModelDto) {
    this.logger.log(`Received registerModel request for model: ${dto.modelName}`);
    return await this.apiService.registerModel(dto);
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

  @Get('provenances/:modelId')
  @ApiOperation({ summary: 'Return all provenance blocks for a model.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'Model provenance and current chain verification status.' })
  async getProvenance(@Param('modelId') modelId: string) {
    return await this.apiService.getProvenance(modelId);
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

  @Get('blocks')
  @ApiOperation({ summary: 'Return all raw hashchain blocks.' })
  @ApiOkResponse({ description: 'Raw hashchain blocks.' })
  async getAllBlocks() {
    return await this.apiService.getAllBlocks();
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

    const blocks = await this.apiService.getAllBlocks();

    return blocks.map(block => ({
      index: block.index,
      type: block.data.type,
      fields: Object.keys(block.data).sort(),
      hasUndefined: Object.values(block.data).some(v => v === undefined),
      dataStringified: JSON.stringify(block.data, Object.keys(block.data).sort())
    }));
  }

  @Get('models/ids')
  @ApiOperation({ summary: 'Return registered model identifiers.' })
  @ApiOkResponse({ description: 'List of registered model IDs.' })
  async getModelIds() {
    const models = await this.apiService.getAllModels();
    return models.map(m => m.modelId);
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
