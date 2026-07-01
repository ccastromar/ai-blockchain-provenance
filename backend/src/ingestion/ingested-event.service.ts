import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventFailure, EventFailureDocument } from './event-failure.schema';
import { IngestedEvent, IngestedEventDocument } from './ingested-event.schema';

export interface IngestedEventFilters {
  status?: string;
  source?: string;
  eventType?: string;
  verificationStatus?: string;
}

export interface EventFailureFilters {
  source?: string;
  eventType?: string;
  failureKind?: string;
}

@Injectable()
export class IngestedEventService {
  constructor(
    @InjectModel(IngestedEvent.name)
    private ingestedEventModel: Model<IngestedEventDocument>,
    @InjectModel(EventFailure.name)
    private eventFailureModel: Model<EventFailureDocument>,
  ) {}

  async findAll(page = 1, limit = 20, filters: IngestedEventFilters = {}) {
    const query: Record<string, string> = {};
    if (filters.status) query.status = filters.status;
    if (filters.source) query.source = filters.source;
    if (filters.eventType) query.eventType = filters.eventType;
    if (filters.verificationStatus) query.verificationStatus = filters.verificationStatus;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.ingestedEventModel
        .find(query)
        .sort({ blockIndex: -1, receivedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.ingestedEventModel.countDocuments(query),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getStats() {
    const [total, byStatus, bySource, byEventType, byVerificationStatus, latest] = await Promise.all([
      this.ingestedEventModel.countDocuments(),
      this.ingestedEventModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.ingestedEventModel.aggregate([
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      this.ingestedEventModel.aggregate([
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      this.ingestedEventModel.aggregate([
        { $group: { _id: '$verificationStatus', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.ingestedEventModel.findOne().sort({ blockIndex: -1, receivedAt: -1, _id: -1 }).lean(),
    ]);

    return {
      total,
      byStatus: this.toCountMap(byStatus),
      bySource: this.toCountMap(bySource),
      byEventType: this.toCountMap(byEventType),
      byVerificationStatus: this.toCountMap(byVerificationStatus),
      latest,
    };
  }

  async findFailures(page = 1, limit = 20, filters: EventFailureFilters = {}) {
    const query: Record<string, string> = {};
    if (filters.source) query.source = filters.source;
    if (filters.eventType) query.eventType = filters.eventType;
    if (filters.failureKind) query.failureKind = filters.failureKind;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.eventFailureModel
        .find(query)
        .sort({ failedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.eventFailureModel.countDocuments(query),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getFailureStats() {
    const [total, bySource, byEventType, byFailureKind, byAuthFailureType, latest] = await Promise.all([
      this.eventFailureModel.countDocuments(),
      this.eventFailureModel.aggregate([
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      this.eventFailureModel.aggregate([
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      this.eventFailureModel.aggregate([
        { $group: { _id: '$failureKind', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.eventFailureModel.aggregate([
        { $group: { _id: '$authFailureType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.eventFailureModel.findOne().sort({ failedAt: -1, _id: -1 }).lean(),
    ]);

    return {
      total,
      bySource: this.toCountMap(bySource),
      byEventType: this.toCountMap(byEventType),
      byFailureKind: this.toCountMap(byFailureKind),
      byAuthFailureType: this.toCountMap(byAuthFailureType),
      latest,
    };
  }

  private toCountMap(rows: Array<{ _id: string; count: number }>) {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row._id || 'unknown'] = row.count;
      return acc;
    }, {});
  }
}
