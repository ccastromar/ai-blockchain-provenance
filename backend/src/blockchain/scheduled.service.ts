import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { Anchor, AnchorDocument } from './models/anchor.schema';
import { IntegrityCheck, IntegrityCheckDocument } from './models/integrity-check.schema';
import { Model } from 'mongoose';
import { BlockchainService } from './blockchain.service';

@Injectable()
export class ScheduledBlockchainService implements OnModuleInit {

  private readonly logger = new Logger(ScheduledBlockchainService.name);

  constructor(
    @InjectModel(Anchor.name) private anchorModel: Model<AnchorDocument>,
    @InjectModel(IntegrityCheck.name) private integrityCheckModel: Model<IntegrityCheckDocument>,
    private readonly blockchainService: BlockchainService,
  ) {}

  async onModuleInit() {
    // Run once at startup instead of waiting for the first cron tick, so a chain that's
    // already broken is flagged immediately rather than up to an hour later.
    await this.checkChainIntegrity();
  }

  /**
   * Periodically re-verify the full hashchain and record the result. verifyChain() only
   * *detects* tampering when someone happens to call it (e.g. via /api/verify) — nothing
   * ran it on a schedule before, so a broken chain could go unnoticed indefinitely.
   * Executed hourly since it recomputes a hash per block (O(n) crypto work).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkChainIntegrity() {
    let result: { isValid: boolean; errors: string[] };
    try {
      result = await this.blockchainService.verifyChain();
    } catch (e: any) {
      this.logger.error(`Chain integrity check could not run: ${e.message}`);
      return;
    }

    const checkedAt = new Date();
    await this.integrityCheckModel.create({
      isValid: result.isValid,
      errors: result.errors,
      checkedAt,
    });

    if (result.isValid) {
      this.logger.debug('Chain integrity check passed');
    } else {
      this.logger.error(`Chain integrity check FAILED: ${result.errors.join('; ')}`);
      await this.notifyIntegrityWebhook(result.errors, checkedAt);
    }
  }

  private async notifyIntegrityWebhook(errors: string[], checkedAt: Date) {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) return;

    const payload = {
      event: 'chain.integrity.failed',
      errors,
      checkedAt: checkedAt.toISOString(),
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      this.logger.log(`Integrity failure webhook notified: ${webhookUrl} → ${res.status}`);
    } catch (e: any) {
      this.logger.warn(`Integrity failure webhook delivery failed (${webhookUrl}): ${e.message}`);
    }
  }

  /**
   * Periodically check the pending anchors and update them if they are mined.
   * Executed every 10 minutes.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async confirmPendingAnchors() {
    if (!process.env.INFURA_URL) {
      this.logger.debug(`Skipping pending anchor confirmation: INFURA_URL is not configured`);
      return;
    }

    const pending = await this.anchorModel.find({ status: 'pending' }).lean();

    if (pending.length === 0) {
      this.logger.debug(`No pending anchors...`);
      return;
    }

    const provider = new ethers.JsonRpcProvider(process.env.INFURA_URL!);
    this.logger.debug(`Checking ${pending.length} pending anchors...`);

    for (const anchor of pending) {
      try {
        const receipt = await provider.getTransactionReceipt(anchor.txHash);
        if (receipt && receipt.blockNumber) {
          await this.anchorModel.updateOne(
            { _id: anchor._id },
            {
              $set: {
                blockNumber: receipt.blockNumber,
                status: 'confirmed',
                confirmedAt: new Date(),
              },
            },
          );
          this.logger.log(`Anchor ${anchor.txHash} confirmed in block ${receipt.blockNumber}`);
          await this.notifyWebhook(anchor.txHash, anchor.merkleRoot, receipt.blockNumber, anchor.organizationId);
        } else {
          this.logger.log(`Anchor ${anchor.txHash} still pending...`);
        }
      } catch (e: any) {
        this.logger.warn(`Error checking anchor ${anchor.txHash}: ${e.message}`);
      }
    }
  }

  private async notifyWebhook(
    txHash: string,
    merkleRoot: string,
    blockNumber: number,
    organizationId: string,
  ) {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) return;

    const payload = {
      event: 'anchor.confirmed',
      txHash,
      merkleRoot,
      blockNumber,
      organizationId,
      confirmedAt: new Date().toISOString(),
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      this.logger.log(`Webhook notified: ${webhookUrl} → ${res.status}`);
    } catch (e: any) {
      this.logger.warn(`Webhook delivery failed (${webhookUrl}): ${e.message}`);
    }
  }
}
