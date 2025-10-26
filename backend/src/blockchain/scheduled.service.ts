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
    // inyecta el modelo Anchor
    @InjectModel(Anchor.name) private anchorModel: Model<AnchorDocument>,
  ) {}  
  
  /**
   * Revisa periódicamente los anchors pendientes y actualiza si están minados.
   * Ejecuta cada minuto.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async confirmPendingAnchors() {
    // Busca los anchors con status pending 
    const pending = await this.anchorModel.find({ status: 'pending' }).lean();

    if (pending.length === 0) {
      this.logger.debug(`No pending anchors...`);
      return
    };

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
                status: 'confirmed', // puedes poner este campo o cualquier otro
                confirmedAt: new Date()
              }
            }
          );
          this.logger.log(
            `Anchor ${anchor.txHash} confirmed in block ${receipt.blockNumber}`
          );
        } else {
          this.logger.log(
            `Anchor ${anchor.txHash} still pending...`
          );
        }
      } catch (e: any) {
        this.logger.warn(`Error checking anchor ${anchor.txHash}: ${e.message}`);
      }
    }
  }
}
