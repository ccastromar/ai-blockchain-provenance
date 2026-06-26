import { Controller, Get, Param, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AIModelService } from './aimodel.service';

@ApiTags('Models')
@Controller('api/models')
export class AIModelController {
  private readonly logger = new Logger(AIModelController.name);
  
  constructor(private readonly modelService: AIModelService) {}

  @Get()
  @ApiOperation({ summary: 'Return all registered model records.' })
  @ApiOkResponse({ description: 'Registered model records.' })
  async findAll() {
    this.logger.log('Fetching all AI models');
    return await this.modelService.findAll();
  }

  @Get(':modelId')
  @ApiOperation({ summary: 'Return one registered model record by model ID.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'Registered model record, or null when the model is unknown.' })
  async findOne(@Param('modelId') modelId: string) {
    return await this.modelService.findOne(modelId);
  }

}
