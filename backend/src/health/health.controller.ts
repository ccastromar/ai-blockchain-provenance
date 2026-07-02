import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Anchor, AnchorDocument } from '../blockchain/models/anchor.schema';
import { IntegrityCheck, IntegrityCheckDocument } from '../blockchain/models/integrity-check.schema';
import { ethers } from 'ethers';

@ApiTags('Health')
@Controller('health')
export class HealthController {

  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @InjectModel(Anchor.name) private readonly anchorModel: Model<AnchorDocument>,
    @InjectModel(IntegrityCheck.name) private readonly integrityCheckModel: Model<IntegrityCheckDocument>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Return detailed backend health status.' })
  @ApiOkResponse({ description: 'Health status for each subsystem.' })
  async check() {
    const [mongo, ethereum, cron, integrity] = await Promise.all([
      this.checkMongo(),
      this.checkEthereum(),
      this.checkCron(),
      this.checkIntegrity(),
    ]);

    const allOk = mongo.status === 'ok' && cron.status === 'ok' && integrity.status !== 'error';

    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      subsystems: { mongo, ethereum, cron, integrity },
    };
  }

  private async checkMongo(): Promise<{ status: string; detail?: string }> {
    try {
      const state = this.mongoConnection.readyState;
      // 1 = connected, 2 = connecting, 3 = disconnecting, 0 = disconnected
      if (state === 1) return { status: 'ok' };
      return { status: 'degraded', detail: `readyState=${state}` };
    } catch (e: any) {
      return { status: 'error', detail: e.message };
    }
  }

  private async checkEthereum(): Promise<{ status: string; detail?: string }> {
    const rpcUrl = process.env.INFURA_URL;
    if (!rpcUrl) {
      return { status: 'not_configured' };
    }
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const network = await Promise.race([
        provider.getNetwork(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 4000),
        ),
      ]);
      return { status: 'ok', detail: `chainId=${(network as any).chainId}` };
    } catch (e: any) {
      return { status: 'error', detail: e.message };
    }
  }

  private async checkCron(): Promise<{ status: string; detail?: string }> {
    try {
      const pendingCount = await this.anchorModel.countDocuments({ status: 'pending' });
      const lastConfirmed = await this.anchorModel
        .findOne({ status: 'confirmed' })
        .sort({ confirmedAt: -1 })
        .lean();

      return {
        status: 'ok',
        detail: `pending=${pendingCount}, lastConfirmed=${lastConfirmed?.confirmedAt?.toISOString() ?? 'none'}`,
      };
    } catch (e: any) {
      return { status: 'error', detail: e.message };
    }
  }

  private async checkIntegrity(): Promise<{ status: string; detail?: string }> {
    try {
      const last = await this.integrityCheckModel.findOne().sort({ checkedAt: -1 }).lean();
      if (!last) {
        return { status: 'unknown', detail: 'No integrity check has run yet' };
      }
      return {
        status: last.isValid ? 'ok' : 'error',
        detail: last.isValid
          ? `checkedAt=${last.checkedAt.toISOString()}`
          : `checkedAt=${last.checkedAt.toISOString()}, errors=${last.errors.join('; ')}`,
      };
    } catch (e: any) {
      return { status: 'error', detail: e.message };
    }
  }
}
