/*
 * AI Model Provenance & Auditing PoC
 * Copyright (c) 2025 Carlos Castro Martos
 * Licensed under the MIT License – see root LICENSE
 */

import * as crypto from 'crypto';

// Mirrors the shape BlockchainService.getProvenance() returns. Kept as a local type
// (rather than importing one from blockchain.service.ts) so this module stays a pure,
// dependency-free function that's trivial to unit test without mocking Mongo.
export interface ProvenanceHistoryItem {
    blockIndex: number;
    timestamp: string;
    type?: string;
    modelId: string;
    modelName?: string;
    version?: string;
    modelHash?: string;
    gitCommit?: string;
    metrics?: Record<string, unknown>;
    metadata?: Record<string, any>;
    organizationId?: string;
    blockHash: string;
    previousHash: string;
}

export interface ProvenanceResult {
    modelId: string;
    totalBlocks: number;
    chainValid: boolean;
    verificationErrors: string[];
    history: ProvenanceHistoryItem[];
}

const SHA256_HEX = /^[a-f0-9]{64}$/i;

/**
 * Builds a CycloneDX 1.6 BOM document with an AI/ML-BOM `machine-learning-model`
 * component, so Ernest's provenance evidence can be read by any tool that already
 * speaks CycloneDX (dependency-track, GUAC, etc.) instead of only by Ernest itself.
 *
 * Field names and structure were verified against CycloneDX's own schema-conformance
 * fixture (specification/tools/src/test/resources/1.6/valid-machine-learning-1.6.json),
 * not reconstructed from memory. Only fields Ernest actually has data for are emitted —
 * optional ML-BOM fields Ernest doesn't track (architecture family, learning approach,
 * considerations, etc.) are left out rather than filled with placeholders.
 */
export function buildCycloneDxMlBom(provenance: ProvenanceResult, options: { verificationUrl?: string } = {}): Record<string, any> {
    const latest = latestModelBlock(provenance.history);
    const gitCommits = uniqueOrdered(provenance.history.map(h => h.gitCommit).filter(isNonEmptyString));
    const performanceMetrics = buildPerformanceMetrics(provenance.history);
    const datasets = buildDatasets(provenance.history);

    const component: Record<string, any> = {
        'bom-ref': `urn:ernest:model:${provenance.modelId}`,
        type: 'machine-learning-model',
        name: latest?.modelName || provenance.modelId,
        version: latest?.version || 'unknown',
        properties: [
            { name: 'ernest:modelId', value: provenance.modelId },
            { name: 'ernest:chainValid', value: String(provenance.chainValid) },
            { name: 'ernest:eventCount', value: String(provenance.totalBlocks) },
            ...(latest ? [
                { name: 'ernest:blockIndex', value: String(latest.blockIndex) },
                { name: 'ernest:blockHash', value: latest.blockHash },
            ] : []),
            ...(latest?.organizationId ? [{ name: 'ernest:organizationId', value: latest.organizationId }] : []),
        ],
    };

    if (latest?.modelHash && SHA256_HEX.test(latest.modelHash)) {
        component.hashes = [{ alg: 'SHA-256', content: latest.modelHash.toLowerCase() }];
    }

    if (options.verificationUrl) {
        component.externalReferences = [
            { type: 'other', url: options.verificationUrl, comment: 'Ernest tamper-evident provenance record for this model' },
        ];
    }

    if (gitCommits.length > 0) {
        component.pedigree = { commits: gitCommits.map(uid => ({ uid })) };
    }

    const modelCard: Record<string, any> = {};
    if (datasets.length > 0) {
        modelCard.modelParameters = { datasets };
    }
    if (performanceMetrics.length > 0) {
        modelCard.quantitativeAnalysis = { performanceMetrics };
    }
    if (Object.keys(modelCard).length > 0) {
        component.modelCard = modelCard;
    }

    return {
        $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        serialNumber: `urn:uuid:${crypto.randomUUID()}`,
        version: 1,
        metadata: {
            timestamp: new Date().toISOString(),
            tools: {
                components: [{ type: 'application', name: 'ernest-api' }],
            },
        },
        components: [component],
    };
}

function latestModelBlock(history: ProvenanceHistoryItem[]): ProvenanceHistoryItem | undefined {
    const modelEventTypes = new Set(['model_registration', 'model_update', 'model_deployment', 'model_undeployment']);
    const modelBlocks = history.filter(h => !h.type || modelEventTypes.has(h.type));
    const source = modelBlocks.length > 0 ? modelBlocks : history;
    return source.length > 0 ? source[source.length - 1] : undefined;
}

function buildPerformanceMetrics(history: ProvenanceHistoryItem[]): Array<Record<string, string>> {
    const metrics: Array<Record<string, string>> = [];
    for (const block of history) {
        if (!block.metrics || typeof block.metrics !== 'object') continue;
        for (const [key, value] of Object.entries(block.metrics)) {
            if (value === null || value === undefined) continue;
            metrics.push({
                type: key,
                value: String(value),
                slice: `block ${block.blockIndex} (${block.timestamp})`,
            });
        }
    }
    return metrics;
}

function buildDatasets(history: ProvenanceHistoryItem[]): Array<Record<string, any>> {
    const seen = new Set<string>();
    const datasets: Array<Record<string, any>> = [];
    for (const block of history) {
        if (block.type !== 'dataset_linked') continue;
        const name = firstNonEmptyString(
            block.metadata?.datasetName,
            block.metadata?.dataset,
            block.metadata?.name,
        );
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const dataset: Record<string, any> = { type: 'dataset', name };
        const uri = firstNonEmptyString(block.metadata?.datasetUri, block.metadata?.uri, block.metadata?.url);
        if (uri) dataset.contents = { url: uri };
        datasets.push(dataset);
    }
    return datasets;
}

function uniqueOrdered(values: string[]): string[] {
    return [...new Set(values)];
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
    return values.find(isNonEmptyString) as string | undefined;
}
