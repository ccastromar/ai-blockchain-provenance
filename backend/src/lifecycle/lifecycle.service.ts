import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProvenanceBlock, ProvenanceBlockDocument } from '../blockchain/models/provenance-block.schema';
import { Anchor, AnchorDocument } from '../blockchain/models/anchor.schema';
import { LegalHold, LegalHoldDocument } from './legal-hold.schema';

// ADR-003 data lifecycle: retention floor, legal hold, and a (non-destructive) retention
// plan. Actual block deletion is deliberately NOT performed here -- it would break
// buildMerkleTree/getBlockProof and the from-genesis integrity re-scan, which must first be
// reworked to respect a prune watermark. This service enforces the policy and legal holds
// and plans/archives; the destructive step is a guarded follow-up.
@Injectable()
export class LifecycleService {
  constructor(
    @InjectModel(ProvenanceBlock.name) private readonly blockModel: Model<ProvenanceBlockDocument>,
    @InjectModel(Anchor.name) private readonly anchorModel: Model<AnchorDocument>,
    @InjectModel(LegalHold.name) private readonly holdModel: Model<LegalHoldDocument>,
  ) {}

  get retentionMinDays(): number {
    return Number(process.env.RETENTION_MIN_DAYS ?? 180);
  }

  policy() {
    return { retentionMinDays: this.retentionMinDays, destructivePruneEnabled: false };
  }

  // ── Legal hold ──────────────────────────────────────────────────────────────
  async setHold(scope: string, target: string | undefined, reason: string, setBy?: string) {
    const doc = await this.holdModel.create({ scope, target, reason, active: true, setBy });
    return this.view(doc);
  }

  async listHolds(activeOnly = false) {
    const q = activeOnly ? { active: true } : {};
    return (await this.holdModel.find(q).sort({ createdAt: -1 }).lean()).map((d) => this.view(d));
  }

  async clearHold(id: string, clearedBy?: string): Promise<boolean> {
    const res = await this.holdModel.updateOne(
      { _id: id, active: true },
      { active: false, clearedAt: new Date(), clearedBy },
    );
    return res.modifiedCount > 0;
  }

  /** Active holds that would exempt blocks, split by scope for the plan. */
  private async activeHolds() {
    const holds = await this.holdModel.find({ active: true }).lean();
    return {
      global: holds.some((h) => h.scope === 'global'),
      organizations: new Set(holds.filter((h) => h.scope === 'organization' && h.target).map((h) => h.target!)),
      models: new Set(holds.filter((h) => h.scope === 'model' && h.target).map((h) => h.target!)),
      count: holds.length,
    };
  }

  // ── Retention plan (non-destructive) ──────────────────────────────────────────
  /**
   * What is eligible to leave hot storage: blocks older than the retention floor, at or
   * below the latest CONFIRMED anchor (so the anchor + a cold archive still prove they
   * existed), and not exempted by an active legal hold. Returns a plan only -- nothing is
   * archived or deleted.
   */
  async planRetention() {
    const latestConfirmed = await this.anchorModel
      .findOne({ status: 'confirmed' })
      .sort({ lastBlockIndex: -1 })
      .lean();

    const cutoff = new Date(Date.now() - this.retentionMinDays * 24 * 60 * 60 * 1000);
    const holds = await this.activeHolds();

    if (!latestConfirmed) {
      return {
        retentionMinDays: this.retentionMinDays,
        cutoff: cutoff.toISOString(),
        coveringAnchor: null,
        eligibleUpToIndex: null,
        eligibleCount: 0,
        exemptByHold: 0,
        note: 'No confirmed anchor yet; nothing is eligible to archive (pruning below an anchor is the invariant).',
      };
    }

    // The invariant: never consider anything at or above the latest confirmed anchor's
    // covered range. Only blocks strictly below it, older than cutoff.
    const anchorIndex = latestConfirmed.lastBlockIndex;
    const candidates = await this.blockModel
      .find({ index: { $lte: anchorIndex }, createdAt: { $lt: cutoff } })
      .select('index data createdAt')
      .sort({ index: 1 })
      .lean();

    let eligibleUpToIndex: number | null = null;
    let eligibleCount = 0;
    let exemptByHold = 0;
    for (const b of candidates) {
      const org = (b.data as any)?.organizationId;
      const modelId = (b.data as any)?.modelId;
      const held = holds.global || (org && holds.organizations.has(org)) || (modelId && holds.models.has(modelId));
      if (held) {
        exemptByHold += 1;
        continue; // a hold anywhere in the range stops contiguous pruning past it
      }
      // Eligible range must stay contiguous from genesis for a clean archive boundary.
      if (eligibleUpToIndex === null || b.index === eligibleUpToIndex + 1) {
        eligibleUpToIndex = b.index;
        eligibleCount += 1;
      } else {
        break;
      }
    }

    return {
      retentionMinDays: this.retentionMinDays,
      cutoff: cutoff.toISOString(),
      coveringAnchor: {
        merkleRoot: latestConfirmed.merkleRoot,
        lastBlockIndex: anchorIndex,
        status: latestConfirmed.status,
        txHash: latestConfirmed.txHash || undefined,
      },
      eligibleUpToIndex,
      eligibleCount,
      exemptByHold,
      activeHolds: holds.count,
      note: 'Plan only. Archive the eligible range (GET /api/lifecycle/archive?upto=<index>) before any prune. Destructive pruning is not enabled (see ADR-003).',
    };
  }

  /** Streams blocks 0..uptoIndex for the verifiable cold archive (reuses export shape). */
  async archiveCursor(uptoIndex: number) {
    const totalBlocks = await this.blockModel.countDocuments({ index: { $lte: uptoIndex } });
    const cursor = this.blockModel
      .find({ index: { $lte: uptoIndex } })
      .select('-_id -__v')
      .sort({ index: 1 })
      .lean()
      .cursor();
    return { exportedAt: new Date().toISOString(), totalBlocks, uptoIndex, cursor };
  }

  private view(d: any) {
    return {
      id: d._id?.toString?.() ?? String(d._id),
      scope: d.scope,
      target: d.target ?? null,
      reason: d.reason,
      active: d.active,
      setBy: d.setBy ?? null,
      createdAt: d.createdAt,
      clearedAt: d.clearedAt ?? null,
    };
  }
}
