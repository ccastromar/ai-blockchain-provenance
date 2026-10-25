import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { PlatformAdminGuard } from '../common/platform-admin.guard';
import { LifecycleService } from './lifecycle.service';

class SetLegalHoldDto {
  @IsIn(['global', 'organization', 'model']) scope: string;
  @IsOptional() @IsString() target?: string;
  @IsString() @MinLength(1) reason: string;
}

// ADR-003 data lifecycle. Reads are gated by the global ReadAccessGuard; mutations
// (set/clear legal hold) additionally require write access via ApiKeyGuard.
@ApiTags('Lifecycle')
@Controller('api/lifecycle')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get('policy')
  @ApiOperation({ summary: 'Retention policy in force (floor in days; whether destructive pruning is enabled).' })
  @ApiOkResponse({ description: 'Retention policy.' })
  policy() {
    return this.lifecycle.policy();
  }

  @Get('plan')
  @ApiOperation({ summary: 'Non-destructive retention plan: which contiguous history is eligible to archive (older than the floor, below the latest confirmed anchor, not under legal hold).' })
  @ApiOkResponse({ description: 'Retention plan (dry run).' })
  plan() {
    return this.lifecycle.planRetention();
  }

  @Get('legal-holds')
  @ApiOperation({ summary: 'List legal holds (active and cleared).' })
  @ApiOkResponse({ description: 'Legal holds.' })
  listHolds(@Query('activeOnly') activeOnly?: string) {
    return this.lifecycle.listHolds(activeOnly === 'true');
  }

  @Post('legal-holds')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Place a legal hold (global, or scoped to an organization/model). Exempts matching blocks from retention pruning.' })
  @ApiOkResponse({ description: 'The created legal hold.' })
  setHold(@Body() dto: SetLegalHoldDto, @Req() req: any) {
    const setBy = req.ernestAccess?.subject || req.ernestAccess?.label;
    return this.lifecycle.setHold(dto.scope, dto.target, dto.reason, setBy);
  }

  @Delete('legal-holds/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Clear (deactivate) a legal hold. The record is kept for audit.' })
  @ApiOkResponse({ description: 'Whether an active hold was cleared.' })
  async clearHold(@Param('id') id: string, @Req() req: any) {
    const clearedBy = req.ernestAccess?.subject || req.ernestAccess?.label;
    const cleared = await this.lifecycle.clearHold(id, clearedBy);
    return { cleared };
  }

  @Get('archive')
  @ApiOperation({ summary: 'Stream a verifiable cold archive of blocks 0..upto for history leaving hot storage. Same format as /api/blocks/export.' })
  @ApiOkResponse({ description: 'Bounded, streamed chain export.' })
  async archive(@Query('upto') upto: string, @Res() res: any) {
    const uptoIndex = Number(upto);
    if (!Number.isInteger(uptoIndex) || uptoIndex < 0) {
      res.status(400).json({ statusCode: 400, message: 'upto must be a non-negative integer block index' });
      return;
    }
    const { exportedAt, totalBlocks, cursor } = await this.lifecycle.archiveCursor(uptoIndex);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="ernest-archive-0-${uptoIndex}.json"`);
    res.write(`{"exportedAt":${JSON.stringify(exportedAt)},"uptoIndex":${uptoIndex},"totalBlocks":${totalBlocks},"blocks":[`);
    let first = true;
    for await (const block of cursor) {
      res.write((first ? '' : ',') + JSON.stringify(block));
      first = false;
    }
    res.end(']}');
  }
}
