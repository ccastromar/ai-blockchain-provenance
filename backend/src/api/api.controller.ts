import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, ParseIntPipe, Logger, Query, NotFoundException, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiAcceptedResponse, ApiCreatedResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PaginationDto } from '../common/dto/pagination.dto';
import { BlockListQueryDto } from '../common/dto/block-list-query.dto';
import { OrgId } from '../common/org-id.decorator';
import { ApiService } from './api.service';
import { RegisterModelDto } from './dto/register-model.dto';
import { LogInferenceBatchDto } from './dto/log-inference-batch.dto';
import { LogInferenceDto } from './dto/log-inference.dto';
import { AnchorEventsService } from './anchor-events.service';
import { ApiKeyGuard } from '../common/api-key.guard';

/** `?wait=true|false` (ADR-004); absent or anything else = the batching mode's default. */
function parseWait(raw?: string): boolean | undefined {
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

/** ADR-004: a newly accepted event that is not chained yet is 202, not 200/201. */
function acceptedStatus(res: any, result: any) {
  if (result?.status === 'pending' && !result.duplicate) res.status(HttpStatus.ACCEPTED);
  return result;
}

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
  @ApiHeader({ name: 'X-Ernest-Org-Id', required: false, description: 'Organization scope (overrides body.organizationId)' })
  @ApiCreatedResponse({ description: 'Model registered and stored in the hashchain.' })
  @ApiQuery({ name: 'wait', required: false, type: Boolean, description: 'EVIDENCE_BATCHING only: hold the response until the event is chained.' })
  async registerModel(
    @Body() dto: RegisterModelDto,
    @Res({ passthrough: true }) res: any,
    @OrgId() orgId?: string,
    @Query('wait') wait?: string,
  ) {
    this.logger.log(`Received registerModel request for model: ${dto.modelName}`);
    return acceptedStatus(res, await this.apiService.registerModel(
      { ...dto, organizationId: orgId ?? dto.organizationId },
      { wait: parseWait(wait) },
    ));
  }

  @Post('inferences')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Log an inference using input/output hashes and append an inference block.' })
  @ApiOkResponse({ description: 'Inference logged and stored in the hashchain (or, with EVIDENCE_BATCHING, a duplicate of an already recorded one).' })
  @ApiAcceptedResponse({ description: 'EVIDENCE_BATCHING: event recorded, not chained yet (status "pending"; proofUrl answers once it is).' })
  @ApiQuery({ name: 'wait', required: false, type: Boolean, description: 'EVIDENCE_BATCHING only: hold the response until the event is chained.' })
  async logInference(@Body() dto: LogInferenceDto, @Res({ passthrough: true }) res: any, @Query('wait') wait?: string) {
    this.logger.log(`Received logInference request for model ID: ${dto.modelId}`);
    return acceptedStatus(res, await this.apiService.logInference(dto, { wait: parseWait(wait) }));
  }

  @Post('inferences/batch')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({
    summary: 'Log up to 500 inferences in one request.',
    description: 'Each item is validated and admitted exactly as POST /api/inferences. Items fail independently; `results[i].status` is the status that item alone would have received.',
  })
  @ApiOkResponse({ description: '{ appended, failed, results: [{ inferenceId, status, blockIndex?, blockHash?, error? }] }' })
  @ApiQuery({ name: 'wait', required: false, type: Boolean, description: 'EVIDENCE_BATCHING only: hold the response until every accepted item is chained.' })
  async logInferenceBatch(@Body() dto: LogInferenceBatchDto, @Query('wait') wait?: string) {
    return await this.apiService.logInferenceBatch(dto.items, { wait: parseWait(wait) });
  }

  @Get('events/export')
  @ApiOperation({ summary: 'ADR-004: export every batched evidence event (seq order) for offline verification of batch roots, next to /api/blocks/export. Streamed with constant memory.' })
  @ApiOkResponse({ description: '{ exportedAt, totalEvents, events: [{ seq, source, eventId, data, leafHash, blockIndex, leafIndex }] }' })
  async exportEvents(@Res() res: any) {
    const { exportedAt, totalEvents, cursor } = await this.apiService.exportBatchedEventsCursor();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ernest-events-export.json"');
    res.write(`{"exportedAt":${JSON.stringify(exportedAt)},"totalEvents":${totalEvents},"events":[`);
    try {
      let first = true;
      for await (const event of cursor) {
        res.write((first ? '' : ',') + JSON.stringify(event));
        first = false;
      }
      res.end(']}');
    } catch (error) {
      // Same rule as the block export: a truncated stream must look truncated.
      this.logger.error(`Events export stream failed: ${(error as Error).message}`);
      res.destroy(error as Error);
    }
  }

  @Get('events/:source/:eventId/proof')
  @ApiOperation({
    summary: 'ADR-004 inclusion proof for one evidence event, verifiable offline.',
    description: 'URL-encode both segments (API submissions use source `api/<modelId>`). Returns the event data, its RFC 6962 audit path to the batch root (or `kind: block` for a per-event block), the block, and the anchor receipt for that block once an anchor covers it. 202 while the event is still pending.',
  })
  @ApiOkResponse({ description: 'status chained: event, inclusion, block, anchor (null + anchorPending until anchored).' })
  @ApiAcceptedResponse({ description: 'status pending: recorded, not chained yet.' })
  @ApiNotFoundResponse({ description: 'No event with that source and id.' })
  async getEventProof(@Param('source') source: string, @Param('eventId') eventId: string, @Res({ passthrough: true }) res: any) {
    const proof = await this.apiService.getEventProof(source, eventId);
    if (!proof) {
      throw new NotFoundException('Event not found');
    }
    if (proof.status === 'pending') res.status(HttpStatus.ACCEPTED);
    return proof;
  }

  @Post('demo/seed')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Seed a ready-to-audit demo evidence packet.' })
  @ApiCreatedResponse({ description: 'Demo model and inference evidence are available.' })
  async seedDemoData() {
    this.logger.log('Received demo seed request');
    return await this.apiService.seedDemoData();
  }

  @Get('provenances')
  @ApiOperation({ summary: 'Return provenance blocks for a model.' })
  @ApiQuery({ name: 'modelId', example: 'openai-community/gpt2', description: 'Model identifier. Query form supports IDs containing slashes.' })
  @ApiQuery({ name: 'type', required: false, enum: ['model_registration', 'inference', 'policy_decision', 'external_event'], description: 'Filter by block type' })
  @ApiQuery({ name: 'from', required: false, type: Number, description: 'Unix timestamp (seconds) - start of range' })
  @ApiQuery({ name: 'to', required: false, type: Number, description: 'Unix timestamp (seconds) - end of range' })
  @ApiHeader({ name: 'X-Ernest-Org-Id', required: false, description: 'Scope results to an organization' })
  @ApiOkResponse({ description: 'Model provenance and current chain verification status.' })
  async getProvenanceByQuery(
    @Query('modelId') modelId: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @OrgId() orgId?: string,
  ) {
    return await this.apiService.getProvenance(modelId, {
      type,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      organizationId: orgId,
    });
  }

  @Get('provenances/:modelId')
  @ApiOperation({ summary: 'Return provenance blocks for a model.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiQuery({ name: 'type', required: false, enum: ['model_registration', 'inference', 'policy_decision', 'external_event'], description: 'Filter by block type' })
  @ApiQuery({ name: 'from', required: false, type: Number, description: 'Unix timestamp (seconds) - start of range' })
  @ApiQuery({ name: 'to', required: false, type: Number, description: 'Unix timestamp (seconds) - end of range' })
  @ApiHeader({ name: 'X-Ernest-Org-Id', required: false, description: 'Scope results to an organization' })
  @ApiOkResponse({ description: 'Model provenance and current chain verification status.' })
  async getProvenance(
    @Param('modelId') modelId: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @OrgId() orgId?: string,
  ) {
    return await this.apiService.getProvenance(modelId, {
      type,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      organizationId: orgId,
    });
  }

  @Get('stats/models')
  @ApiOperation({
    summary: 'Count evidence blocks for several models in one call.',
    description: 'Comma-separated `ids` (max 500). Answered from the chain-derived read models (ADR-006; `indexedUpTo` = last block counted) — chained evidence only. Chain integrity itself is GET /api/verify. Unknown ids are reported with 0.',
  })
  @ApiQuery({ name: 'ids', required: true, type: String })
  @ApiOkResponse({ description: '{ counts: { [modelId]: n } }' })
  async getModelEvidenceCounts(@Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (list.length === 0 || list.length > 500) {
      throw new BadRequestException('ids must list between 1 and 500 model ids');
    }
    return await this.apiService.evidenceCountsByModel([...new Set(list)]);
  }

  @Get('stats/executions')
  @ApiOperation({
    summary: 'Count execution evidence per AI system (for policy-drift checks).',
    description: 'Server-side aggregation over an index. `since` is an exclusive block index; pass the returned `upToIndex` to continue incrementally.',
  })
  @ApiQuery({ name: 'since', required: false, type: Number })
  @ApiOkResponse({ description: '{ counts: { [aiSystemId]: n }, lastExecutionAt: { [aiSystemId]: ISO time of the latest execution }, sinceIndex, upToIndex }' })
  async getExecutionCounts(@Query('since') since?: string) {
    const parsed = since === undefined || since === '' ? undefined : Number(since);
    if (parsed !== undefined && (!Number.isInteger(parsed) || parsed < -1)) {
      throw new BadRequestException('since must be an integer >= -1');
    }
    return await this.apiService.executionCountsBySystem(parsed);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Return hashchain statistics and latest anchor metadata.' })
  @ApiOkResponse({ description: 'Hashchain block count, model count, last block, verification status, and latest anchor if available.' })
  async getStats() {
    return await this.apiService.getChainStats();
  }

  @Get('verify')
  @ApiOperation({
    summary: 'Verify hashchain integrity.',
    description: 'Incremental by default: verifies the blocks appended since the last trusted checkpoint (whose hash is pinned), so the cost does not grow with the chain. `?mode=full` re-hashes the whole chain.',
  })
  @ApiQuery({ name: 'mode', required: false, enum: ['incremental', 'full'] })
  @ApiOkResponse({ description: 'Chain verification result and any integrity errors.' })
  async verifyChain(@Query('mode') mode?: string) {
    return await this.apiService.verifyChain(mode);
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

  @Get('anchors/status')
  @ApiOperation({ summary: 'Return anchoring configuration and local/Sepolia RPC reachability.' })
  @ApiOkResponse({ description: 'Anchoring mode, RPC reachability, contract address, and latest stored anchor.' })
  async getAnchorStatus() {
    return await this.apiService.getAnchorStatus();
  }

  @Get('blocks')
  @ApiOperation({ summary: 'Return raw hashchain blocks (paginated).' })
  @ApiOkResponse({ description: 'Paginated raw hashchain blocks.' })
  async getAllBlocks(@Query() query: BlockListQueryDto) {
    return await this.apiService.getAllBlocks(query.page, query.limit, query.after, query.order);
  }

  // Declared before blocks/:index so "export" is not captured by the ParseIntPipe param.
  @Get('anchors/:id/ots')
  @ApiOperation({ summary: 'Download an OpenTimestamps proof (.ots) for offline verification with the official ots client.' })
  @ApiParam({ name: 'id', description: 'Anchor id (see /api/anchors/status or a block receipt)' })
  @ApiOkResponse({ description: 'Serialized .ots proof bytes.' })
  @ApiNotFoundResponse({ description: 'No OTS anchor with that id.' })
  async downloadOtsProof(@Param('id') id: string, @Res() res: any) {
    const result = await this.apiService.getOtsProof(id).catch(() => null);
    if (!result) {
      res.status(404).json({ statusCode: 404, message: 'No OTS anchor with that id' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="ernest-anchor-${id}.ots"`);
    res.end(result.proof);
  }

  @Get('anchors/:id/ots/raw')
  @ApiOperation({ summary: 'Download the raw Merkle-root bytes that the .ots proof commits to. Needed to verify: `ots verify -f ernest-anchor-<id> ernest-anchor-<id>.ots`.' })
  @ApiParam({ name: 'id', description: 'Anchor id' })
  @ApiOkResponse({ description: 'The 32 raw bytes of the anchored Merkle root.' })
  @ApiNotFoundResponse({ description: 'No OTS anchor with that id.' })
  async downloadOtsRoot(@Param('id') id: string, @Res() res: any) {
    const result = await this.apiService.getOtsProof(id).catch(() => null);
    if (!result) {
      res.status(404).json({ statusCode: 404, message: 'No OTS anchor with that id' });
      return;
    }
    // Exactly the bytes stamped (see OtsClient.stamp) — no extension so the filename
    // matches the .ots proof's base name for `ots verify` to pair them automatically.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="ernest-anchor-${id}"`);
    res.end(Buffer.from(result.anchor.merkleRoot.replace(/^0x/, ''), 'hex'));
  }

  @Get('anchors/:id/tst')
  @ApiOperation({ summary: 'Download the RFC 3161 qualified timestamp (.tsr) for an anchor. Verify offline: `openssl ts -verify -data ernest-anchor-<id> -in ernest-anchor-<id>.tsr -CAfile <tsa-chain>.pem`.' })
  @ApiParam({ name: 'id', description: 'Anchor id' })
  @ApiOkResponse({ description: 'The DER TimeStampResp (RFC 3161) over the anchored Merkle root.' })
  @ApiNotFoundResponse({ description: 'No anchor with that id has a qualified timestamp.' })
  async downloadQtsToken(@Param('id') id: string, @Res() res: any) {
    const result = await this.apiService.getQtsToken(id).catch(() => null);
    if (!result) {
      res.status(404).json({ statusCode: 404, message: 'No qualified timestamp for that anchor' });
      return;
    }
    // Full DER TimeStampResp; pairs with the raw root at /ots/raw for `openssl ts -verify`.
    res.setHeader('Content-Type', 'application/timestamp-reply');
    res.setHeader('Content-Disposition', `attachment; filename="ernest-anchor-${id}.tsr"`);
    res.end(result.token);
  }

  @Get('blocks/export')
  @ApiOperation({ summary: 'Export the full hashchain as a flat JSON bundle for offline verification (e.g. ernest CLI --file mode). Streamed with constant memory.' })
  @ApiOkResponse({ description: 'All blocks sorted by index, stripped of Mongo internals.' })
  async exportAllBlocks(@Res() res: any) {
    const { exportedAt, totalBlocks, cursor } = await this.apiService.exportAllBlocksCursor();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ernest-chain-export.json"');
    res.write(`{"exportedAt":${JSON.stringify(exportedAt)},"totalBlocks":${totalBlocks},"blocks":[`);
    try {
      let first = true;
      for await (const block of cursor) {
        res.write((first ? '' : ',') + JSON.stringify(block));
        first = false;
      }
      res.end(']}');
    } catch (error) {
      // Headers are already sent: the only honest failure mode mid-stream is killing
      // the connection so the client sees a truncated (hence unverifiable) bundle
      // rather than a silently complete-looking one.
      this.logger.error(`Chain export stream failed: ${(error as Error).message}`);
      res.destroy(error as Error);
    }
  }

  @Get('blocks/:index/proof')
  @ApiOperation({ summary: 'SPV-style inclusion receipt: Merkle proof connecting a block to its covering confirmed anchor. Verifiable offline (ernest proof verify).' })
  @ApiParam({ name: 'index', example: 42, type: Number })
  @ApiOkResponse({ description: 'Self-contained evidence receipt: block, proof path, anchored Merkle root and anchor transaction metadata.' })
  @ApiNotFoundResponse({ description: 'Block not found.' })
  async getBlockProof(@Param('index', ParseIntPipe) index: number) {
    const receipt = await this.apiService.getBlockProof(index);
    if (!receipt) {
      throw new NotFoundException('Block not found');
    }
    return receipt;
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

    const { items: blocks } = await this.apiService.getAllBlocks(1, 200);

    return blocks.map(block => ({
      index: block.index,
      type: block.data.type,
      fields: Object.keys(block.data).sort(),
      hasUndefined: Object.values(block.data).some(v => v === undefined),
      dataStringified: JSON.stringify(block.data, Object.keys(block.data).sort())
    }));
  }

  @Get('provenances/:modelId/export')
  @ApiOperation({ summary: 'Export provenance for a model as a signed JSON bundle.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'Signed provenance bundle (HMAC-SHA256 using ERNEST_API_KEY).' })
  async exportProvenance(@Param('modelId') modelId: string) {
    return await this.apiService.exportProvenance(modelId);
  }

  @Get('provenances/:modelId/export/cyclonedx')
  @ApiOperation({ summary: 'Export provenance for a model as a CycloneDX 1.6 AI/ML-BOM document.' })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiOkResponse({ description: 'CycloneDX BOM with a machine-learning-model component describing this model.' })
  async exportProvenanceCycloneDx(@Param('modelId') modelId: string) {
    return await this.apiService.exportProvenanceCycloneDx(modelId);
  }

  @Get('models/:modelId/integrity')
  @ApiOperation({
    summary: 'Verify hashchain integrity for a specific model.',
    description: '`mode=indexed` (default, ADR-006): every block holding the model\'s evidence was validated when it was connected to the chain. `?mode=full` re-hashes every block and re-derives every batch root now.',
  })
  @ApiParam({ name: 'modelId', example: 'credit-risk-logreg-v1' })
  @ApiQuery({ name: 'mode', required: false, enum: ['indexed', 'full'] })
  @ApiOkResponse({ description: 'Integrity check result for the model blocks.' })
  async verifyModelIntegrity(@Param('modelId') modelId: string, @Query('mode') mode?: string) {
    return await this.apiService.verifyModelIntegrity(modelId, mode);
  }

  @Get('models/ids')
  @ApiOperation({ summary: 'Return registered model identifiers.' })
  @ApiOkResponse({ description: 'List of registered model IDs.' })
  async getModelIds() {
    const { items } = await this.apiService.getAllModels();
    return items.map(m => m.modelId);
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
