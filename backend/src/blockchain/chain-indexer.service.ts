import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BlockchainService } from './blockchain.service';
import { ProvenanceBlock, ProvenanceBlockDocument } from './models/provenance-block.schema';
import { EvidenceEvent, EvidenceEventDocument } from './models/evidence-event.schema';
import { IntegrityCheck, IntegrityCheckDocument } from './models/integrity-check.schema';
import {
    ChainIndexState, ChainIndexStateDocument, ModelIndex, ModelIndexDocument, SystemIndex, SystemIndexDocument,
} from './models/chain-index.schema';
import { hasRole } from '../common/ernest-role';

const STATE_ID = 'chain';

/**
 * ADR-006: validate each block when it is connected and derive read models from it, the way a
 * Bitcoin node connects blocks and keeps its indexes. Runs with the `chainer` role.
 *
 * Blocks are taken in index order from the indexed tip. Each is validated as GET /api/verify
 * would (contiguity, hash, link, batch root re-derived from the stored event data); an invalid
 * block stops the indexer there. A valid block's counts are applied to the per-model and
 * per-system rows, each guarded by the last block it already holds, then the tip moves and the
 * integrity checkpoint follows it. Readers answer from these rows; the rows are a cache of
 * facts about the chain, never evidence.
 */
@Injectable()
export class ChainIndexerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ChainIndexerService.name);
    private timer: NodeJS.Timeout | null = null;
    private running = false;
    private reportedStall: number | null = null;

    constructor(
        @InjectModel(ProvenanceBlock.name) private readonly blockModel: Model<ProvenanceBlockDocument>,
        @InjectModel(EvidenceEvent.name) private readonly eventModel: Model<EvidenceEventDocument>,
        @InjectModel(IntegrityCheck.name) private readonly checkModel: Model<IntegrityCheckDocument>,
        @InjectModel(ChainIndexState.name) private readonly stateModel: Model<ChainIndexStateDocument>,
        @InjectModel(ModelIndex.name) private readonly modelIndex: Model<ModelIndexDocument>,
        @InjectModel(SystemIndex.name) private readonly systemIndex: Model<SystemIndexDocument>,
        private readonly blockchain: BlockchainService,
    ) { }

    enabled(): boolean {
        return (process.env.CHAIN_INDEXER || 'on').toLowerCase() !== 'off';
    }

    private intervalMs(): number {
        const n = Number.parseInt(process.env.CHAIN_INDEXER_INTERVAL_MS || '1000', 10);
        return Number.isFinite(n) && n >= 100 ? n : 1000;
    }

    /** How far behind the chain tip the indexes may be and still answer reads. */
    private maxLag(): number {
        const n = Number.parseInt(process.env.CHAIN_INDEXER_MAX_LAG_BLOCKS || '100', 10);
        return Number.isFinite(n) && n >= 0 ? n : 100;
    }

    async onModuleInit() {
        if (!this.enabled() || !hasRole('chainer')) return;
        await this.ensureIndexes();
        this.timer = setInterval(() => this.kick(), this.intervalMs());
        this.logger.log(`Chain indexer started (interval=${this.intervalMs()}ms)`);
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    async ensureIndexes(): Promise<void> {
        await this.modelIndex.collection.createIndex({ modelId: 1 }, { unique: true, name: 'unique_model' });
        await this.systemIndex.collection.createIndex({ aiSystemId: 1 }, { unique: true, name: 'unique_system' });
    }

    private kick() {
        if (this.running) return;
        this.running = true;
        this.syncOnce()
            .catch(err => this.logger.warn(`chain indexer pass failed: ${err?.message ?? err}`))
            .finally(() => { this.running = false; });
    }

    /** Connects up to `max` blocks after the indexed tip. Returns how many were connected. */
    async syncOnce(max = 500): Promise<number> {
        const state = await this.stateModel.findById(STATE_ID).lean();
        let tipIndex = state?.index ?? -1;
        let tipHash = state?.hash ?? null;
        const next = await this.blockModel.find({ index: { $gt: tipIndex } }).sort({ index: 1 }).limit(max).lean();

        let connected = 0;
        for (const block of next as any[]) {
            const errors = await this.validate(block, tipIndex, tipHash);
            if (errors.length > 0) {
                await this.stateModel.updateOne(
                    { _id: STATE_ID },
                    { $set: { stalledAt: block.index, error: errors.join('; '), updatedAt: new Date() } },
                    { upsert: true },
                );
                if (this.reportedStall !== block.index) {
                    this.reportedStall = block.index;
                    this.logger.error(`Chain indexer stopped at block ${block.index}: ${errors.join('; ')}`);
                }
                break;
            }
            await this.apply(block);
            await this.advance(block);
            tipIndex = block.index;
            tipHash = block.hash;
            connected += 1;
        }
        if (connected > 0) {
            this.reportedStall = null;
            await this.checkpoint(tipIndex, tipHash!, connected);
        }
        return connected;
    }

    /** The same checks GET /api/verify applies to a block, against the indexed tip. */
    private async validate(block: any, tipIndex: number, tipHash: string | null): Promise<string[]> {
        const errors: string[] = [];
        if (block.index !== tipIndex + 1) {
            errors.push(`Block ${block.index}: expected index ${tipIndex + 1} — chain is not contiguous`);
        }
        if (block.hash !== this.blockchain.calculateHash(block)) {
            errors.push(`Block ${block.index}: hash mismatch`);
        }
        if (tipHash !== null && block.previousHash !== tipHash) {
            errors.push(`Block ${block.index}: broken link to block ${tipIndex}`);
        }
        if (block.data?.type === 'batch') {
            errors.push(...await this.blockchain.verifyBatchBlock(block));
        }
        return errors;
    }

    /** Counts a validated block into the read models. Safe to repeat for the same block. */
    private async apply(block: any): Promise<void> {
        const models = new Map<string, number>();
        const systems = new Map<string, number>();
        const add = (map: Map<string, number>, key: unknown, n: number) => {
            if (typeof key === 'string' && key !== '') map.set(key, (map.get(key) ?? 0) + n);
        };
        if (block.data?.type === 'batch') {
            const rows = await this.eventModel.aggregate([
                { $match: { seq: { $gte: block.data.firstSeq, $lte: block.data.lastSeq } } },
                { $group: {
                    _id: {
                        model: '$modelId',
                        system: { $cond: [{ $eq: ['$data.metadata.stage', 'execution'] }, '$data.metadata.aiSystemId', null] },
                    },
                    n: { $sum: 1 },
                } },
            ]);
            for (const r of rows) {
                add(models, r._id.model, r.n);
                add(systems, r._id.system, r.n);
            }
        } else {
            add(models, block.data?.modelId, 1);
            if (block.data?.metadata?.stage === 'execution') add(systems, block.data?.metadata?.aiSystemId, 1);
        }
        const now = new Date();
        await Promise.all([
            ...[...models].map(([id, n]) => this.bump(this.modelIndex, 'modelId', id, 'events', n, block.index, now)),
            ...[...systems].map(([id, n]) => this.bump(this.systemIndex, 'aiSystemId', id, 'executions', n, block.index, now)),
        ]);
    }

    /**
     * Adds `n` to a row unless it already holds this block. When the row is at or past the
     * block, the filter misses and the upsert collides with the unique key: already applied.
     */
    private async bump(model: Model<any>, key: string, id: string, field: string, n: number, at: number, now: Date) {
        try {
            await model.updateOne(
                { [key]: id, lastBlockIndex: { $lt: at } },
                { $inc: { [field]: n }, $set: { lastBlockIndex: at, updatedAt: now }, $min: { firstBlockIndex: at } },
                { upsert: true },
            );
        } catch (err) {
            if (err?.code !== 11000) throw err;
        }
    }

    /** Moves the tip forward only (two indexers can never move it back). */
    private async advance(block: any): Promise<void> {
        try {
            await this.stateModel.updateOne(
                { _id: STATE_ID, $or: [{ index: { $lt: block.index } }, { index: { $exists: false } }] },
                { $set: { index: block.index, hash: block.hash, updatedAt: new Date() }, $unset: { stalledAt: 1, error: 1 } },
                { upsert: true },
            );
        } catch (err) {
            if (err?.code !== 11000) throw err;
        }
    }

    /** The validated tip is the integrity checkpoint incremental verification starts from. */
    private async checkpoint(index: number, hash: string, blocks: number): Promise<void> {
        await this.checkModel.updateOne(
            { source: 'indexer' },
            { $set: {
                source: 'indexer', isValid: true, errors: [], checkedAt: new Date(), mode: 'incremental',
                blocksVerified: blocks, lastVerifiedIndex: index, lastVerifiedHash: hash,
            } },
            { upsert: true },
        );
    }

    // ------------------------------------------------------------------ reads

    /** The indexed tip when it is close enough to the chain tip to answer reads, else null. */
    async readyTip(): Promise<{ index: number; error?: string } | null> {
        const [state, tip] = await Promise.all([
            this.stateModel.findById(STATE_ID).lean(),
            this.blockModel.findOne({}, { index: 1 }).sort({ index: -1 }).lean(),
        ]);
        if (state?.index === undefined || state.index === null) return null;
        if ((tip?.index ?? 0) - state.index > this.maxLag()) return null;
        return { index: state.index, error: state.error };
    }

    async status(): Promise<Record<string, any>> {
        const [state, tip] = await Promise.all([
            this.stateModel.findById(STATE_ID).lean(),
            this.blockModel.findOne({}, { index: 1 }).sort({ index: -1 }).lean(),
        ]);
        const chainTip = tip?.index ?? -1;
        const indexedUpTo = state?.index ?? -1;
        return {
            status: state?.error ? 'error' : chainTip - indexedUpTo > this.maxLag() ? 'catching_up' : 'ok',
            indexedUpTo,
            chainTip,
            ...(state?.error ? { stalledAt: state.stalledAt, detail: state.error } : {}),
        };
    }

    async evidenceCounts(modelIds: string[], indexedUpTo: number) {
        const rows = await this.modelIndex.find({ modelId: { $in: modelIds } }, { modelId: 1, events: 1 }).lean();
        const counts: Record<string, number> = Object.fromEntries(modelIds.map(id => [id, 0]));
        for (const r of rows as any[]) counts[r.modelId] = r.events;
        return { counts, indexedUpTo };
    }

    async executionCounts(indexedUpTo: number) {
        const rows = await this.systemIndex.find({}, { aiSystemId: 1, executions: 1 }).lean();
        const counts: Record<string, number> = Object.fromEntries((rows as any[]).map(r => [r.aiSystemId, r.executions]));
        return { counts, sinceIndex: -1, upToIndex: indexedUpTo, indexedUpTo };
    }

    /**
     * mode=indexed: every block holding this model's evidence up to the indexed tip was
     * validated when it was connected. Fail-closed while the indexer is stopped at an invalid
     * block. Re-verifying now is `mode=full`.
     */
    async modelIntegrity(modelId: string, tip: { index: number; error?: string }) {
        const row: any = await this.modelIndex.findOne({ modelId }).lean();
        const errors: string[] = [];
        if (!row) errors.push(`No blocks found for model ${modelId}`);
        if (tip.error) errors.push(`Chain validation stopped: ${tip.error}`);
        const isValid = errors.length === 0;
        return {
            modelId,
            isValid,
            valid: isValid,
            totalBlocks: row?.events ?? 0,
            errors,
            mode: 'indexed' as const,
            verifiedUpTo: tip.index,
            lastBlockIndex: row?.lastBlockIndex,
        };
    }
}
