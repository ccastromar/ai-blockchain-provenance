import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

    const blockchainResult = await this.blockchainService.registerModel(
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

    await this.modelService.create({
        modelId: dto.modelId,
        name: dto.modelName,
        version: dto.version,
        parameters: dto.params,
        metrics: dto.metrics,
        metadata: dto.metadata,
        organizationId: dto.organizationId,
    } as any);

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

  async logInference(dto: LogInferenceDto) {
    this.logger.log(`Logging inference for model ID: ${dto.modelId}`);

    const modelExists = await this.modelService.findOne(dto.modelId);
    this.logger.log(`Model existence check for ID ${dto.modelId}: ${!!modelExists}`);
    if (!modelExists) {
      this.logger.error(`Model ID ${dto.modelId} does not exist`);
      throw new NotFoundException(`Model ID ${dto.modelId} does not exist`);
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
}
