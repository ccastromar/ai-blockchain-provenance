/*
 * AI Model Provenance & Auditing PoC
 * Copyright (c) 2025 Carlos Castro Martos
 * Licensed under the MIT License – see root LICENSE
 */

import { ConflictException, Injectable, OnModuleInit, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProvenanceBlock, ProvenanceBlockDocument } from './models/provenance-block.schema';
import * as crypto from 'crypto';
import MerkleTree from 'merkletreejs';
import keccak256 from 'keccak256';
import { ethers } from 'ethers';
import { Anchor, AnchorDocument } from './models/anchor.schema';
import { canonicalizeEx } from 'json-canonicalize';
import abiJson from '../abis/ErnestMerkleAnchor.json';
import { buildCycloneDxMlBom } from './cyclonedx';

const anchorAbi = abiJson.abi;
const MAX_APPEND_RETRIES = 5;

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
    ) { }

    async onModuleInit() {
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
    async addBlock(data: ProvenanceBlock['data']): Promise<ProvenanceBlockDocument> {
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
            };

            newBlock.hash = this.calculateHash(newBlock);

            try {
                const createdBlock = await this.provenanceBlockModel.create(newBlock);

                this.maybeAnchorNew().catch(e => this.logger.warn('Problem anchoring: ' + e.message));

                this.logger.log(`Block ${newBlock.index} added with hash: ${newBlock.hash}`);
                this.logger.debug(`Block data: ${JSON.stringify(cleanedData)}`);

                return createdBlock;
            } catch (error) {
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
    private calculateHash(block: Partial<ProvenanceBlock>): string {
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
            query['data.type'] = filters.type;
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

        const verification = await this.verifyChain();

        return {
            modelId,
            totalBlocks: blocks.length,
            chainValid: verification.isValid,
            verificationErrors: verification.errors,
            history: blocks.map(b => ({
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
            }))
        };
    }

    /**
     * Get hashchain statistics 
     */
    async getChainStats() {
        const totalBlocks = await this.provenanceBlockModel.countDocuments();
        const lastBlock = await this.provenanceBlockModel.findOne().sort({ index: -1 }).lean();
        const verification = await this.verifyChain();
        const modelCount = await this.provenanceBlockModel.distinct('data.modelId');
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
                merkleRoot: lastAnchor.merkleRoot,
                lastBlockIndex: lastAnchor.lastBlockIndex,
                txHash: lastAnchor.txHash,
                blockNumber: lastAnchor.blockNumber,
                chainId: lastAnchor.chainId,
                contractAddress: lastAnchor.contractAddress,
                organizationId: lastAnchor.organizationId,
                organizationName: lastAnchor.organizationName,
                domain: lastAnchor.domain,
                anchoredAt: lastAnchor.anchoredAt,
                confirmedAt: lastAnchor.confirmedAt,
                status: lastAnchor.status,
                etherscanUrl: lastAnchor.txHash
                    ? `https://sepolia.etherscan.io/tx/${lastAnchor.txHash}`
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
    ) {
        return await this.addBlock({
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
        });
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
    ) {
        return await this.addBlock({
            type: 'inference',
            modelId,
            inferenceId,
            inputHash,
            outputHash,
            params,
            metadata,
            executedAt: new Date().toISOString(),            
        });
    }

    /**
     * Get all blocks (paginated)
     */
    async getAllBlocks(page = 1, limit = 20): Promise<any> {
        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.provenanceBlockModel.find().sort({ index: 1 }).skip(skip).limit(limit).lean(),
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
        const modelBlocks = await this.provenanceBlockModel
            .find({ 'data.modelId': modelId })
            .sort({ index: 1 })
            .lean();

        if (modelBlocks.length === 0) {
            return { modelId, isValid: false, valid: false, totalBlocks: 0, errors: [`No blocks found for model ${modelId}`] };
        }

        const errors: string[] = [];

        for (let i = 0; i < modelBlocks.length; i++) {
            const block = modelBlocks[i];
            const calculatedHash = this.calculateHash(block);

            if (block.hash !== calculatedHash) {
                errors.push(`Block ${block.index}: hash mismatch`);
            }

            // Verify chain link to previous block in the global chain
            const prevBlock = await this.provenanceBlockModel.findOne({ index: block.index - 1 }).lean();
            if (prevBlock && block.previousHash !== prevBlock.hash) {
                errors.push(`Block ${block.index}: broken link to previous block ${block.index - 1}`);
            }
        }

        const isValid = errors.length === 0;
        return { modelId, isValid, valid: isValid, totalBlocks: modelBlocks.length, errors };
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
                txHash: anchor.txHash,
                blockNumber: anchor.blockNumber,
                chainId: anchor.chainId,
                contractAddress: anchor.contractAddress,
                organizationId: anchor.organizationId,
                lastBlockIndex: anchor.lastBlockIndex,
                anchoredAt: anchor.anchoredAt,
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
        const config = this.getAnchorConfig(false);
        if (!config) {
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

        return await this.anchorMerkleRootToEthereum();
    }

    /**
     * Anchor Merkle root in Ethereum testnet
     */
    async anchorMerkleRootToEthereum(): Promise<any> {
        const config = this.getAnchorConfig(true)!;
        const lastBlock = await this.provenanceBlockModel.findOne().sort({ index: -1 }).lean();
        if (!lastBlock) {
            throw new Error('No blocks found to anchor');
        }

        // Bounded to lastBlock.index: without it, a block appended while the anchor
        // transaction is in flight would make the stored root cover more blocks than
        // lastBlockIndex records, and no inclusion proof could ever reproduce it.
        const merkleRoot = await this.getMerkleRoot(lastBlock.index);
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
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

        if (!config) {
            return {
                configured: false,
                mode: 'disabled',
                reason: 'Set INFURA_URL, PRIVATE_KEY and CONTRACT_ADDRESS to enable anchoring.',
                lastAnchor,
            };
        }

        let chainId: number | null = null;
        let latestBlock: number | null = null;
        let reachable = false;
        let error: string | undefined;

        try {
            const provider = new ethers.JsonRpcProvider(config.rpcUrl);
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
    * Clean undefined, null and empty recursively 
    */
    private cleanObject(obj: any): any {
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
