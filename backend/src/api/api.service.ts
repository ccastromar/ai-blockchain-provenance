import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { MlflowService } from '../mlflow/mlflow.service';
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
     const already = await this.modelService.findOneByName(dto.modelName, dto.version);
      if (already) {
        throw new BadRequestException(`Model with modelName '${dto.modelName}' and version '${dto.version}' already exists.`);
      }

    //simulation
    const mlflowResult = await this.mlflowService.registerModel(
      dto.modelName,
      dto.modelPath || '',
      dto.params || {},
      dto.metrics
    );

    const blockchainResult = await this.blockchainService.registerModel(
      dto.modelName,
      dto.version,
      mlflowResult.modelHash,
      {
        ...dto.metadata,
        gitCommit: mlflowResult.gitCommit,
        params: dto.params,
        metrics: dto.metrics
      }
    );

    await this.modelService.create({
        modelId: dto.modelName,
        name: dto.modelName,
        version: dto.version,
        parameters: dto.params,
        metrics: dto.metrics,
        metadata: dto.metadata,
    });

    return {
      success: true,
      modelId: dto.modelName,
      version: dto.version,
      blockIndex: blockchainResult.index,
      blockHash: blockchainResult.hash,
      mlflow: mlflowResult,
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

    const inferenceResult = await this.mlflowService.executeInference(
      dto.modelId,
      dto.input,
      dto.params
    );

    const blockchainResult = await this.blockchainService.logInference(
      dto.modelId,
      inferenceResult.inferenceId,
      inferenceResult.inputHash,
      inferenceResult.outputHash,
      inferenceResult.params
    );

    return {
      success: true,
      inferenceId: inferenceResult.inferenceId,
      modelId: dto.modelId,
      output: inferenceResult.output,
      blockIndex: blockchainResult.index,
      blockHash: blockchainResult.hash,
      hashes: {
        input: inferenceResult.inputHash,
        output: inferenceResult.outputHash
      },
      blockchain: {
        index: blockchainResult.index,
        hash: blockchainResult.hash,
        timestamp: blockchainResult.timestamp
      }
    };
  }

  async getProvenance(modelId: string) {
    return await this.blockchainService.getProvenance(modelId);
  }

  async getChainStats() {
    return await this.blockchainService.getChainStats();
  }

  async verifyChain() {
    return await this.blockchainService.verifyChain();
  }

  async getAllBlocks() {
    return await this.blockchainService.getAllBlocks();
  }

  async getBlockByIndex(index: number) {
    return await this.blockchainService.getBlockByIndex(index);
  }

  async getAllModels() {
    return await this.modelService.findAll();   
  }  
}
