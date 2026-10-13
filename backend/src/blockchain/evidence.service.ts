/*
 * AI Model Provenance & Auditing PoC
 * Copyright (c) 2025 Carlos Castro Martos
 * Licensed under the MIT License – see root LICENSE
 */

import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import * as os from 'os';
import { BlockchainService, EventRangeAlreadyChainedError } from './blockchain.service';
import { EvidenceEvent, EvidenceEventDocument } from './models/evidence-event.schema';
import { BatcherLease, BatcherLeaseDocument } from './models/batcher-lease.schema';
import { auditPath, canonicalEventData, leafHashOf, merkleRoot, TREE_ALG, verifyInclusion } from './merkle-rfc6962';
import { hasRole, writesAllowed } from '../common/ernest-role';

/**
 * EVIDENCE_BATCHING (ADR-004 rollout):
 *  - off:    every event is appended as its own block, synchronously (pre-ADR-004 behaviour).
 *  - events: rollout step 1. Events go through the event store (idempotent by
 *            (source, eventId)) and the batcher chains ONE BLOCK PER EVENT, with exactly the
 *            data a direct append would have stored -- the chain's shape does not change.
 *            Submissions wait for their block by default, so responses still carry it.
 *  - on:     rollout step 2. The batcher chains one `batch` block per interval (or per
 *            BATCH_MAX_EVENTS) committing to its events through an RFC 6962 root.
 *            Submissions answer `pending` unless the caller asks to wait.
 */
export type EvidenceMode = 'off' | 'events' | 'on';

const LEASE_ID = 'evidence';
const LEASE_TTL_MS = 15_000;
const SEQ_COUNTER_ID = 'evidence_seq';
const WAIT_POLL_MS = 50;
// Ignored when deciding whether a duplicate carries the same content: executedAt is
// server-augmented, and a retrying emitter re-signs (new signedAt, and a non-deterministic
// ECDSA seal) over the same payload. The first stored record, signature included, stands.
const VOLATILE_FIELDS = ['executedAt', 'signature'];

type ChainKind = 'block' | 'batch';

@Injectable()
export class EvidenceService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(EvidenceService.name);
    private readonly owner = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
    private timer: NodeJS.Timeout | null = null;
    private ticking = false;
    private tickAgain = false;

    constructor(
        @InjectModel(EvidenceEvent.name)
        private readonly eventModel: Model<EvidenceEventDocument>,
        @InjectModel(BatcherLease.name)
        private readonly leaseModel: Model<BatcherLeaseDocument>,
        private readonly blockchainService: BlockchainService,
    ) { }

    mode(): EvidenceMode {
        const raw = (process.env.EVIDENCE_BATCHING || 'off').toLowerCase();
        return raw === 'events' || raw === 'on' ? raw : 'off';
    }

    enabled(): boolean {
        return this.mode() !== 'off';
    }

    private intervalMs(): number {
        const n = Number.parseInt(process.env.BATCH_INTERVAL_MS || '1000', 10);
        return Number.isFinite(n) && n >= 50 ? n : 1000;
    }

    private maxEvents(): number {
        const n = Number.parseInt(process.env.BATCH_MAX_EVENTS || '1000', 10);
        return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1000;
    }

    async onModuleInit() {
        if (!this.enabled()) return;
        if (writesAllowed()) await this.ensureIndexes();
        // Only the chainer chains; writers insert events and readers read them.
        if (!hasRole('chainer')) return;
        this.timer = setInterval(() => this.kick(), this.intervalMs());
        this.logger.log(`Evidence batcher started (mode=${this.mode()}, interval=${this.intervalMs()}ms, max=${this.maxEvents()})`);
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    async ensureIndexes(): Promise<void> {
        const c = this.eventModel.collection;
        const create = async (key: Record<string, 1 | -1>, options: Record<string, any>) => {
            try {
                await c.createIndex(key, options);
            } catch (err) {
                if (err?.code !== 85 && err?.code !== 86) throw err;
            }
        };
        await create({ source: 1, eventId: 1 }, { unique: true, name: 'unique_source_event' });
        await create({ seq: 1 }, { unique: true, name: 'unique_seq', partialFilterExpression: { seq: { $exists: true } } });
        await create({ state: 1, _id: 1 }, { name: 'state_pending' });
        await create({ state: 1, seq: 1 }, { name: 'state_seq' });
        await create({ modelId: 1, seq: 1 }, { name: 'model_seq' });
        await create({ 'data.metadata.stage': 1, 'data.metadata.aiSystemId': 1, blockIndex: 1 }, { name: 'stage_system_block' });
        await create({ blockIndex: 1 }, { name: 'event_block' });
    }

    // ── Admission ────────────────────────────────────────────────────────────

    /**
     * Stores one event (already admitted by the caller: signature, model ordering). A
     * re-send with the same (source, eventId) returns the stored record; a re-send with
     * the same id but different content is refused -- silently keeping either version
     * would make the evidence ambiguous.
     */
    async record(data: Record<string, any>, key: { source: string; eventId: string }): Promise<{ event: any; duplicate: boolean }> {
        const cleaned = this.blockchainService.cleanObject(data);
        try {
            const created = await this.eventModel.create({
                source: key.source,
                eventId: key.eventId,
                data: cleaned,
                modelId: cleaned.modelId,
                type: cleaned.type,
                leafHash: leafHashOf(cleaned),
                state: 'pending',
            });
            return { event: created.toObject(), duplicate: false };
        } catch (err) {
            if (err?.code !== 11000) throw err;
            return this.resolveDuplicate(cleaned, key, err);
        }
    }

    /**
     * Bulk form of record() for a batch submission: one insertMany round trip instead of one
     * insert per event, with the same per-item outcome — stored, duplicate (same content) or
     * a ConflictException (different content). Items fail independently: an item's failure
     * is returned as `{ error }`, never thrown for the whole batch.
     */
    async recordMany(items: Array<{ data: Record<string, any>; key: { source: string; eventId: string } }>):
        Promise<Array<{ event: any; duplicate: boolean } | { error: unknown }>> {
        if (items.length === 0) return [];
        const now = new Date();
        // Raw driver insert (no Mongoose document per item): the fields and defaults are the
        // schema's, written out here — timestamps included, since the driver does not add them.
        const docs = items.map(({ data, key }) => {
            const cleaned = this.blockchainService.cleanObject(data);
            return {
                source: key.source,
                eventId: key.eventId,
                data: cleaned,
                modelId: cleaned.modelId,
                type: cleaned.type,
                leafHash: leafHashOf(cleaned),
                state: 'pending',
                createdAt: now,
                updatedAt: now,
            };
        });
        const failed = new Map<number, any>();
        try {
            await this.eventModel.collection.insertMany(docs, { ordered: false });
        } catch (err) {
            const writeErrors = err?.writeErrors;
            if (!writeErrors) throw err;
            for (const we of [].concat(writeErrors)) failed.set(we.index, we);
        }
        return Promise.all(docs.map(async (doc, i) => {
            const we = failed.get(i);
            if (!we) return { event: doc, duplicate: false };
            if (we.code !== 11000) return { error: new Error(we.errmsg ?? `insert failed (code ${we.code})`) };
            try {
                return await this.resolveDuplicate(doc.data, items[i].key, we);
            } catch (error) {
                return { error };
            }
        }));
    }

    private async resolveDuplicate(cleaned: Record<string, any>, key: { source: string; eventId: string }, cause: unknown) {
        const existing = await this.eventModel.findOne({ source: key.source, eventId: key.eventId }).lean();
        if (!existing) throw cause;
        if (this.contentKey(existing.data) !== this.contentKey(cleaned)) {
            throw new ConflictException(
                `Event '${key.eventId}' from '${key.source}' was already recorded with different content.`,
            );
        }
        return { event: existing, duplicate: true };
    }

    private contentKey(data: Record<string, any>): string {
        const rest = { ...data };
        for (const f of VOLATILE_FIELDS) delete rest[f];
        return canonicalEventData(rest);
    }

    /** A registration event exists (pending or chained) for this model. */
    async hasRegistrationEvent(modelId: string): Promise<boolean> {
        return !!(await this.eventModel.exists({ modelId, type: 'model_registration' }));
    }

    /**
     * Holds until every given event is chained (or the timeout passes) and returns the
     * events as they are then. Nudges the batcher so a waiting caller is not held for a
     * whole interval when this process is the leader.
     */
    async waitForChained(ids: Types.ObjectId[], timeoutMs = this.intervalMs() * 5 + 5000): Promise<any[]> {
        const deadline = Date.now() + timeoutMs;
        this.kick();
        for (;;) {
            const events = await this.eventModel.find({ _id: { $in: ids } }).lean();
            if (events.every((e: any) => e.state === 'chained') || Date.now() >= deadline) {
                const byId = new Map(events.map((e: any) => [String(e._id), e]));
                return ids.map(id => byId.get(String(id)));
            }
            await new Promise(r => setTimeout(r, WAIT_POLL_MS));
        }
    }

    // ── Batcher ──────────────────────────────────────────────────────────────

    /** Runs a batcher pass now (single-flight; a kick during a pass schedules another). */
    kick(): void {
        if (!this.enabled()) return;
        if (this.ticking) {
            this.tickAgain = true;
            return;
        }
        this.ticking = true;
        setImmediate(async () => {
            try {
                do {
                    this.tickAgain = false;
                    await this.tick();
                } while (this.tickAgain);
            } catch (e: any) {
                this.logger.warn(`Evidence batcher pass failed: ${e.message}`);
            } finally {
                this.ticking = false;
            }
        });
    }

    private async acquireLease(): Promise<boolean> {
        const now = new Date();
        try {
            const lease = await this.leaseModel.findOneAndUpdate(
                { _id: LEASE_ID, $or: [{ owner: this.owner }, { expiresAt: { $lt: now } }] },
                { $set: { owner: this.owner, expiresAt: new Date(now.getTime() + LEASE_TTL_MS) } },
                { upsert: true, new: true },
            ).lean();
            return lease?.owner === this.owner;
        } catch (err) {
            if (err?.code === 11000) return false; // held by another live leader
            throw err;
        }
    }

    private async tick(): Promise<void> {
        if (!(await this.acquireLease())) return;
        await this.resumeAssigned();

        const kind: ChainKind = this.mode() === 'on' ? 'batch' : 'block';
        const max = this.maxEvents();
        for (;;) {
            const pending = await this.eventModel
                .find({ state: 'pending' })
                .sort({ _id: 1 })
                .limit(max)
                .lean();
            if (pending.length === 0) return;

            const assigned = await this.assign(this.causalOrder(pending), kind);
            await this.chainAssigned(assigned, kind);

            if (pending.length < max) return;
            if (!(await this.acquireLease())) return; // renew between full batches
        }
    }

    /**
     * Admission order is _id order, but ObjectIds from different replicas are only roughly
     * ordered. Within a batch, registrations go first so an inference is never chained
     * ahead of its model's registration (across batches the registration is admitted --
     * hence visible -- before any inference for its model is accepted).
     */
    private causalOrder(events: any[]): any[] {
        return [
            ...events.filter(e => e.type === 'model_registration'),
            ...events.filter(e => e.type !== 'model_registration'),
        ];
    }

    /**
     * Allocates a seq range from a counter (ranges never overlap, even between two leaders
     * during a lease handover) and stamps it on the events still pending. The events this
     * leader actually stamped are the batch; a range may have holes if another leader
     * took some of them, which is harmless: a batch is "the events whose seq falls in
     * [firstSeq, lastSeq]", and no other batch can hold a seq from this range.
     */
    private async assign(events: any[], kind: ChainKind): Promise<any[]> {
        const counter = await this.leaseModel.db.collection('counters').findOneAndUpdate(
            { _id: SEQ_COUNTER_ID as any },
            { $inc: { value: events.length } },
            { upsert: true, returnDocument: 'after' },
        );
        // Driver 6 returns the document; older drivers wrap it in { value }.
        const doc: any = counter && typeof (counter as any).value === 'object' ? (counter as any).value : counter;
        const last: number = doc.value;
        const first = last - events.length + 1;
        const firstSeq = (i: number) => (kind === 'batch' ? first : first + i);

        await this.eventModel.bulkWrite(events.map((e, i) => ({
            updateOne: {
                filter: { _id: e._id, state: 'pending' },
                update: { $set: { state: 'assigned', seq: first + i, leafIndex: kind === 'batch' ? i : 0, chain: { kind, firstSeq: firstSeq(i) } } },
            },
        })), { ordered: false });

        return this.eventModel
            .find({ state: 'assigned', seq: { $gte: first, $lte: last } })
            .sort({ seq: 1 })
            .lean();
    }

    /** Completes events a previous leader assigned but did not finish chaining. */
    private async resumeAssigned(): Promise<void> {
        const assigned = await this.eventModel.find({ state: 'assigned' }).sort({ seq: 1 }).lean();
        if (assigned.length === 0) return;
        this.logger.warn(`Resuming ${assigned.length} assigned-but-unchained evidence events`);
        for (const kind of ['block', 'batch'] as ChainKind[]) {
            await this.chainAssigned(assigned.filter((e: any) => e.chain?.kind === kind), kind);
        }
    }

    private async chainAssigned(events: any[], kind: ChainKind): Promise<void> {
        const groups = new Map<number, any[]>();
        for (const e of events) {
            const key = e.chain.firstSeq;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(e);
        }
        for (const [firstSeq, group] of groups) {
            group.sort((a, b) => a.seq - b.seq);
            if (kind === 'batch') {
                // Leaf positions are fixed by seq order within the batch.
                group.forEach((e, i) => (e.leafIndex = i));
            }
            const data = kind === 'batch'
                ? {
                    type: 'batch',
                    root: merkleRoot(group.map(e => e.leafHash)),
                    size: group.length,
                    firstSeq,
                    lastSeq: group[group.length - 1].seq,
                    treeAlg: TREE_ALG,
                }
                : group[0].data;

            let blockIndex: number;
            try {
                const block = await this.blockchainService.addBlock(data as any, { eventSeq: firstSeq });
                blockIndex = block.index;
            } catch (e) {
                if (!(e instanceof EventRangeAlreadyChainedError)) throw e;
                // Chained by a previous leader that stopped before marking its events.
                const existing = await this.blockchainService.getBlockByEventSeq(firstSeq);
                blockIndex = existing!.index;
            }
            await this.eventModel.bulkWrite(group.map(e => ({
                updateOne: {
                    filter: { _id: e._id },
                    update: { $set: { state: 'chained', blockIndex, leafIndex: e.leafIndex } },
                },
            })), { ordered: false });
        }
    }

    // ── Proofs ───────────────────────────────────────────────────────────────

    /**
     * Every event chained inside a batch block, in seq order, for offline verification
     * next to GET /api/blocks/export (`ernest hashchain verify --file ... --events ...`).
     * A cursor, so the controller streams it with constant memory.
     */
    async exportBatchedEventsCursor(): Promise<{ exportedAt: string; totalEvents: number; cursor: AsyncIterable<any> }> {
        const filter = { 'chain.kind': 'batch', state: 'chained' };
        const totalEvents = await this.eventModel.countDocuments(filter);
        const cursor = this.eventModel
            .find(filter, { _id: 0, seq: 1, source: 1, eventId: 1, data: 1, leafHash: 1, blockIndex: 1, leafIndex: 1 })
            .sort({ seq: 1 })
            .lean()
            .cursor();
        return { exportedAt: new Date().toISOString(), totalEvents, cursor };
    }

    async findEvent(source: string, eventId: string): Promise<any | null> {
        return this.eventModel.findOne({ source, eventId }).lean();
    }

    async getBlockHash(index: number | undefined): Promise<string | undefined> {
        if (index === undefined) return undefined;
        return (await this.blockchainService.getBlockByIndex(index))?.hash;
    }

    /**
     * Self-contained proof that one event is in the chain (ADR-004 §3): the event data,
     * how it reaches its block (RFC 6962 audit path for a batch block; identical data for
     * a per-event block), the block, and -- when an anchor covers that block -- the
     * existing anchor inclusion receipt from the block to the public anchor.
     */
    async getProof(source: string, eventId: string): Promise<any | null> {
        const event = await this.findEvent(source, eventId);
        if (!event) return null;

        const eventView = { source, eventId, seq: event.seq, data: event.data, leafHash: event.leafHash };
        if (event.state !== 'chained') {
            return { status: 'pending', event: eventView };
        }

        const block = await this.blockchainService.getBlockByIndex(event.blockIndex);
        if (!block) {
            throw new ConflictException(`Event is recorded at block ${event.blockIndex}, which does not exist`);
        }

        let inclusion: Record<string, any>;
        if (block.data?.type === 'batch') {
            const members = await this.eventModel
                .find({ seq: { $gte: block.data.firstSeq, $lte: block.data.lastSeq } }, { seq: 1, leafHash: 1 })
                .sort({ seq: 1 })
                .lean();
            const leaves = members.map((m: any) => m.leafHash);
            const proof = auditPath(leaves, event.leafIndex);
            const recomputed = leafHashOf(event.data);
            // Refusing to emit a proof the store cannot reproduce IS the tamper evidence.
            if (recomputed !== event.leafHash
                || members.length !== block.data.size
                || !verifyInclusion(recomputed, event.leafIndex, block.data.size, proof, block.data.root)) {
                throw new ConflictException(
                    `Evidence store does not reproduce batch root ${block.data.root} of block ${block.index}; the batch appears modified.`,
                );
            }
            inclusion = {
                kind: 'batch',
                treeAlg: TREE_ALG,
                leafHash: recomputed,
                leafIndex: event.leafIndex,
                treeSize: block.data.size,
                auditPath: proof,
                root: block.data.root,
            };
        } else {
            if (canonicalEventData(block.data) !== canonicalEventData(event.data)) {
                throw new ConflictException(`Block ${block.index} data does not match the stored event`);
            }
            inclusion = { kind: 'block' };
        }

        let anchor: Record<string, any> | null = null;
        let anchorPending: string | undefined;
        try {
            const receipt = await this.blockchainService.getBlockProof(block.index);
            const { block: _b, generatedAt: _g, ...rest } = receipt;
            anchor = rest;
        } catch (e: any) {
            anchorPending = e.message;
        }

        return {
            status: 'chained',
            event: eventView,
            inclusion,
            block: {
                index: block.index,
                timestamp: block.timestamp,
                data: block.data,
                previousHash: block.previousHash,
                hash: block.hash,
            },
            anchor,
            ...(anchorPending ? { anchorPending } : {}),
            generatedAt: new Date().toISOString(),
        };
    }
}
