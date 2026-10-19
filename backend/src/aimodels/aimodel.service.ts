import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AIModel, AIModelDocument } from './aimodel.schema';
import { ModelKind, ModelSort } from '../common/dto/model-list-query.dto';

/** metadata.kind of a governance register (a record stream owned by another system). */
export const REGISTER_KIND = 'governance-register';
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

  /**
   * Paginated model list. `kind` separates AI systems and models from governance registers
   * (a stream of records owned by another system, e.g. Prudence's incidents, marked
   * metadata.kind = governance-register). Sorting happens here, not in the browser, because
   * the list is paginated: risk and governed rank on computed fields.
   */
  async findAll(page = 1, limit = 20, organizationId?: string, sort: ModelSort = 'recent', kind: ModelKind = 'all') {
    const filter: Record<string, any> = organizationId ? { organizationId } : {};
    if (kind === 'records') filter['metadata.kind'] = REGISTER_KIND;
    if (kind === 'models') filter['metadata.kind'] = { $ne: REGISTER_KIND };
    const skip = (page - 1) * limit;

    const query =
      sort === 'risk' || sort === 'governed'
        ? this.aimodelModel.aggregate([
            { $match: filter },
            {
              $addFields: {
                _riskRank: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$governance.riskTier', 'PROHIBITED'] }, then: 0 },
                      { case: { $eq: ['$governance.riskTier', 'HIGH'] }, then: 1 },
                      { case: { $eq: ['$governance.riskTier', 'LIMITED'] }, then: 2 },
                      { case: { $eq: ['$governance.riskTier', 'MINIMAL'] }, then: 3 },
                    ],
                    default: 4,
                  },
                },
                _governedRank: { $cond: [{ $ifNull: ['$governance.systemOfRecord', false] }, 0, 1] },
              },
            },
            { $sort: sort === 'risk' ? { _riskRank: 1, name: 1, _id: 1 } : { _governedRank: 1, name: 1, _id: 1 } },
            { $skip: skip },
            { $limit: limit },
            { $project: { _riskRank: 0, _governedRank: 0 } },
          ])
        : this.aimodelModel
            .find(filter)
            .sort(
              sort === 'name'
                ? { name: 1, modelId: 1 }
                : sort === 'activity'
                  ? { updatedAt: -1, _id: -1 }
                  : { createdAt: -1, _id: -1 },
            )
            .skip(skip)
            .limit(limit)
            .lean();

    const [items, total] = await Promise.all([query, this.aimodelModel.countDocuments(filter)]);
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

  async remove(modelId: string, version?: string): Promise<{ acknowledged: boolean; deletedCount: number }> {
    // Version narrows the delete to one (modelId, version) document -- the unique key --
    // so compensating a failed v2 registration cannot take out v1's record.
    const result = await this.aimodelModel.deleteOne(version !== undefined ? { modelId, version } : { modelId }).exec();
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.deletedCount,
    };
  }
}
