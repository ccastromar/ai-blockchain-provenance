import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EventFailureQueryDto } from './dto/event-failure-query.dto';
import { IngestedEventQueryDto } from './dto/ingested-event-query.dto';
import { IngestedEventService } from './ingested-event.service';

@ApiTags('Ingestion')
@Controller('api/ingested-events')
export class IngestedEventController {
  constructor(private readonly ingestedEventService: IngestedEventService) {}

  @Get('failures')
  @ApiOperation({ summary: 'Return failed external events written to the dead-letter log.' })
  @ApiQuery({ name: 'source', required: false, example: 'sagemaker' })
  @ApiQuery({ name: 'eventType', required: false, example: 'model.approved' })
  @ApiQuery({ name: 'failureKind', required: false, example: 'auth_rejected' })
  @ApiOkResponse({ description: 'Paginated dead-letter events.' })
  async findFailures(@Query() query: EventFailureQueryDto) {
    return await this.ingestedEventService.findFailures(query.page, query.limit, {
      source: query.source,
      eventType: query.eventType,
      failureKind: query.failureKind,
    });
  }

  @Get('failures/stats')
  @ApiOperation({ summary: 'Return dead-letter event totals grouped by source and event type.' })
  @ApiOkResponse({ description: 'Dead-letter event operational statistics.' })
  async getFailureStats() {
    return await this.ingestedEventService.getFailureStats();
  }

  @Get()
  @ApiOperation({ summary: 'Return ingested external events (paginated).' })
  @ApiQuery({ name: 'status', required: false, example: 'appended' })
  @ApiQuery({ name: 'source', required: false, example: 'random-local-emitter' })
  @ApiQuery({ name: 'eventType', required: false, example: 'model.version.created' })
  @ApiQuery({ name: 'verificationStatus', required: false, example: 'provider_secret' })
  @ApiOkResponse({ description: 'Paginated ingested external events.' })
  async findAll(@Query() query: IngestedEventQueryDto) {
    return await this.ingestedEventService.findAll(query.page, query.limit, {
      status: query.status,
      source: query.source,
      eventType: query.eventType,
      verificationStatus: query.verificationStatus,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Return ingested event totals grouped by status, source, and event type.' })
  @ApiOkResponse({ description: 'Ingested event operational statistics.' })
  async getStats() {
    return await this.ingestedEventService.getStats();
  }
}
