/*
 * AI Model Provenance & Auditing PoC
 * Copyright (c) 2025 Carlos Castro Martos
 * Licensed under the Apache License, Version 2.0 – see root LICENSE
 */

import { ConflictException, Injectable, OnModuleInit, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProvenanceBlock, ProvenanceBlockDocument } from './models/provenance-block.schema';
import * as crypto from 'crypto';
import MerkleTree from 'merkletreejs';
import keccak256 from 'keccak256';
import { ethers } from 'ethers';
import { rpcProvider } from './rpc-provider';
import { Anchor, AnchorDocument } from './models/anchor.schema';
import { IntegrityCheck, IntegrityCheckDocument } from './models/integrity-check.schema';
import { canonicalizeEx } from 'json-canonicalize';
import abiJson from '../abis/ErnestMerkleAnchor.json';
import { OtsClient } from './ots.client';
import { Rfc3161Client } from './rfc3161.client';
import { buildCycloneDxMlBom } from './cyclonedx';
import { EvidenceEvent, EvidenceEventDocument } from './models/evidence-event.schema';
import { leafHashOf, merkleRoot, TREE_ALG } from './merkle-rfc6962';
import { writesAllowed } from '../common/ernest-role';
import { provenanceTypeCondition } from './provenance-type';

const anchorAbi = abiJson.abi;
const MAX_APPEND_RETRIES = 5;

/** ADR-004: the evidence seq range this block would chain is already chained. */
export class EventRangeAlreadyChainedError extends Error {
    constructor(readonly eventSeq: number) {
        super(`Evidence seq ${eventSeq} is already chained`);
    }
}

type AnchorConfig = {
    rpcUrl: string;
    privateKey: string;
    contractAddress: string;
    organizationId: string;
    organizationName: string;
    domain: string;
};

@Injectable()
export class BlockchainService implements OnModuleInit {
    private readonly logger = new Logger(BlockchainService.name);

    constructor(
        @InjectModel(ProvenanceBlock.name)
        private provenanceBlockModel: Model<ProvenanceBlockDocument>,
        @InjectModel(Anchor.name)
        private anchorModel: Model<AnchorDocument>,
        private readonly otsClient: OtsClient,
        private readonly rfc3161Client: Rfc3161Client,
        // Last, so callers constructing the service positionally (tests) are unaffected.
        @InjectModel(IntegrityCheck.name)
        private integrityCheckModel: Model<IntegrityCheckDocument>,
        @InjectModel(EvidenceEvent.name)
        private evidenceEventModel?: Model<EvidenceEventDocument>,
    ) { }

    /**
     * ADR-002 B1: additively attach an RFC 3161 qualified timestamp to an anchor, over
     * the same Merkle root. Fail-soft on purpose -- a TSA outage must never block an
     * anchor that already succeeded via OTS/EVM, so failures are logged and alerted
     * (WEBHOOK_URL, qts.timestamp.failed) but never thrown.
     */
    private async attachQualifiedTimestamp(anchorId: any, merkleRoot: string): Promise<void> {
        if (!this.rfc3161Client?.enabled) return;
        try {
            const { token, tsaUrl, timestampedAt } = await this.rfc3161Client.timestamp(merkleRoot);
            await this.anchorModel.updateOne(
                { _id: anchorId },
                { $set: { qtsToken: token.toString('base64'), qtsTsaUrl: tsaUrl, qtsTimestampedAt: timestampedAt } },
            );
            this.logger.log(`Qualified RFC 3161 timestamp attached to anchor ${anchorId} (TSA ${tsaUrl})`);
        } catch (e: any) {
            this.logger.warn(`Qualified timestamp for anchor ${anchorId} failed (anchor stands regardless): ${e.message}`);
            await this.notifyQtsFailure(anchorId, merkleRoot, e.message);
        }
    }

    private async notifyQtsFailure(anchorId: any, merkleRoot: string, error: string): Promise<void> {
        const webhookUrl = process.env.WEBHOOK_URL;
        if (!webhookUrl) return;
        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: 'qts.timestamp.failed', anchorId: String(anchorId), merkleRoot, error, at: new Date().toISOString() }),
            });
        } catch (e: any) {
            this.logger.debug(`qts.timestamp.failed webhook post failed: ${e.message}`);
        }
    }

    async getQtsToken(anchorId: string): Promise<{ token: Buffer; anchor: any } | null> {
        const anchor = await this.anchorModel.findOne({ _id: anchorId }).lean();
        if (!anchor?.qtsToken) {
            return null;
        }
        return { token: Buffer.from(anchor.qtsToken, 'base64'), anchor };
    }

    /**
     * Which anchoring backend is active. 'ots' (OpenTimestamps on Bitcoin: free,
     * keyless, no crypto custody -- the production default recommendation) is chosen
     * explicitly via ANCHOR_PROVIDER=ots; otherwise 'evm' when the contract
     * configuration is present, or null when anchoring is disabled.
     */
    getAnchorProvider(): 'ots' | 'evm' | null {
        if ((process.env.ANCHOR_PROVIDER || '').toLowerCase() === 'ots') {
            return 'ots';
        }
        return this.getAnchorConfig(false) ? 'evm' : null;
    }

    async onModuleInit() {
        // A read replica never writes: indexes and genesis are created by writer/chainer.
        if (!writesAllowed()) return;
        await this.ensureIndexes();
        await this.createGenesisBlock();
    }

    /**
     * Creates the same named unique indexes as the Go event-writer's EnsureIndexes
     * (event-ingestor/internal/hashchain/writer.go). Whichever process starts first wins;
     * the other's identical create call is a no-op. On a database that predates this
     * coordination, an equivalent unique index may already exist under a different name
     * (e.g. Mongoose's autoIndex-generated "index_1") -- MongoDB rejects that as
     * IndexOptionsConflict/IndexKeySpecsConflict rather than treating it as satisfied, so
     * those two error codes are tolerated here: the existing index already enforces the
     * uniqueness we need, regardless of its name.
     */
    async ensureIndexes(): Promise<void> {
        // Created one at a time (not createIndexes([...])) so a conflict on one doesn't
        // abort the attempt to create the other -- MongoDB's createIndexes command stops
        // at the first error in the batch.
        await this.createIndexTolerant({ index: 1 }, 'unique_block_index');
        await this.createIndexTolerant({ hash: 1 }, 'unique_block_hash');
        // Read paths that used to scan the whole collection: per-model integrity and
        // provenance (data.modelId), and execution counts per AI system for drift checks.
        await this.createSecondaryIndex({ 'data.modelId': 1, index: 1 }, 'model_blocks');
        await this.createSecondaryIndex({ 'data.metadata.stage': 1, 'data.metadata.aiSystemId': 1, index: 1 }, 'stage_system_blocks');
        // ADR-004: one block per evidence seq range, whichever batcher leader gets there first.
        try {
            await this.provenanceBlockModel.collection.createIndex(
                { eventSeq: 1 },
                { unique: true, name: 'unique_event_seq', partialFilterExpression: { eventSeq: { $exists: true } } },
            );
        } catch (err) {
            if (err?.code !== 85 && err?.code !== 86) throw err;
        }
    }

    private async createSecondaryIndex(key: Record<string, 1 | -1>, name: string): Promise<void> {
        try {
            await this.provenanceBlockModel.collection.createIndex(key, { name });
        } catch (err) {
            if (err?.code === 85 || err?.code === 86) return; // an equivalent index already exists
            throw err;
        }
    }

    private async createIndexTolerant(key: Record<string, 1 | -1>, name: string): Promise<void> {
        try {
            await this.provenanceBlockModel.collection.createIndex(key, { unique: true, name });
        } catch (err) {
            if (err?.code === 85 || err?.code === 86) {
                this.logger.log(`Skipping index "${name}": equivalent index already exists (${err.codeName})`);
                return;
            }
            throw err;
        }
    }

    /**
     * Create genesis block if not exists
     */
    async createGenesisBlock(): Promise<void> {
        const exists = await this.provenanceBlockModel.findOne({ index: 0 });

        if (!exists) {
            const timestamp = Math.floor(Date.now() / 1000); //Unix timestamp in seconds

            const genesisBlock = {
                index: 0,
                timestamp: timestamp,
                data: {
                    type: 'model_registration' as const,
                    modelId: 'genesis',
                    metadata: { description: 'Genesis block for the Ernest hashchain' }
                },
                previousHash: '0',
                hash: '',
                //nonce: 0
            };

            genesisBlock.hash = this.calculateHash(genesisBlock);

            const result = await this.provenanceBlockModel.updateOne(
                { index: 0 },
                { $setOnInsert: genesisBlock },
                { upsert: true },
            );

            if (result.upsertedCount > 0) {
                this.logger.log(`Genesis block created at ${new Date(timestamp * 1000).toISOString()}`);
            }
        }
    }

    /**
     * Añadir nuevo bloque a la cadena
     */
    async addBlock(data: ProvenanceBlock['data'], opts: { eventSeq?: number } = {}): Promise<ProvenanceBlockDocument> {
        const cleanedData = this.cleanObject(data);

        for (let attempt = 1; attempt <= MAX_APPEND_RETRIES; attempt++) {
            const lastBlock = await this.provenanceBlockModel
                .findOne()
                .sort({ index: -1 })
                .lean();

            if (!lastBlock) {
                throw new Error('Chain not initialized. Genesis block missing.');
            }

            // Never below the previous block's timestamp: if the host clock jumps
            // backwards (NTP correction, restored VM), a block timestamped earlier than
            // its predecessor would look like tampering to an auditor even though the
            // chain is valid. Block index stays the authoritative order; this just keeps
            // timestamps consistent with it.
            const timestamp = Math.max(Math.floor(Date.now() / 1000), lastBlock.timestamp);
            const newBlock = {
                index: lastBlock.index + 1,
                timestamp,
                data: cleanedData,
                previousHash: lastBlock.hash,
                hash: '',
                ...(opts.eventSeq !== undefined ? { eventSeq: opts.eventSeq } : {}),
            };

            newBlock.hash = this.calculateHash(newBlock);

            try {
                const createdBlock = await this.provenanceBlockModel.create(newBlock);

                this.maybeAnchorNew().catch(e => this.logger.warn('Problem anchoring: ' + e.message));

                this.logger.log(`Block ${newBlock.index} added with hash: ${newBlock.hash}`);
                this.logger.debug(`Block data: ${JSON.stringify(cleanedData)}`);

                return createdBlock;
            } catch (error) {
                // Not an append race: another batcher leader already chained this range.
                if (this.isDuplicateKeyError(error) && error?.keyPattern?.eventSeq !== undefined) {
                    throw new EventRangeAlreadyChainedError(opts.eventSeq!);
                }
                if (this.isDuplicateKeyError(error) && attempt < MAX_APPEND_RETRIES) {
                    this.logger.warn(`Hashchain append race detected, retrying (${attempt}/${MAX_APPEND_RETRIES})`);
                    continue;
                }

                if (this.isDuplicateKeyError(error)) {
                    throw new ConflictException('Could not append block after concurrent writes. Please retry.');
                }

                throw error;
            }
        }

        throw new ConflictException('Could not append block after concurrent writes. Please retry.');
    }

    /**
     * Calculate SHA-256 hash
     */
    calculateHash(block: Partial<ProvenanceBlock>): string {
       // this.logger.debug(`Calculating hash for block raw data: ${JSON.stringify(block)}  `);
        const canonicalData = canonicalizeEx(block.data, { exclude: ['__v', '_id', 'createdAt', 'updatedAt', 'hash'] });
       // this.logger.debug(`Canonicalized block data: ${canonicalData}  `);

        //Timestamp es número, no necesita conversión
        const timestampString = block.timestamp.toString();

        //Limpiar campos undefined/null recursivamente
        //const cleanedData = this.cleanObject(block.data);
        //this.logger.debug(`Cleaned block data for hashing: ${JSON.stringify(cleanedData)}  `);
        //const sortedKeys = Object.keys(cleanedData).sort();
        //const dataString = JSON.stringify(cleanedData, sortedKeys);

        const blockString = [
            block.index,
            timestampString,
            canonicalData, //dataString,
            block.previousHash,
            // block.nonce
        ].join('|'); // Use explicit pipe separator
       // this.logger.debug(`Calculating hash for block string: ${blockString}`);
        return crypto.createHash('sha256').update(blockString).digest('hex');

    }

    /**
     * Verify hashchain integrity. Streams blocks with a cursor (constant memory, so a
     * million-block chain does not get materialized in RAM) and optionally verifies
     * only from `fromIndex` onwards -- the checkpointed mode used by the hourly
     * scheduled check. When fromIndex > 0 the block just before it is also fetched and
     * re-hashed so the first link is anchored to verified history.
     *
     * Returns the last verified index/hash so callers can persist a checkpoint.
     */
    async verifyChain(fromIndex = 0): Promise<{
        isValid: boolean;
        errors: string[];
        blocksVerified: number;
        lastVerifiedIndex: number | null;
        lastVerifiedHash: string | null;
    }> {
        const startAt = fromIndex > 0 ? fromIndex - 1 : 0;
        const cursor = this.provenanceBlockModel
            .find(startAt > 0 ? { index: { $gte: startAt } } : {})
            .sort({ index: 1 })
            .lean()
            .cursor();

        const errors: string[] = [];
        let previousBlock: any = null;
        let expectedIndex = startAt;
        let blocksVerified = 0;
        let lastVerifiedIndex: number | null = null;
        let lastVerifiedHash: string | null = null;

        for await (const currentBlock of cursor as any) {
            if (currentBlock.index !== expectedIndex) {
                errors.push(`Block ${currentBlock.index}: expected index ${expectedIndex} — chain is not contiguous`);
                expectedIndex = currentBlock.index; // resync so one gap doesn't cascade
            }
            expectedIndex += 1;

            const calculatedHash = this.calculateHash(currentBlock);
            if (currentBlock.hash !== calculatedHash) {
                errors.push(`Block ${currentBlock.index}: Hash mismatch`);
                this.logger.error(`Block ${currentBlock.index} hash mismatch: stored ${currentBlock.hash}, calculated ${calculatedHash}`);
            }

            if (previousBlock && currentBlock.previousHash !== previousBlock.hash) {
                errors.push(`Block ${currentBlock.index}: Hashchain broken ! (previousHash: ${currentBlock.previousHash.substring(0, 16)}..., expected: ${previousBlock.hash.substring(0, 16)}...)`);
            }

            if (currentBlock.data?.type === 'batch') {
                errors.push(...await this.verifyBatchBlock(currentBlock));
            }

            previousBlock = currentBlock;
            blocksVerified += 1;
            lastVerifiedIndex = currentBlock.index;
            lastVerifiedHash = currentBlock.hash;
        }

        return {
            isValid: errors.length === 0,
            errors,
            blocksVerified,
            lastVerifiedIndex,
            lastVerifiedHash,
        };
    }

    /**
     * ADR-004: a batch block commits to its events only through `data.root`. Re-derive the
     * root from the stored events -- each leaf recomputed from the event's data, not taken
     * from its stored leafHash -- so an edited event payload, a dropped or added event, or a
     * reordered batch all show up as errors against the (hash-chained) block.
     */
    async verifyBatchBlock(block: any): Promise<string[]> {
        const { firstSeq, lastSeq, size, root, treeAlg } = block.data;
        if (treeAlg !== TREE_ALG) return [`Block ${block.index}: unknown batch tree algorithm ${treeAlg}`];
        if (!this.evidenceEventModel) return [`Block ${block.index}: evidence event store unavailable`];
        const events = await this.evidenceEventModel
            .find({ seq: { $gte: firstSeq, $lte: lastSeq } })
            .sort({ seq: 1 })
            .lean();
        const errors: string[] = [];
        if (events.length !== size) {
            errors.push(`Block ${block.index}: batch declares ${size} events (seq ${firstSeq}..${lastSeq}), store has ${events.length}`);
        }
        const leaves: string[] = [];
        events.forEach((e: any, i: number) => {
            const leaf = leafHashOf(e.data);
            if (leaf !== e.leafHash) errors.push(`Event seq ${e.seq}: data does not match its leaf hash`);
            if (e.blockIndex !== undefined && (e.blockIndex !== block.index || e.leafIndex !== i)) {
                errors.push(`Event seq ${e.seq}: recorded at block ${e.blockIndex} leaf ${e.leafIndex}, expected block ${block.index} leaf ${i}`);
            }
            leaves.push(leaf);
        });
        if (merkleRoot(leaves) !== root) {
            errors.push(`Block ${block.index}: batch root does not match its events`);
        }
        return errors;
    }

    /**
     * Checkpoint this process has verified up to on behalf of API callers. In memory only:
     * a read endpoint never writes integrity records; the hourly scheduled check (and its
     * daily full scan) remains the source of persisted checkpoints.
     */
    private apiCheckpoint: { index: number; hash: string } | null = null;

    /**
     * Incremental chain verification for API callers: start from the newest trusted
     * checkpoint (this process's, or the scheduled check's persisted one), pin that block's
     * hash to what was verified then — so rewritten history before it still trips — and
     * verify only the blocks appended since. Cost grows with new blocks, not chain length;
     * a full re-scan stays available as `verifyChain()` (GET /api/verify?mode=full).
     */
    async verifyChainFromCheckpoint() {
        const persisted = await this.integrityCheckModel
            .findOne({ isValid: true, lastVerifiedIndex: { $gte: 0 } })
            .sort({ checkedAt: -1 })
            .lean();
        const candidates = [
            this.apiCheckpoint,
            persisted?.lastVerifiedHash ? { index: persisted.lastVerifiedIndex!, hash: persisted.lastVerifiedHash } : null,
        ].filter((c): c is { index: number; hash: string } => !!c);
        const checkpoint = candidates.sort((a, b) => b.index - a.index)[0];
        const chainLength = await this.provenanceBlockModel.estimatedDocumentCount();

        if (!checkpoint) {
            const full = await this.verifyChain();
            if (full.isValid && full.lastVerifiedIndex !== null) {
                this.apiCheckpoint = { index: full.lastVerifiedIndex, hash: full.lastVerifiedHash! };
            }
            return { ...full, mode: 'full' as const, fromIndex: 0, chainLength };
        }

        const errors: string[] = [];
        const pinned = await this.getBlockByIndex(checkpoint.index);
        if (!pinned) {
            errors.push(`Checkpoint block ${checkpoint.index} has disappeared`);
        } else if (pinned.hash !== checkpoint.hash) {
            errors.push(`Checkpoint mismatch at block ${checkpoint.index}: verified as ${checkpoint.hash}, now ${pinned.hash} — history before the checkpoint appears rewritten`);
        }
        const result = await this.verifyChain(checkpoint.index + 1);
        errors.push(...result.errors);
        const isValid = errors.length === 0;
        if (isValid && result.lastVerifiedIndex !== null) {
            this.apiCheckpoint = { index: result.lastVerifiedIndex, hash: result.lastVerifiedHash! };
        }
        return {
            ...result,
            isValid,
            errors,
            mode: 'incremental' as const,
            fromIndex: checkpoint.index + 1,
            chainLength,
        };
    }

    /**
     * Checks that the latest confirmed anchor's Merkle root is still reproducible from
     * the local chain. This is the only check with EXTERNAL teeth: the root lives on a
     * public chain, so a recompute-forward rewrite of anchored history cannot fool it
     * even if every local record (including checkpoints) was updated to match.
     */
    async verifyLatestAnchorRoot(): Promise<{ checked: boolean; ok: boolean; error?: string }> {
        const anchor = await this.anchorModel
            .findOne({ status: 'confirmed' })
            .sort({ lastBlockIndex: -1 })
            .lean();
        if (!anchor) {
            return { checked: false, ok: true };
        }
        try {
            const computedRoot = await this.getMerkleRoot(anchor.lastBlockIndex);
            if (computedRoot !== anchor.merkleRoot) {
                return {
                    checked: true,
                    ok: false,
                    error: `Anchored Merkle root ${anchor.merkleRoot} (blocks 0..${anchor.lastBlockIndex}, tx ${anchor.txHash}) is no longer reproducible: computed ${computedRoot}`,
                };
            }
            return { checked: true, ok: true };
        } catch (e: any) {
            return { checked: true, ok: false, error: `Anchor root check failed to run: ${e.message}` };
        }
    }

    /**
     * Get full provenance by modelId with optional filters
     */
    async getProvenance(modelId: string, filters?: { type?: string; from?: number; to?: number; organizationId?: string }) {
        const query: any = { 'data.modelId': modelId };

        if (filters?.type) {
            Object.assign(query, provenanceTypeCondition(filters.type, { type: 'data.type', stage: 'data.metadata.stage' }));
        }
        if (filters?.from || filters?.to) {
            query.timestamp = {};
            if (filters.from) query.timestamp.$gte = filters.from;
            if (filters.to) query.timestamp.$lte = filters.to;
        }
        if (filters?.organizationId) {
            query['data.organizationId'] = filters.organizationId;
        }

        const blocks = await this.provenanceBlockModel
            .find(query)
            .sort({ index: 1 })
            .lean();

        // Incremental from the trusted checkpoint: a provenance read must not re-hash the
        // whole chain (the full scan stays available as GET /api/verify?mode=full).
        const verification = await this.verifyChainFromCheckpoint();
        const events = await this.batchedEventHistory(modelId, filters);

        const blockHistory = blocks.map(b => ({
                blockIndex: b.index,
                timestamp: new Date(b.timestamp * 1000).toISOString(),
                timestampUnix: b.timestamp,
                type: b.data.type,
                modelId: b.data.modelId,
                modelName: b.data.modelName,
                version: b.data.version,
                modelHash: b.data.modelHash,
                gitCommit: b.data.gitCommit,
                inputHash: b.data.inputHash,
                outputHash: b.data.outputHash,
                params: b.data.params,
                metrics: b.data.metrics,
                metadata: b.data.metadata,
                organizationId: b.data.organizationId,
                blockHash: b.hash,
                previousHash: b.previousHash
            }));
        const history = [...blockHistory, ...events].sort((a: any, b: any) =>
            (a.blockIndex ?? Infinity) - (b.blockIndex ?? Infinity) || (a.leafIndex ?? 0) - (b.leafIndex ?? 0));

        return {
            modelId,
            totalBlocks: history.length,
            chainValid: verification.isValid,
            verificationErrors: verification.errors,
            history,
        };
    }

    /**
     * ADR-004: events that do not have a block of their own -- chained inside a batch
     * block, or not chained yet. Events chained one-per-block (EVIDENCE_BATCHING=events)
     * are excluded: the block itself already represents them.
     */
    private notOwnBlock(extra: Record<string, any> = {}): Record<string, any> {
        return { ...extra, $or: [{ state: { $ne: 'chained' } }, { 'chain.kind': 'batch' }] };
    }

    /**
     * Provenance entries for a model's batched and pending events, in the same shape as
     * block entries (the batch block's index/timestamp/hash) plus seq, leafIndex and a
     * proof URL. Pending events carry no block fields and sort last.
     */
    private async batchedEventHistory(modelId: string, filters?: { type?: string; from?: number; to?: number; organizationId?: string }) {
        if (!this.evidenceEventModel) return [];
        const query: any = this.notOwnBlock({ modelId });
        // notOwnBlock() already uses $or, so the type condition joins it under $and.
        if (filters?.type) query.$and = [provenanceTypeCondition(filters.type, { type: 'type', stage: 'data.metadata.stage' })];
        if (filters?.organizationId) query['data.organizationId'] = filters.organizationId;
        const events = await this.evidenceEventModel.find(query).sort({ seq: 1 }).lean();
        if (events.length === 0) return [];

        const blockIndexes = [...new Set(events.map((e: any) => e.blockIndex).filter((i: any) => i !== undefined))];
        const blocks = await this.provenanceBlockModel
            .find({ index: { $in: blockIndexes } }, { index: 1, timestamp: 1, hash: 1, previousHash: 1 })
            .lean();
        const byIndex = new Map(blocks.map((b: any) => [b.index, b]));

        return events
            .map((e: any) => {
                const block: any = e.state === 'chained' ? byIndex.get(e.blockIndex) : undefined;
                const d = e.data;
                return {
                    blockIndex: block?.index,
                    timestamp: block ? new Date(block.timestamp * 1000).toISOString() : undefined,
                    timestampUnix: block?.timestamp,
                    type: d.type,
                    modelId: d.modelId,
                    modelName: d.modelName,
                    version: d.version,
                    modelHash: d.modelHash,
                    gitCommit: d.gitCommit,
                    inputHash: d.inputHash,
                    outputHash: d.outputHash,
                    params: d.params,
                    metrics: d.metrics,
                    metadata: d.metadata,
                    organizationId: d.organizationId,
                    blockHash: block?.hash,
                    previousHash: block?.previousHash,
                    status: block ? 'chained' : 'pending',
                    seq: e.seq,
                    leafIndex: block ? e.leafIndex : undefined,
                    leafHash: e.leafHash,
                    proofUrl: `/api/events/${encodeURIComponent(e.source)}/${encodeURIComponent(e.eventId)}/proof`,
                };
            })
            .filter((h: any) => {
                if (!filters?.from && !filters?.to) return true;
                if (h.timestampUnix === undefined) return false;
                return (!filters.from || h.timestampUnix >= filters.from) && (!filters.to || h.timestampUnix <= filters.to);
            });
    }

    /**
     * Get hashchain statistics 
     */
    async getChainStats() {
        // Incremental verification and an O(1) count: a dashboard poll must not re-hash
        // the whole chain (see verifyChainFromCheckpoint).
        const totalBlocks = await this.provenanceBlockModel.estimatedDocumentCount();
        const lastBlock = await this.provenanceBlockModel.findOne().sort({ index: -1 }).lean();
        const verification = await this.verifyChainFromCheckpoint();
        const modelIds = new Set<string>(await this.provenanceBlockModel.distinct('data.modelId'));
        if (this.evidenceEventModel) {
            for (const id of await this.evidenceEventModel.distinct('modelId')) modelIds.add(id);
        }
        // Batch blocks carry no modelId; distinct reports that as null.
        const modelCount = [...modelIds].filter(id => id !== null && id !== undefined);
        const lastAnchor = await this.anchorModel.findOne().sort({ lastBlockIndex: -1 }).lean();

        return {
            totalBlocks,
            totalModels: modelCount.length - 1, // -1 genesis
            lastBlockIndex: lastBlock?.index || 0,
            lastBlockHash: lastBlock?.hash || '',
            lastBlockTimestamp: lastBlock ? new Date(lastBlock.timestamp * 1000).toISOString() : null,
            lastBlockTimestampUnix: lastBlock?.timestamp || 0,
            chainValid: verification.isValid,
            verificationErrors: verification.errors,
            lastAnchor: lastAnchor ? {
                provider: lastAnchor.provider ?? 'evm',
                merkleRoot: lastAnchor.merkleRoot,
                lastBlockIndex: lastAnchor.lastBlockIndex,
                organizationId: lastAnchor.organizationId,
                organizationName: lastAnchor.organizationName,
                domain: lastAnchor.domain,
                anchoredAt: lastAnchor.anchoredAt,
                confirmedAt: lastAnchor.confirmedAt,
                status: lastAnchor.status,
                // EVM-specific
                txHash: lastAnchor.txHash || undefined,
                blockNumber: lastAnchor.blockNumber,
                chainId: lastAnchor.chainId,
                contractAddress: lastAnchor.contractAddress,
                etherscanUrl: lastAnchor.txHash
                    ? `https://sepolia.etherscan.io/tx/${lastAnchor.txHash}`
                    : undefined,
                // OTS-specific
                bitcoinBlockHeight: lastAnchor.bitcoinBlockHeight,
                otsProofUrl: lastAnchor.provider === 'ots'
                    ? `/api/anchors/${lastAnchor._id}/ots`
                    : undefined,
                qtsTokenUrl: lastAnchor.qtsToken
                    ? `/api/anchors/${lastAnchor._id}/tst`
                    : undefined,
                qtsTsaUrl: lastAnchor.qtsTsaUrl,
                qtsTimestampedAt: lastAnchor.qtsTimestampedAt,
                otsRawUrl: lastAnchor.provider === 'ots'
                    ? `/api/anchors/${lastAnchor._id}/ots/raw`
                    : undefined,
            } : null
        };
    }

    /**
     * Register a new IA model
     */
    async registerModel(
        modelId: string,
        modelName: string,
        version: string,
        modelHash: string,
        gitCommit: string,
        params?: Record<string, any>,
        metrics?: Record<string, any>,
        metadata?: Record<string, any>,
        organizationId?: string,
        signature?: Record<string, any>,
    ) {
        return await this.addBlock(this.registrationData(modelId, modelName, version, modelHash, gitCommit, params, metrics, metadata, organizationId, signature));
    }

    /** Block data of a model registration (shared with the ADR-004 event path). */
    registrationData(
        modelId: string,
        modelName: string,
        version: string,
        modelHash: string,
        gitCommit: string,
        params?: Record<string, any>,
        metrics?: Record<string, any>,
        metadata?: Record<string, any>,
        organizationId?: string,
        signature?: Record<string, any>,
    ): ProvenanceBlock['data'] {
        return {
            type: 'model_registration',
            modelId,
            modelName,
            version,
            modelHash,
            gitCommit,
            params,
            metrics,
            metadata,
            organizationId,
            // ADR-001: embedded so receipts/exports verify authorship offline.
            signature,
        };
    }

    /**
     * True once the model's registration block is committed to the chain. Used by
     * ApiService.logInference to keep inference blocks causally after their model's
     * registration block: the AIModel document alone isn't enough, since it is created
     * just before the registration block is appended (see ApiService.registerModel).
     */
    async hasRegistrationBlock(modelId: string): Promise<boolean> {
        const found = await this.provenanceBlockModel.exists({
            'data.type': 'model_registration',
            'data.modelId': modelId,
        });
        return !!found;
    }

    /**
     * Register inference
     */
    async logInference(
        modelId: string,
        inferenceId: string,
        inputHash: string,
        outputHash: string,
        params: Record<string, any>,
        metadata: Record<string, any>,
        signature?: Record<string, any>,
    ) {
        return await this.addBlock(this.inferenceData(modelId, inferenceId, inputHash, outputHash, params, metadata, signature));
    }

    /** Block data of an inference (shared with the ADR-004 event path). */
    inferenceData(
        modelId: string,
        inferenceId: string,
        inputHash: string,
        outputHash: string,
        params: Record<string, any>,
        metadata: Record<string, any>,
        signature?: Record<string, any>,
    ): ProvenanceBlock['data'] {
        return {
            type: 'inference',
            modelId,
            inferenceId,
            inputHash,
            outputHash,
            params,
            metadata,
            // executedAt is server-augmented: excluded from the signed bytes by ADR-001.
            executedAt: new Date().toISOString(),
            signature,
        };
    }

    /**
     * Evidence blocks per model id, for several models in one indexed aggregation (the
     * model_blocks index). Chain integrity is established by verifyChain/
     * verifyChainFromCheckpoint over every block; callers that only need "does this model
     * have evidence, and how much" use this instead of per-model integrity, which re-hashes
     * all of that model's blocks. Ids with no blocks are reported with 0.
     */
    async evidenceCountsByModel(modelIds: string[]): Promise<{ counts: Record<string, number> }> {
        const rows = await this.provenanceBlockModel.aggregate([
            { $match: { 'data.modelId': { $in: modelIds } } },
            { $group: { _id: '$data.modelId', count: { $sum: 1 } } },
        ]);
        const counts: Record<string, number> = Object.fromEntries(modelIds.map(id => [id, 0]));
        for (const r of rows) counts[r._id] = r.count;
        if (this.evidenceEventModel) {
            const eventRows = await this.evidenceEventModel.aggregate([
                { $match: this.notOwnBlock({ modelId: { $in: modelIds } }) },
                { $group: { _id: '$modelId', count: { $sum: 1 } } },
            ]);
            for (const r of eventRows) counts[r._id] = (counts[r._id] ?? 0) + r.count;
        }
        return { counts };
    }

    /**
     * Execution evidence per AI system, counted server-side over the stage_system_blocks
     * index. Bounded to the current tip so a caller can resume incrementally from
     * `upToIndex` next time (`since` is exclusive). Replaces paging the whole chain.
     */
    async executionCountsBySystem(sinceIndex = -1): Promise<{ counts: Record<string, number>; lastExecutionAt: Record<string, string>; sinceIndex: number; upToIndex: number }> {
        const tip = await this.provenanceBlockModel.findOne({}, { index: 1 }).sort({ index: -1 }).lean();
        const upToIndex = tip?.index ?? 0;
        const rows = await this.provenanceBlockModel.aggregate([
            { $match: {
                'data.metadata.stage': 'execution',
                'data.metadata.aiSystemId': { $type: 'string', $ne: '' },
                index: { $gt: sinceIndex, $lte: upToIndex },
            } },
            { $group: {
                _id: '$data.metadata.aiSystemId',
                count: { $sum: 1 },
                // The event's stated time when it parses as a date, else the block's own time.
                last: { $max: { $convert: { input: '$data.occurredAt', to: 'date', onError: { $toDate: '$timestamp' }, onNull: { $toDate: '$timestamp' } } } },
            } },
        ]);
        const counts: Record<string, number> = Object.fromEntries(rows.map((r: any) => [r._id, r.count]));
        const latest: Record<string, Date> = {};
        const keepLatest = (id: string, last: unknown) => {
            if (!last) return;
            const t = new Date(last as any);
            if (!Number.isNaN(t.getTime()) && (!latest[id] || t > latest[id])) latest[id] = t;
        };
        for (const r of rows as any[]) keepLatest(r._id, r.last);
        if (this.evidenceEventModel) {
            // Batched executions count by their batch block's index, so the same
            // (since, upTo] window stays exact; pending ones are counted once chained.
            const eventRows = await this.evidenceEventModel.aggregate([
                { $match: {
                    'chain.kind': 'batch',
                    state: 'chained',
                    'data.metadata.stage': 'execution',
                    'data.metadata.aiSystemId': { $type: 'string', $ne: '' },
                    blockIndex: { $gt: sinceIndex, $lte: upToIndex },
                } },
                { $group: {
                    _id: '$data.metadata.aiSystemId',
                    count: { $sum: 1 },
                    last: { $max: { $convert: { input: '$data.occurredAt', to: 'date', onError: '$createdAt', onNull: '$createdAt' } } },
                } },
            ]);
            for (const r of eventRows as any[]) {
                counts[r._id] = (counts[r._id] ?? 0) + r.count;
                keepLatest(r._id, r.last);
            }
        }
        const lastExecutionAt = Object.fromEntries(Object.entries(latest).map(([id, t]) => [id, t.toISOString()]));
        return { counts, lastExecutionAt, sinceIndex, upToIndex };
    }

    /**
     * Get all blocks (paginated)
     */
    async getAllBlocks(page = 1, limit = 20, after?: number, order: 'asc' | 'desc' = 'asc'): Promise<any> {
        if (after !== undefined) {
            // Keyset pagination over the unique index: constant cost per page at any depth,
            // unlike skip(), which walks every earlier block.
            const items = await this.provenanceBlockModel.find({ index: { $gt: after } }).sort({ index: 1 }).limit(limit).lean();
            const total = await this.provenanceBlockModel.estimatedDocumentCount();
            const nextAfter = items.length === limit ? items[items.length - 1].index : null;
            return { items, total, limit, after, nextAfter };
        }
        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.provenanceBlockModel.find().sort({ index: order === 'desc' ? -1 : 1 }).skip(skip).limit(limit).lean(),
            this.provenanceBlockModel.countDocuments(),
        ]);
        return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    /**
     * Full chain as an offline-audit bundle: download it, hand it to an auditor, and
     * the CLI can verify it (ernest hashchain verify --file chain.json) with no access
     * to the API or the database. Returns a Mongo cursor so the controller can stream
     * the JSON out with constant memory -- the chain is never materialized in RAM,
     * which is what makes the export viable at 10^6 blocks.
     */
    async exportAllBlocksCursor(): Promise<{ exportedAt: string; totalBlocks: number; cursor: AsyncIterable<any> }> {
        const totalBlocks = await this.provenanceBlockModel.countDocuments();
        const cursor = this.provenanceBlockModel
            .find()
            .sort({ index: 1 })
            .select('-_id -__v -createdAt -updatedAt')
            .lean()
            .cursor();
        return { exportedAt: new Date().toISOString(), totalBlocks, cursor };
    }

    /**
     * Export provenance for a model as a signed JSON bundle
     */
    async exportProvenance(modelId: string): Promise<{ bundle: object; signature: string; algorithm: string }> {
        const provenance = await this.getProvenance(modelId);

        const bundle = {
            exportedAt: new Date().toISOString(),
            generator: 'ernest-api',
            ...provenance,
        };

        const secret = process.env.ERNEST_API_KEY || '';
        const signature = crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(bundle))
            .digest('hex');

        return { bundle, signature, algorithm: 'hmac-sha256' };
    }

    /**
     * Export provenance for a model as a CycloneDX 1.6 BOM with an AI/ML-BOM
     * `machine-learning-model` component, so the evidence can be read by tools that
     * already speak CycloneDX (dependency-track, GUAC, etc.) without any Ernest-specific
     * integration.
     */
    async exportProvenanceCycloneDx(modelId: string, verificationUrl?: string): Promise<Record<string, any>> {
        const provenance = await this.getProvenance(modelId);
        return buildCycloneDxMlBom(provenance, { verificationUrl });
    }

    /**
     * Verify integrity only for blocks belonging to a specific model
     */
    async verifyModelIntegrity(modelId: string): Promise<{ modelId: string; isValid: boolean; valid: boolean; totalBlocks: number; errors: string[] }> {
        // Streamed over the model_blocks index (constant memory), with each chunk's links to
        // the previous global block checked in ONE query instead of one query per block.
        const cursor = this.provenanceBlockModel
            .find({ 'data.modelId': modelId })
            .sort({ index: 1 })
            .lean()
            .cursor();

        const errors: string[] = [];
        let totalBlocks = 0;
        let chunk: any[] = [];
        const checkChunk = async () => {
            if (chunk.length === 0) return;
            const previous = await this.provenanceBlockModel
                .find({ index: { $in: chunk.map(b => b.index - 1) } }, { index: 1, hash: 1 })
                .lean();
            const hashByIndex = new Map(previous.map((p: any) => [p.index, p.hash]));
            for (const block of chunk) {
                if (block.hash !== this.calculateHash(block)) {
                    errors.push(`Block ${block.index}: hash mismatch`);
                }
                const prevHash = hashByIndex.get(block.index - 1);
                if (prevHash !== undefined && block.previousHash !== prevHash) {
                    errors.push(`Block ${block.index}: broken link to previous block ${block.index - 1}`);
                }
            }
            chunk = [];
        };
        for await (const block of cursor as any) {
            totalBlocks += 1;
            chunk.push(block);
            if (chunk.length >= 1000) await checkChunk();
        }
        await checkChunk();

        // ADR-004: the model's batched events. Each leaf is recomputed from the event data,
        // and each batch block they belong to has its root re-derived once.
        let totalEvents = 0;
        if (this.evidenceEventModel) {
            const eventCursor = this.evidenceEventModel
                .find({ modelId, 'chain.kind': 'batch', state: 'chained' })
                .sort({ seq: 1 })
                .lean()
                .cursor();
            const checkedBatches = new Set<number>();
            for await (const e of eventCursor as any) {
                totalEvents += 1;
                if (leafHashOf(e.data) !== e.leafHash) {
                    errors.push(`Event seq ${e.seq}: data does not match its leaf hash`);
                }
                if (!checkedBatches.has(e.blockIndex)) {
                    checkedBatches.add(e.blockIndex);
                    const block = await this.getBlockByIndex(e.blockIndex);
                    if (!block || block.data?.type !== 'batch') {
                        errors.push(`Event seq ${e.seq}: batch block ${e.blockIndex} is missing`);
                    } else {
                        const hashOk = block.hash === this.calculateHash(block);
                        if (!hashOk) errors.push(`Block ${block.index}: hash mismatch`);
                        errors.push(...await this.verifyBatchBlock(block));
                    }
                }
            }
        }

        totalBlocks += totalEvents;
        if (totalBlocks === 0) {
            return { modelId, isValid: false, valid: false, totalBlocks: 0, errors: [`No blocks found for model ${modelId}`] };
        }
        const isValid = errors.length === 0;
        return { modelId, isValid, valid: isValid, totalBlocks, errors };
    }

    /** ADR-004: the block chaining the evidence seq range that starts at `eventSeq`. */
    async getBlockByEventSeq(eventSeq: number): Promise<any | null> {
        return await this.provenanceBlockModel.findOne({ eventSeq }).lean();
    }

    /**
     * Get block by index
    */
    async getBlockByIndex(index: number): Promise<any | null> {
        return await this.provenanceBlockModel
            .findOne({ index })
            .lean();
    }

    /**
     * Merkle tree over block hashes 0..upToIndex (inclusive), in index order.
     * This exact construction (keccak256, sortPairs) is the anchoring contract:
     * proofs handed to auditors are only verifiable if the tree can be rebuilt
     * deterministically for the range an anchor recorded.
     */
    private async buildMerkleTree(upToIndex?: number): Promise<MerkleTree> {
        const filter = upToIndex !== undefined ? { index: { $lte: upToIndex } } : {};
        const blocks = await this.provenanceBlockModel.find(filter).sort({ index: 1 }).lean();
        if (blocks.length === 0) {
            throw new Error('No blocks found');
        }
        if (upToIndex !== undefined && blocks.length !== upToIndex + 1) {
            throw new Error(`Chain is not contiguous up to index ${upToIndex}: found ${blocks.length} blocks`);
        }
        const leaves = blocks.map(b => Buffer.from(b.hash.replace(/^0x/, ''), 'hex'));
        return new MerkleTree(leaves, keccak256, { sortPairs: true });
    }

    /**
     * Calcule Merkle root for the hashchain. Bounded to upToIndex when given, so an
     * anchor's stored root always matches the lastBlockIndex it records even if new
     * blocks land while the anchor transaction is in flight.
     */
    async getMerkleRoot(upToIndex?: number): Promise<string> {
        const tree = await this.buildMerkleTree(upToIndex);
        return '0x' + tree.getRoot().toString('hex');
    }

    /**
     * SPV-style inclusion proof: connects one block to the Merkle root recorded by the
     * earliest confirmed anchor covering it. The receipt is self-contained evidence --
     * with the anchor transaction on the public chain, anyone can verify the block
     * existed before the anchor time without access to Ernest or its database.
     */
    async getBlockProof(index: number): Promise<any> {
        const block = await this.provenanceBlockModel.findOne({ index }).lean();
        if (!block) {
            return null;
        }

        const anchor = await this.anchorModel
            .findOne({ lastBlockIndex: { $gte: index }, status: 'confirmed' })
            .sort({ lastBlockIndex: 1 })
            .lean();
        if (!anchor) {
            throw new ConflictException(
                `Block ${index} is not covered by a confirmed anchor yet; inclusion receipts exist only for anchored history.`,
            );
        }

        const tree = await this.buildMerkleTree(anchor.lastBlockIndex);
        const computedRoot = '0x' + tree.getRoot().toString('hex');
        if (computedRoot !== anchor.merkleRoot) {
            // The local chain can no longer reproduce the anchored root: either the
            // pre-anchor history was rewritten, or the anchor record is corrupt.
            // Refusing to emit a receipt IS the tamper evidence here.
            throw new ConflictException(
                `Local chain does not reproduce anchored Merkle root ${anchor.merkleRoot} (computed ${computedRoot}). ` +
                'History covered by this anchor appears to have been modified.',
            );
        }

        const leaf = Buffer.from(block.hash.replace(/^0x/, ''), 'hex');
        const proof = tree.getProof(leaf).map(p => '0x' + p.data.toString('hex'));

        return {
            block: {
                index: block.index,
                timestamp: block.timestamp,
                data: block.data,
                previousHash: block.previousHash,
                hash: block.hash,
            },
            proof,
            merkleRoot: anchor.merkleRoot,
            hashAlgorithm: 'keccak256',
            pairSorting: 'sorted',
            anchor: {
                provider: anchor.provider ?? 'evm',
                txHash: anchor.txHash,
                blockNumber: anchor.blockNumber,
                chainId: anchor.chainId,
                contractAddress: anchor.contractAddress,
                organizationId: anchor.organizationId,
                lastBlockIndex: anchor.lastBlockIndex,
                anchoredAt: anchor.anchoredAt,
                ...(anchor.provider === 'ots'
                    ? {
                        bitcoinBlockHeight: anchor.bitcoinBlockHeight,
                        // The .ots proof + raw root complete the chain of trust offline:
                        //   ots verify -f ernest-anchor-<id> ernest-anchor-<id>.ots
                        otsProofUrl: `/api/anchors/${anchor._id}/ots`,
                        otsRawUrl: `/api/anchors/${anchor._id}/ots/raw`,
                    }
                    : {}),
                ...(anchor.qtsToken
                    ? { qtsTokenUrl: `/api/anchors/${anchor._id}/tst`, qtsTsaUrl: anchor.qtsTsaUrl }
                    : {}),
            },
            generatedAt: new Date().toISOString(),
        };
    }


    /**
    * Get last anchor
    */
    async getLastAnchor(): Promise<any | null> {
        const anchor = await this.anchorModel.findOne().sort({ lastBlockIndex: -1 }).lean();
        if (!anchor) {
            return null;
        }
        return anchor;
    }

    /**
     * Check last anchor and decides to anchor a new one
     */
    async maybeAnchorNew() {
        // Called after every append. Without this guard, a burst of appends made many
        // concurrent calls all see "enough new blocks" before the first anchor was stored,
        // each sending its own anchor transaction (duplicate on-chain cost, nonce clashes,
        // and a request flood against the RPC provider).
        if (this.anchorInFlight) {
            return { anchored: false, reason: 'Anchoring already in progress.' };
        }
        const provider = this.getAnchorProvider();
        if (!provider) {
            return { anchored: false, reason: 'Anchoring is not configured.' };
        }

        // 1. Get last anchor
        const lastAnchor = await this.getLastAnchor();
        const lastBlockAnclado = lastAnchor?.lastBlockIndex ?? -1;

        // 2. Get last block
        const lastBlock = await this.provenanceBlockModel.findOne().sort({ index: -1 }).lean();
        if (!lastBlock) {
            return { anchored: false, reason: 'No blocks yet.' };
        }

        const anchorEveryNBlocks = this.getAnchorEveryNBlocks();
        const newBlocks = lastBlock.index - lastBlockAnclado;

        // 3. Check difference between last block index and last block anchored
        if (newBlocks < anchorEveryNBlocks) {
            return { anchored: false, reason: `Not enough new blocks (${newBlocks}), wait for ${anchorEveryNBlocks}.` };
        }

        try {
            return provider === 'ots'
                ? await this.anchorMerkleRootToOts()
                : await this.anchorMerkleRootToEthereum();
        } catch (e) {
            // Another append won the race to start the anchor: nothing to do.
            if (e instanceof ConflictException) return { anchored: false, reason: 'Anchoring already in progress.' };
            throw e;
        }
    }

    /**
     * Anchor via OpenTimestamps: stamp the Merkle root against the public calendar
     * servers. The proof starts PENDING (a calendar promise); the scheduled
     * upgrade cycle completes it once the calendars aggregate into a mined Bitcoin
     * block (typically hours). No wallet, no keys, no cost.
     */
    /** Anchors run one at a time per process; a second request while one is in flight is refused. */
    private anchorInFlight = false;

    private async exclusiveAnchor<T>(run: () => Promise<T>): Promise<T> {
        if (this.anchorInFlight) {
            throw new ConflictException('An anchor is already in progress; retry once it completes.');
        }
        this.anchorInFlight = true;
        try {
            return await run();
        } finally {
            this.anchorInFlight = false;
        }
    }

    async anchorMerkleRootToOts(): Promise<any> {
        return this.exclusiveAnchor(() => this.doAnchorMerkleRootToOts());
    }

    async anchorMerkleRootToEthereum(): Promise<any> {
        return this.exclusiveAnchor(() => this.doAnchorMerkleRootToEthereum());
    }

    private async doAnchorMerkleRootToOts(): Promise<any> {
        const lastBlock = await this.provenanceBlockModel.findOne().sort({ index: -1 }).lean();
        if (!lastBlock) {
            throw new Error('No blocks found to anchor');
        }

        const merkleRoot = await this.getMerkleRoot(lastBlock.index);
        const otsProof = await this.otsClient.stamp(merkleRoot);

        const anchor = await this.anchorModel.create({
            merkleRoot,
            provider: 'ots',
            otsProof,
            txHash: '',
            organizationId: process.env.ANCHOR_ORGANIZATION_ID || 'ernest-demo',
            organizationName: process.env.ANCHOR_ORGANIZATION_NAME || 'Ernest Demo',
            domain: process.env.ANCHOR_DOMAIN || 'ai-provenance',
            lastBlockIndex: lastBlock.index,
            anchoredAt: new Date(),
            status: 'pending',
        });

        this.logger.log(`OTS anchor created (pending) for blocks 0..${lastBlock.index}, root ${merkleRoot}`);
        await this.attachQualifiedTimestamp(anchor._id, merkleRoot);
        return {
            anchored: true,
            provider: 'ots',
            merkleRoot,
            lastBlockIndex: lastBlock.index,
            status: anchor.status,
            otsProofUrl: `/api/anchors/${anchor._id}/ots`,
        };
    }

    /**
     * Upgrade cycle for pending OTS anchors: asks the calendars whether the proof
     * has been aggregated into Bitcoin yet. Called by the scheduler; a proof that
     * completes gets status 'confirmed' plus the attested block height. An OTS
     * anchor is 'confirmed' in the receipt sense once that attestation exists --
     * anyone can verify the upgraded proof offline with the official `ots` client.
     */
    async upgradePendingOtsAnchors(): Promise<{ upgraded: number; pending: number }> {
        const pending = await this.anchorModel.find({ provider: 'ots', status: 'pending' }).lean();
        let upgraded = 0;
        for (const anchor of pending) {
            try {
                const result = await this.otsClient.upgrade(anchor.otsProof!);
                if (result.complete) {
                    await this.anchorModel.updateOne(
                        { _id: anchor._id },
                        {
                            $set: {
                                otsProof: result.proofBase64,
                                bitcoinBlockHeight: result.bitcoinBlockHeight,
                                status: 'confirmed',
                                confirmedAt: new Date(),
                            },
                        },
                    );
                    upgraded += 1;
                    this.logger.log(`OTS anchor ${anchor._id} confirmed in Bitcoin block ${result.bitcoinBlockHeight}`);
                } else if (result.proofBase64 !== anchor.otsProof) {
                    // Partial upgrade (new calendar data, no Bitcoin attestation yet).
                    await this.anchorModel.updateOne({ _id: anchor._id }, { $set: { otsProof: result.proofBase64 } });
                }
            } catch (e: any) {
                this.logger.warn(`OTS upgrade for anchor ${anchor._id} failed: ${e.message}`);
            }
        }
        return { upgraded, pending: pending.length - upgraded };
    }

    /** Raw .ots proof bytes for offline verification with the official tooling. */
    async getOtsProof(anchorId: string): Promise<{ proof: Buffer; anchor: any } | null> {
        const anchor = await this.anchorModel.findOne({ _id: anchorId, provider: 'ots' }).lean();
        if (!anchor?.otsProof) {
            return null;
        }
        return { proof: Buffer.from(anchor.otsProof, 'base64'), anchor };
    }

    /**
     * Anchor Merkle root in Ethereum testnet
     */
    private async doAnchorMerkleRootToEthereum(): Promise<any> {
        const config = this.getAnchorConfig(true)!;
        const lastBlock = await this.provenanceBlockModel.findOne().sort({ index: -1 }).lean();
        if (!lastBlock) {
            throw new Error('No blocks found to anchor');
        }

        // Bounded to lastBlock.index: without it, a block appended while the anchor
        // transaction is in flight would make the stored root cover more blocks than
        // lastBlockIndex records, and no inclusion proof could ever reproduce it.
        const merkleRoot = await this.getMerkleRoot(lastBlock.index);
        const provider = rpcProvider(config.rpcUrl);
        const wallet = new ethers.Wallet(config.privateKey, provider);
        const contract = new ethers.Contract(config.contractAddress, anchorAbi, wallet);

        const tx = await contract.anchorRoot(
            merkleRoot,
            config.organizationId,
            config.organizationName,
            config.domain,
        );

        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error(`Anchor transaction ${tx.hash} was submitted but no receipt was returned`);
        }

        const network = await provider.getNetwork();

        const anchor = await this.anchorModel.create({
            merkleRoot,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            chainId: Number(network.chainId),
            contractAddress: config.contractAddress,
            walletAddress: wallet.address,
            organizationId: config.organizationId,
            organizationName: config.organizationName,
            domain: config.domain,
            lastBlockIndex: lastBlock.index,
            anchoredAt: new Date(),
            confirmedAt: new Date(),
            status: 'confirmed',
        });

        await this.attachQualifiedTimestamp(anchor._id, merkleRoot);
        return {
            anchored: true,
            merkleRoot,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            chainId: Number(network.chainId),
            contractAddress: config.contractAddress,
            organizationId: config.organizationId,
            organizationName: config.organizationName,
            domain: config.domain,
            lastBlockIndex: lastBlock.index,
            status: anchor.status,
        };
    }

    async getAnchorStatus(): Promise<any> {
        const config = this.getAnchorConfig(false);
        const lastAnchor = await this.getLastAnchor();

        if (this.getAnchorProvider() === 'ots') {
            const [pendingOts, confirmedOts] = await Promise.all([
                this.anchorModel.countDocuments({ provider: 'ots', status: 'pending' }),
                this.anchorModel.countDocuments({ provider: 'ots', status: 'confirmed' }),
            ]);
            return {
                configured: true,
                mode: 'ots',
                reason: 'OpenTimestamps anchoring: free, keyless Bitcoin attestation via public calendar servers.',
                pendingProofs: pendingOts,
                confirmedProofs: confirmedOts,
                everyNBlocks: this.getAnchorEveryNBlocks(),
                lastAnchor,
            };
        }

        if (!config) {
            return {
                configured: false,
                mode: 'disabled',
                reason: 'Set INFURA_URL, PRIVATE_KEY and CONTRACT_ADDRESS for contract anchoring, or ANCHOR_PROVIDER=ots for keyless OpenTimestamps anchoring.',
                lastAnchor,
            };
        }

        let chainId: number | null = null;
        let latestBlock: number | null = null;
        let reachable = false;
        let error: string | undefined;

        try {
            const provider = rpcProvider(config.rpcUrl);
            const [network, blockNumber] = await Promise.all([
                provider.getNetwork(),
                provider.getBlockNumber(),
            ]);
            chainId = Number(network.chainId);
            latestBlock = blockNumber;
            reachable = true;
        } catch (e: any) {
            error = e?.message ?? 'Unknown RPC error';
        }

        return {
            configured: true,
            mode: this.getAnchorMode(config.rpcUrl),
            reachable,
            rpcUrl: this.redactRpcUrl(config.rpcUrl),
            contractAddress: config.contractAddress,
            organizationId: config.organizationId,
            organizationName: config.organizationName,
            domain: config.domain,
            chainId,
            latestBlock,
            everyNBlocks: this.getAnchorEveryNBlocks(),
            lastAnchor,
            error,
        };
    }

    private getAnchorEveryNBlocks(): number {
        const raw = process.env.ANCHOR_EVERY_N_BLOCKS || '50';
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
    }

    private getAnchorConfig(required: boolean): AnchorConfig | null {
        const rpcUrl = process.env.INFURA_URL;
        const privateKey = process.env.PRIVATE_KEY;
        const contractAddress = process.env.CONTRACT_ADDRESS;

        if (!rpcUrl || !privateKey || !contractAddress) {
            if (required) {
                throw new ServiceUnavailableException('Ethereum anchoring is not configured. Set INFURA_URL, PRIVATE_KEY and CONTRACT_ADDRESS.');
            }
            return null;
        }

        return {
            rpcUrl,
            privateKey,
            contractAddress,
            organizationId: process.env.ANCHOR_ORGANIZATION_ID || 'ernest-demo',
            organizationName: process.env.ANCHOR_ORGANIZATION_NAME || 'Ernest Demo',
            domain: process.env.ANCHOR_DOMAIN || 'ai-provenance',
        };
    }

    private getAnchorMode(rpcUrl: string): 'local' | 'sepolia' | 'custom' {
        if (rpcUrl.includes('local-chain') || rpcUrl.includes('127.0.0.1') || rpcUrl.includes('localhost')) {
            return 'local';
        }
        if (rpcUrl.includes('sepolia')) {
            return 'sepolia';
        }
        return 'custom';
    }

    private redactRpcUrl(rpcUrl: string): string {
        try {
            const url = new URL(rpcUrl);
            if (url.username || url.password) {
                url.username = url.username ? '***' : '';
                url.password = url.password ? '***' : '';
            }
            return url.toString();
        } catch {
            return rpcUrl;
        }
    }

    private isDuplicateKeyError(error: any): boolean {
        return error?.code === 11000 || (error?.name === 'MongoServerError' && error?.code === 11000);
    }

    /**
    * Clean undefined, null and empty recursively. Public because signature admission
    * (ApiService.admitSignature) must verify over the SAME cleaned form that gets
    * stored in block.data -- otherwise the backend and the Go/CLI/WASM verifiers (which
    * check the stored, already-cleaned data) would disagree on the signed bytes.
    */
    cleanObject(obj: any): any {
        if (obj === null || obj === undefined) {
            return {};
        }

        if (typeof obj !== 'object' || obj instanceof Date) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj
                .map(item => this.cleanObject(item))
                .filter(item => item !== undefined && item !== null);
        }

        const cleaned: any = {};

        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];

                // Saltar undefined, null, strings vacíos
                if (value === undefined || value === null || value === '') {
                    continue;
                }

                // Recursivo para objetos anidados
                if (typeof value === 'object' && !(value instanceof Date)) {
                    const cleanedValue = this.cleanObject(value);

                    //Solo añadir si el objeto/array NO está vacío
                    if (Array.isArray(cleanedValue)) {
                        if (cleanedValue.length > 0) {
                            cleaned[key] = cleanedValue;
                        }
                    } else if (Object.keys(cleanedValue).length > 0) {
                        cleaned[key] = cleanedValue;
                    }
                    // Si está vacío, NO lo añadimos
                } else {
                    cleaned[key] = value;
                }
            }
        }

        return cleaned;
    }

}
