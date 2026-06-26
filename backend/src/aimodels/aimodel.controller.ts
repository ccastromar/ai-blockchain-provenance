import { Controller, Get, Param, Logger } from '@nestjs/common';
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

}
