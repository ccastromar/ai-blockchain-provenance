import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { MlflowService } from '../mlflow/mock.mlflow.service';
import { RegisterModelDto } from './dto/register-model.dto';
import { LogInferenceDto } from './dto/log-inference.dto';
import { AIModelService } from 'src/aimodels/aimodel.service';

@Injectable()
export class ApiService {

  private readonly logger = new Logger(ApiService.name);

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly mlflowService: MlflowService,
    private readonly modelService: AIModelService
  ) {}

  async registerModel(dto: RegisterModelDto) {
    this.logger.log(`Registering model: ${dto.modelName} with version: ${dto.version}`);
    if (!dto.mlflow?.modelHash || !dto.mlflow?.gitCommit) {
      throw new BadRequestException('mlflow.modelHash and mlflow.gitCommit are required.');
    }

     const already = await this.modelService.findOneByName(dto.modelName, dto.version);
      if (already) {
        throw new BadRequestException(`Model with modelName '${dto.modelName}' and version '${dto.version}' already exists.`);
      }

    //simulation
    // const mlflowResult = await this.mlflowService.registerModel(
    //   dto.modelName,
    //   dto.modelPath || '',
    //   dto.params || {},
    //   dto.metrics
    // );

    // Model document FIRST, block second. The unique (modelId, version) index makes the
    // document insert the serialization point: of two concurrent registrations of the
    // same model, the loser fails right here with a duplicate-key error -- before
    // anything reaches the hashchain -- instead of both appending registration blocks
    // and one caller getting an error after its block was already immutable.
    try {
      await this.modelService.create({
          modelId: dto.modelId,
          name: dto.modelName,
          version: dto.version,
          parameters: dto.params,
          metrics: dto.metrics,
          metadata: dto.metadata,
          organizationId: dto.organizationId,
      } as any);
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException(`Model '${dto.modelId}' version '${dto.version}' already exists.`);
      }
      throw error;
    }

    let blockchainResult;
    try {
      blockchainResult = await this.blockchainService.registerModel(
        dto.modelId,
        dto.modelName,
        dto.version,
        dto.mlflow.modelHash,
        dto.mlflow.gitCommit,
        dto.params,
        dto.metrics,
        dto.metadata,
        dto.organizationId,
      );
    } catch (error) {
      // Compensate: a model record without a registration block would accept inferences
      // the chain can't trace back to any registration. Best-effort -- if this delete
      // also fails, a retry of the register hits the duplicate guard above, which is at
      // least loud rather than silently inconsistent.
      await this.modelService.remove(dto.modelId, dto.version).catch(() => undefined);
      throw error;
    }

    return {
      success: true,
      modelId: dto.modelId,
      modelName: dto.modelName,
      version: dto.version,
      blockIndex: blockchainResult.index,
      blockHash: blockchainResult.hash,
      mlflow: {
        modelHash: dto.mlflow.modelHash,
        gitCommit: dto.mlflow.gitCommit
      },
      blockchain: {
        index: blockchainResult.index,
        hash: blockchainResult.hash,
        timestamp: blockchainResult.timestamp
      }
    };
  }

  async seedDemoData() {
    const modelId = 'demo-credit-risk-v1';
    const existing = await this.modelService.findOne(modelId);

    if (existing) {
      return {
        success: true,
        created: false,
        modelId,
        message: 'Demo data already exists.',
      };
    }

    const model = await this.registerModel({
      modelId,
      modelName: 'Demo Credit Risk Model',
      version: '1.0.0',
      modelPath: 'mlflow://experiments/credit-risk/runs/demo-credit-risk-v1/model',
      mlflow: {
        modelHash: 'f1345cf835020a390c54aba0bd5173e42d34d414b6161ec75e30577280215912',
        gitCommit: 'a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2',
      },
      params: {
        model_type: 'LogisticRegression',
        solver: 'liblinear',
        threshold: 0.42,
      },
      metrics: {
        roc_auc: 0.86,
        accuracy: 0.79,
        precision: 0.74,
      },
      metadata: {
        owner: 'AI Risk Office',
        organizationId: 'ernest-demo',
        sourceSystem: 'MLflow demo',
        useCase: 'Loan pre-screening',
        dataClassification: 'hash-only evidence',
      },
      organizationId: 'ernest-demo',
    });

    const inferences = await Promise.all([
      this.logInference({
        modelId,
        inferenceId: 'demo-credit-risk-v1-score-001',
        inputHash: '7b2f1e0d9a6c4b3f2e1d0c9b8a7f6e5d4c3b2a1908172635445362718090a1b2',
        outputHash: '1f0e2d3c4b5a6978879695a4b3c2d1e0f1029384756aabbccddeeff001122334',
        params: { threshold: 0.42, return_probs: true },
        metadata: {
          source: 'demo-loan-workflow',
          scoringRequestId: 'score-20260629-001',
          decisionType: 'pre-screening',
        },
      }),
      this.logInference({
        modelId,
        inferenceId: 'demo-credit-risk-v1-score-002',
        inputHash: '9c8b7a69584736251403f2e1d0c9b8a7f6e5d4c3b2a190817263544536271809',
        outputHash: '2a3b4c5d6e7f8091a2b3c4d5e6f7081928374655aabbccddeeff001122334455',
        params: { threshold: 0.42, return_probs: true },
        metadata: {
          source: 'demo-loan-workflow',
          scoringRequestId: 'score-20260629-002',
          decisionType: 'pre-screening',
        },
      }),
    ]);

    return {
      success: true,
      created: true,
      modelId,
      model,
      inferences,
      message: 'Demo credit-risk evidence was seeded.',
    };
  }

  async logInference(dto: LogInferenceDto) {
    this.logger.log(`Logging inference for model ID: ${dto.modelId}`);

    const modelExists = await this.modelService.findOne(dto.modelId);
    this.logger.log(`Model existence check for ID ${dto.modelId}: ${!!modelExists}`);
    if (!modelExists) {
      this.logger.error(`Model ID ${dto.modelId} does not exist`);
      throw new NotFoundException(`Model ID ${dto.modelId} does not exist`);
    }

    // The document existing isn't enough: it is created moments before the registration
    // block is appended (see registerModel), so an inference racing a registration could
    // otherwise land in the chain BEFORE its model's registration block -- a causal
    // inversion an auditor would flag. 409 tells the caller to retry, not that the
    // model doesn't exist.
    if (!(await this.blockchainService.hasRegistrationBlock(dto.modelId))) {
      throw new ConflictException(
        `Model '${dto.modelId}' registration is not yet committed to the chain. Retry shortly.`,
      );
    }

    // const inferenceResult = await this.mlflowService.executeInference(
    //   dto.modelId,
    //   dto.inputHash,
    //   dto.params,
    //   dto.metadata
    // );

    const blockchainResult = await this.blockchainService.logInference(
      dto.modelId,
      dto.inferenceId,
      dto.inputHash,
      dto.outputHash,
      dto.params,
      dto.metadata
    );

    return {
      success: true,
      inferenceId: dto.inferenceId,
      modelId: dto.modelId,
      blockIndex: blockchainResult.index,
      blockHash: blockchainResult.hash,
      hashes: {
        input: dto.inputHash,
        output: dto.outputHash
      },
      blockchain: {
        index: blockchainResult.index,
        hash: blockchainResult.hash,
        timestamp: blockchainResult.timestamp
      }
    };
  }

  async getProvenance(modelId: string, filters?: { type?: string; from?: number; to?: number; organizationId?: string }) {
    return await this.blockchainService.getProvenance(modelId, filters);
  }

  async getChainStats() {
    return await this.blockchainService.getChainStats();
  }

  async verifyChain() {
    return await this.blockchainService.verifyChain();
  }

  async anchorMerkleRoot() {
    return await this.blockchainService.anchorMerkleRootToEthereum();
  }

  async getAnchorStatus() {
    return await this.blockchainService.getAnchorStatus();
  }

  async getAllBlocks(page = 1, limit = 20) {
    return await this.blockchainService.getAllBlocks(page, limit);
  }

  async exportAllBlocksCursor() {
    return await this.blockchainService.exportAllBlocksCursor();
  }

  async getBlockProof(index: number) {
    return await this.blockchainService.getBlockProof(index);
  }

  async getOtsProof(anchorId: string) {
    return await this.blockchainService.getOtsProof(anchorId);
  }

  async getBlockByIndex(index: number) {
    return await this.blockchainService.getBlockByIndex(index);
  }

  async getAllModels(page = 1, limit = 200) {
    return await this.modelService.findAll(page, limit);
  }

  async verifyModelIntegrity(modelId: string) {
    return await this.blockchainService.verifyModelIntegrity(modelId);
  }

  async exportProvenance(modelId: string) {
    return await this.blockchainService.exportProvenance(modelId);
  }

  async exportProvenanceCycloneDx(modelId: string) {
    return await this.blockchainService.exportProvenanceCycloneDx(modelId);
  }
}
