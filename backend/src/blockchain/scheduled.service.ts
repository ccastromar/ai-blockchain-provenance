import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { Anchor, AnchorDocument } from './models/anchor.schema';
import { Model } from 'mongoose';

@Injectable()
export class ScheduledBlockchainService {

  private readonly logger = new Logger(ScheduledBlockchainService.name);

  constructor(
    @InjectModel(Anchor.name) private anchorModel: Model<AnchorDocument>,
  ) {}

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
