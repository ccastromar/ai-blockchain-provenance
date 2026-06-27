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

  async findAll(page = 1, limit = 20, organizationId?: string) {
    const filter = organizationId ? { organizationId } : {};
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.aimodelModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.aimodelModel.countDocuments(filter),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
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

  async remove(modelId: string): Promise<{ acknowledged: boolean; deletedCount: number }> {
    const result = await this.aimodelModel.deleteOne({ modelId }).exec();
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.deletedCount,
    };
  }
}
