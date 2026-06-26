import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, ParseIntPipe, Logger, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiService } from './api.service';
import { RegisterModelDto } from './dto/register-model.dto';
import { LogInferenceDto } from './dto/log-inference.dto';
import { AnchorEventsService } from './anchor-events.service';
import { ApiKeyGuard } from '../common/api-key.guard';

@Controller('api')
export class ApiController {
  private readonly logger = new Logger(ApiController.name);

  constructor(private readonly apiService: ApiService,
    private readonly anchorEventsService: AnchorEventsService
  ) {}

  @Post('models')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  async registerModel(@Body() dto: RegisterModelDto) {
    this.logger.log(`Received registerModel request for model: ${dto.modelName}`);
    return await this.apiService.registerModel(dto);
  }

  @Post('inferences')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async logInference(@Body() dto: LogInferenceDto) {
    this.logger.log(`Received logInference request for model ID: ${dto.modelId}`);
    return await this.apiService.logInference(dto);
  }

  @Get('provenances/:modelId')
  async getProvenance(@Param('modelId') modelId: string) {
    return await this.apiService.getProvenance(modelId);
  }

  @Get('stats')
  async getStats() {
    return await this.apiService.getChainStats();
  }

  @Get('verify')
  async verifyChain() {
    return await this.apiService.verifyChain();
  }

  @Post('anchors')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async anchorMerkleRoot() {
    return await this.apiService.anchorMerkleRoot();
  }

  @Get('blocks')
  async getAllBlocks() {
    return await this.apiService.getAllBlocks();
  }

  @Get('blocks/:index')
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
  async getModelIds() {
    const models = await this.apiService.getAllModels();
    return models.map(m => m.modelId);
  }

  @Get('events')
  async getAllEvents() {
    return await this.anchorEventsService.getAllAnchoredEvents();
  }

  @Get('events/address')
  async getEventsByAddress(@Query('address') address: string) {
    return await this.anchorEventsService.getAnchorsByAddress(address);
  }

  @Get('events/organization')
  async getEventsByOrgId(@Query('orgId') orgId: string) {
    return await this.anchorEventsService.getAnchorsByOrganizationId(orgId);
  }

}
