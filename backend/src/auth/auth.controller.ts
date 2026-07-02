import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/api-key.guard';
import { AccessTokenService } from './access-token.service';
import { resolveAccess } from './access-role.util';
import { CreateAccessTokenDto } from './dto/create-access-token.dto';

const API_KEY_HEADER = 'x-ernest-api-key';

export type ErnestRole = 'read-write' | 'read-only' | 'anonymous';

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly tokenService: AccessTokenService) {}

  @Get('whoami')
  @ApiOperation({ summary: 'Return the access role granted by the provided X-Ernest-Api-Key header.' })
  @ApiOkResponse({ description: '"role" is one of read-write, read-only, or anonymous.' })
  async whoami(@Req() request: any): Promise<{ role: ErnestRole; openAccess: boolean; label?: string }> {
    const writeKey = process.env.ERNEST_API_KEY;
    const readKey = process.env.ERNEST_READ_API_KEY;

    if (!writeKey && !readKey) {
      return { role: 'read-write', openAccess: true };
    }

    const headerValue = request.headers[API_KEY_HEADER];
    const actualKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const { role, label } = await resolveAccess(actualKey, this.tokenService);
    return { role, openAccess: false, ...(label ? { label } : {}) };
  }

  @Post('tokens')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Issue a named, revocable access token (e.g. for a temporary external auditor). Requires read-write access.' })
  @ApiCreatedResponse({ description: 'The raw token is returned exactly once and cannot be retrieved again.' })
  async createToken(@Body() dto: CreateAccessTokenDto) {
    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;
    return await this.tokenService.create(dto.label, dto.role, expiresAt);
  }

  @Get('tokens')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'List issued access tokens (never includes the raw token value). Requires read-write access.' })
  @ApiOkResponse({ description: 'Issued access tokens.' })
  async listTokens() {
    return await this.tokenService.list();
  }

  @Delete('tokens/:id')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('ernest-api-key')
  @ApiOperation({ summary: 'Revoke an access token immediately. Requires read-write access.' })
  @ApiOkResponse({ description: 'Token revoked.' })
  async revokeToken(@Param('id') id: string) {
    const revoked = await this.tokenService.revoke(id);
    if (!revoked) throw new NotFoundException(`Token ${id} not found or already revoked`);
    return { revoked: true };
  }
}
