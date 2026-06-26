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
        await this.createGenesisBlock();
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
                    metadata: { description: 'Genesis block for Ernest PoC' }
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

            const timestamp = Math.floor(Date.now() / 1000);
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
     * Verify hashchain integrity
     */
    async verifyChain(): Promise<{ isValid: boolean; errors: string[] }> {
        const blocks = await this.provenanceBlockModel
            .find()
            .sort({ index: 1 })
            .lean();

        const errors: string[] = [];

        for (let i = 0; i < blocks.length; i++) {
            const currentBlock = blocks[i];

            // Calculate current block hash
            const calculatedHash = this.calculateHash(currentBlock);

            if (currentBlock.hash !== calculatedHash) {
                errors.push(`Block ${currentBlock.index}: Hash mismatch`);
                this.logger.error(`Block ${currentBlock.index} hash mismatch:`);
                this.logger.error(`  Stored hash: ${currentBlock.hash}`);
                this.logger.error(`  Calculated hash: ${calculatedHash}`);
                this.logger.error(`  Block index: ${currentBlock.index}`);
                this.logger.error(`  Data: ${JSON.stringify(currentBlock.data)}`);
                this.logger.error(`  Timestamp: ${currentBlock.timestamp}`);
                this.logger.error(`  Timestamp (ISO): ${new Date(currentBlock.timestamp * 1000).toISOString()}`);
            }

            // Verify hash chaining (if not genesis)
            if (i > 0) {
                const previousBlock = blocks[i - 1];

                if (currentBlock.previousHash !== previousBlock.hash) {
                    errors.push(`Block ${currentBlock.index}: Hashchain broken ! (previousHash: ${currentBlock.previousHash.substring(0, 16)}..., expected: ${previousBlock.hash.substring(0, 16)}...)`);
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Get full provenance by modelId
     */
    async getProvenance(modelId: string) {
        const blocks = await this.provenanceBlockModel
            .find({ 'data.modelId': modelId })
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
                version: b.data.version,
                inputHash: b.data.inputHash,
                outputHash: b.data.outputHash,
                params: b.data.params,
                metadata: b.data.metadata,
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
        metadata?: Record<string, any>
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
            metadata
        });
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
     * Get all blocks
     */
    async getAllBlocks(): Promise<any[]> {

        return await this.provenanceBlockModel
            .find()
            .sort({ index: 1 })
            .lean();
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
   * Calcule Merkle root for the hashchain
   */
    async getMerkleRoot(): Promise<string> {
        const blocks = await this.provenanceBlockModel.find().sort({ index: 1 }).lean();
        const blockHashes = blocks.map(b => b.hash);
        if (blockHashes.length === 0) {
            throw new Error('No blocks found');
        }
        const leaves = blockHashes.map(h => Buffer.from(h.replace(/^0x/, ''), 'hex'));
        const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        return '0x' + tree.getRoot().toString('hex');
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

        const merkleRoot = await this.getMerkleRoot();
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
