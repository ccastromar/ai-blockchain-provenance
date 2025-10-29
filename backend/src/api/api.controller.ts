import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, ParseIntPipe, Logger, Query } from '@nestjs/common';
import { ApiService } from './api.service';
import { RegisterModelDto } from './dto/register-model.dto';
import { LogInferenceDto } from './dto/log-inference.dto';
import { AnchorEventsService } from './anchor-events.service';

@Controller('api')
export class ApiController {
  private readonly logger = new Logger(ApiController.name);

  constructor(private readonly apiService: ApiService,
    private readonly anchorEventsService: AnchorEventsService
  ) { 
    console.log("ApiController initialized!");
  }

  @Post('models')
  @HttpCode(HttpStatus.CREATED)
  async registerModel(@Body() dto: RegisterModelDto) {
    this.logger.log(`Received registerModel request for model: ${dto.modelName}`);
    return await this.apiService.registerModel(dto);
  }

  @Post('inferences')
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

  @Get('debug/blocks')
  async debugBlocks() {
    const blocks = await this.apiService.getAllBlocks();

    return blocks.map(block => ({
      index: block.index,
      timestamp: block.timestamp,
      timestampISO: new Date(block.timestamp).toISOString(),
      storedHash: block.hash,
      calculatedHash: this.calculateHashDebug(block),
      match: block.hash === this.calculateHashDebug(block)
    }));
  }

  @Get('blocks')
  async getAllBlocks() {
    return await this.apiService.getAllBlocks();
  }

  @Get('blocks/:index')
  async getBlockByIndex(@Param('index', ParseIntPipe) index: number) {
    const block = await this.apiService.getBlockByIndex(index);
    if (!block) {
      return { error: 'Block not found' };
    }
    return block;
  }

  @Get('debug/data-structure')
  async debugDataStructure() {
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

  private calculateHashDebug(block: any): string {
    const crypto = require('crypto');
    const timestampString = block.timestamp instanceof Date
      ? block.timestamp.toISOString()
      : new Date(block.timestamp).toISOString();

    const dataString = JSON.stringify(block.data, Object.keys(block.data).sort());
    const blockString = [
      block.index,
      timestampString,
      dataString,
      block.previousHash,
      block.nonce
    ].join('|');

    return crypto.createHash('sha256').update(blockString).digest('hex');
  }

}
