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
   * Periodically re-verify the hashchain and record the result, checkpointed so the
   * hourly cost is O(new blocks) instead of O(chain):
   *
   * - INCREMENTAL (hourly): re-hash from the last checkpoint to the tip, after
   *   confirming the checkpoint block still carries the hash recorded at the last
   *   successful check. Catches tail corruption and any recompute-forward rewrite.
   * - ANCHOR ROOT (every run): recompute the latest confirmed anchor's Merkle root
   *   from local hashes. This is the check with external teeth — the root lives on a
   *   public chain, so rewriting anchored history cannot fool it even if every local
   *   record (checkpoints included) is updated to match.
   * - FULL (every INTEGRITY_FULL_SCAN_HOURS, default 24): re-hash everything. The one
   *   thing only a full scan catches is a "lazy" tamper — block data edited while its
   *   stored hash is left untouched — before the checkpoint, since neither the
   *   incremental pass nor the anchor root (built from stored hashes) re-reads old data.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkChainIntegrity() {
    const checkedAt = new Date();
    const errors: string[] = [];
    let mode: 'full' | 'incremental' = 'full';
    let result: Awaited<ReturnType<BlockchainService['verifyChain']>>;

    try {
      const checkpoint = await this.integrityCheckModel
        .findOne({ isValid: true, lastVerifiedIndex: { $gte: 0 } })
        .sort({ checkedAt: -1 })
        .lean();

      const fullScanHours = Number(process.env.INTEGRITY_FULL_SCAN_HOURS || 24);
      const lastFull = await this.integrityCheckModel
        .findOne({ isValid: true, mode: 'full' })
        .sort({ checkedAt: -1 })
        .lean();
      const fullScanDue =
        !lastFull || checkedAt.getTime() - new Date(lastFull.checkedAt).getTime() >= fullScanHours * 3600_000;

      if (checkpoint && !fullScanDue) {
        mode = 'incremental';
        result = await this.blockchainService.verifyChain(checkpoint.lastVerifiedIndex! + 1);
        // The incremental pass re-hashed the checkpoint block itself (fromIndex - 1);
        // also pin it to what the last successful check recorded, so a rewrite that
        // regenerated a consistent tail since then still trips over history.
        const checkpointBlock = await this.blockchainService.getBlockByIndex(checkpoint.lastVerifiedIndex!);
        if (!checkpointBlock) {
          errors.push(`Checkpoint block ${checkpoint.lastVerifiedIndex} has disappeared`);
        } else if (checkpointBlock.hash !== checkpoint.lastVerifiedHash) {
          errors.push(
            `Checkpoint mismatch at block ${checkpoint.lastVerifiedIndex}: hash was ${checkpoint.lastVerifiedHash} at the last check, now ${checkpointBlock.hash} — pre-checkpoint history appears rewritten`,
          );
        }
      } else {
        result = await this.blockchainService.verifyChain();
      }
    } catch (e: any) {
      this.logger.error(`Chain integrity check could not run: ${e.message}`);
      return;
    }
    errors.push(...result.errors);

    const anchorCheck = await this.blockchainService.verifyLatestAnchorRoot();
    if (anchorCheck.checked && !anchorCheck.ok) {
      errors.push(anchorCheck.error!);
    }

    const isValid = errors.length === 0;
    await this.integrityCheckModel.create({
      isValid,
      errors,
      checkedAt,
      mode,
      blocksVerified: result.blocksVerified,
      // Only advance the checkpoint on a fully clean pass: a failed check must leave
      // the previous trusted checkpoint in place.
      ...(isValid && result.lastVerifiedIndex !== null
        ? { lastVerifiedIndex: result.lastVerifiedIndex, lastVerifiedHash: result.lastVerifiedHash }
        : {}),
      ...(anchorCheck.checked ? { anchorRootOk: anchorCheck.ok } : {}),
    });

    if (isValid) {
      this.logger.debug(`Chain integrity check passed (${mode}, ${result.blocksVerified} blocks)`);
    } else {
      this.logger.error(`Chain integrity check FAILED: ${errors.join('; ')}`);
      await this.notifyIntegrityWebhook(errors, checkedAt);
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
