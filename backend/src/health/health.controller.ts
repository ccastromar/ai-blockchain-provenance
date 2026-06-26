import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Return backend health status.' })
  @ApiOkResponse({ description: 'Backend is running.' })
  check() {
    return { status: 'ok' };
  }
}
