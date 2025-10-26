import { Controller, Get, Post, Body, Param, Put, Delete, Logger } from '@nestjs/common';
import { AIModelService } from './aimodel.service';

@Controller('api/models')
export class AIModelController {
  private readonly logger = new Logger(AIModelController.name);
  
  constructor(private readonly modelService: AIModelService) {}

  @Get()
  async findAll() {
    this.logger.log('Fetching all AI models');
    return await this.modelService.findAll();
  }

  @Get(':modelId')
  async findOne(@Param('modelId') modelId: string) {
    return await this.modelService.findOne(modelId);
  }

  @Post()
  async create(@Body() data: any) {
    return await this.modelService.create(data);
  }

  @Put(':modelId')
  async update(@Param('modelId') modelId: string, @Body() update: any) {
    return await this.modelService.update(modelId, update);
  }

  @Delete(':modelId')
  async remove(@Param('modelId') modelId: string) {
    return await this.modelService.remove(modelId);
  }
}
