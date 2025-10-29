import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AIModel, AIModelDocument } from './aimodel.schema';
import { Model } from 'mongoose';

@Injectable()
export class AIModelService {
  private readonly logger = new Logger(AIModelService.name);
  
  constructor(
    @InjectModel(AIModel.name) 
    private aimodelModel: Model<AIModelDocument>,       
  ) {}

  async create(data: Partial<AIModelDocument>) {
    return await this.aimodelModel.create(data);
  }

  async findAll() {
    return await this.aimodelModel.find().sort({ createdAt: -1 }).lean();
  }

  async findOne(modelId: string) {
    this.logger.log(`Finding model with ID: ${modelId}`);
    return await this.aimodelModel.findOne({ modelId }).lean();
  }

  async findOneByName(modelName: string, version:string) {
    this.logger.log(`Finding model with name: ${modelName}`);
    return await this.aimodelModel.findOne({ name:modelName, version }).lean();
  }

  async update(modelId: string, update: Partial<AIModelDocument>) {
    return await this.aimodelModel.findOneAndUpdate({ modelId }, update, { new: true }).lean();
  }

  async remove(modelId: string) {
    return await this.aimodelModel.deleteOne({ modelId });
  }
}
