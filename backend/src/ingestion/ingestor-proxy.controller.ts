import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/api-key.guard';
import { IngestorProxyService } from './ingestor-proxy.service';

@ApiTags('Ingestion')
@Controller('api/ingestor')
export class IngestorProxyController {
  constructor(private readonly ingestorProxyService: IngestorProxyService) {}

  @Get('auth')
  @ApiOperation({ summary: 'Return ingestor authentication mode visible to the UI.' })
  @ApiOkResponse({ description: 'Ingestor auth mode and whether frontend simulation is proxied.' })
  getAuthStatus() {
    return this.ingestorProxyService.getAuthStatus();
  }

  @Get('health')
  @ApiOperation({ summary: 'Return ingestor pipeline health, auth mode, and operational ingestion stats.' })
  @ApiOkResponse({ description: 'Ingestor reachability, auth mode, verification counts, and failure counts.' })
  async getHealth() {
    return await this.ingestorProxyService.getHealth();
  }

  @Post('simulate/huggingface')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Emit a demo Hugging Face event through the server-side ingestor proxy.' })
  @ApiAcceptedResponse({ description: 'Demo Hugging Face event accepted by the ingestor.' })
  async simulateHuggingFaceEvent() {
    return await this.ingestorProxyService.simulateHuggingFaceEvent();
  }

  @Post('simulate/sagemaker')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Emit a demo SageMaker event through the server-side ingestor proxy.' })
  @ApiAcceptedResponse({ description: 'Demo SageMaker event accepted by the ingestor.' })
  async simulateSageMakerEvent() {
    return await this.ingestorProxyService.simulateSageMakerEvent();
  }

  @Post('simulate/azureml')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Emit a demo Azure ML Event Grid event through the server-side ingestor proxy.' })
  @ApiAcceptedResponse({ description: 'Demo Azure ML event accepted by the ingestor.' })
  async simulateAzureMlEvent() {
    return await this.ingestorProxyService.simulateAzureMlEvent();
  }

  @Post('simulate/openlineage')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Emit a demo OpenLineage event through the server-side ingestor proxy.' })
  @ApiAcceptedResponse({ description: 'Demo OpenLineage event accepted by the ingestor.' })
  async simulateOpenLineageEvent() {
    return await this.ingestorProxyService.simulateOpenLineageEvent();
  }

  @Post('simulate/opentelemetry')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Emit a demo OpenTelemetry log batch through the server-side ingestor proxy.' })
  @ApiAcceptedResponse({ description: 'Demo OpenTelemetry inference event accepted by the ingestor.' })
  async simulateOpenTelemetryLogs() {
    return await this.ingestorProxyService.simulateOpenTelemetryLogs();
  }
}
