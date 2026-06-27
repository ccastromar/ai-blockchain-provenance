/*
 * AI Model Provenance & Auditing PoC
 * Copyright (c) 2025 Carlos Castro Martos
 * Licensed under the MIT License – see root LICENSE
 */
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import * as fs from 'fs';

@Injectable()
export class MlflowService {
  private readonly logger = new Logger(MlflowService.name);

  calculateHash(content: string | Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  getGitCommit(): string {
    try {
      return execSync('git rev-parse HEAD').toString().trim();
    } catch {
      return Date.now().toString();
    }
  }

  /**
   * Returns modelHash + gitCommit from the MLflow tracking server if
   * MLFLOW_TRACKING_URI is set, otherwise falls back to local simulation.
   */
  async registerModel(
    modelName: string,
    modelPath: string,
    params: Record<string, any>,
    metrics?: Record<string, number>,
  ) {
    const trackingUri = process.env.MLFLOW_TRACKING_URI;

    if (trackingUri) {
      return await this.registerModelReal(trackingUri, modelName, modelPath, params, metrics);
    }

    return await this.registerModelMock(modelName, modelPath, params, metrics);
  }

  /**
   * Fetch the latest model version from MLflow and derive modelHash + gitCommit.
   * Calls: GET /api/2.0/mlflow/registered-models/get-latest-versions
   */
  private async registerModelReal(
    trackingUri: string,
    modelName: string,
    modelPath: string,
    params: Record<string, any>,
    metrics?: Record<string, number>,
  ) {
    this.logger.log(`Fetching model info from MLflow: ${trackingUri}`);

    const url = `${trackingUri}/api/2.0/mlflow/registered-models/get-latest-versions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stages: ['None', 'Staging', 'Production'] }),
    });

    if (!res.ok) {
      throw new Error(`MLflow API error: ${res.status} ${await res.text()}`);
    }

    const json: any = await res.json();
    const versions: any[] = json.model_versions ?? [];

    if (versions.length === 0) {
      throw new Error(`Model "${modelName}" not found in MLflow at ${trackingUri}`);
    }

    // Pick the highest version number
    const latest = versions.reduce((a, b) =>
      Number(a.version) > Number(b.version) ? a : b,
    );

    // Fetch run tags to get the git commit
    let gitCommit = 'unknown';
    if (latest.run_id) {
      const runRes = await fetch(`${trackingUri}/api/2.0/mlflow/runs/get?run_id=${latest.run_id}`);
      if (runRes.ok) {
        const runJson: any = await runRes.json();
        const tags: { key: string; value: string }[] = runJson.run?.data?.tags ?? [];
        const commitTag = tags.find(t => t.key === 'mlflow.source.git.commit');
        if (commitTag) gitCommit = commitTag.value;
      }
    }

    // modelHash: hash the source URI string (artifact path) as a stable identifier
    const modelHash = this.calculateHash(latest.source ?? modelName);

    return {
      modelName,
      modelHash,
      gitCommit,
      mlflowVersion: latest.version,
      mlflowRunId: latest.run_id,
      params,
      metrics,
      registeredAt: new Date().toISOString(),
    };
  }

  private async registerModelMock(
    modelName: string,
    modelPath: string,
    params: Record<string, any>,
    metrics?: Record<string, number>,
  ) {
    this.logger.log(`Simulating MLflow registration for model: ${modelName}`);

    let modelHash = '';
    if (fs.existsSync(modelPath)) {
      modelHash = this.calculateHash(fs.readFileSync(modelPath));
    } else {
      modelHash = this.calculateHash(JSON.stringify({ modelName, params, timestamp: Date.now() }));
    }

    return {
      modelName,
      modelHash,
      gitCommit: this.getGitCommit(),
      params,
      metrics,
      registeredAt: new Date().toISOString(),
    };
  }

  async executeInference(
    modelId: string,
    inputHash: string,
    params?: Record<string, any>,
    metadata?: Record<string, any>,
  ) {
    this.logger.log(`Executing inference for model: ${modelId}`);

    const simulatedOutput = {
      prediction: Math.random() > 0.5 ? 'positive' : 'negative',
      confidence: Math.random(),
      timestamp: new Date().toISOString(),
    };

    const outputHash = this.calculateHash(JSON.stringify(simulatedOutput));

    return {
      inferenceId: `inf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      inputHash,
      outputHash,
      params,
      metadata,
      executedAt: new Date().toISOString(),
    };
  }
}
