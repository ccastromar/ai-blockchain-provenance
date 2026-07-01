import { BadGatewayException, Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { IngestedEventService } from './ingested-event.service';

@Injectable()
export class IngestorProxyService {
  private readonly ingestorUrl = (process.env.EVENT_INGESTOR_URL || 'http://localhost:3011').replace(/\/$/, '');
  private readonly ingestorApiKey = process.env.EVENT_INGESTOR_API_KEY || '';
  private readonly hfWebhookSecret = process.env.HF_WEBHOOK_SECRET || '';

  constructor(private readonly ingestedEventService: IngestedEventService) {}

  getAuthStatus() {
    return {
      mode: this.ingestorApiKey ? 'shared_secret' : 'disabled/dev',
      proxiedSimulation: true,
      providerSecrets: {
        huggingface: this.hfWebhookSecret ? 'configured' : 'not_configured',
      },
    };
  }

  async getHealth() {
    const [ingestor, stats, failureStats] = await Promise.all([
      this.getIngestorReachability(),
      this.ingestedEventService.getStats(),
      this.ingestedEventService.getFailureStats(),
    ]);

    return {
      status: ingestor.reachable ? 'healthy' : 'degraded',
      ingestor,
      auth: this.getAuthStatus(),
      stats,
      failureStats,
    };
  }

  async simulateHuggingFaceEvent() {
    const runId = Date.now().toString(36);
    const headSha = `${runId.padEnd(12, 'a')}6f85eb06eee540738584589f131c`;

    return await this.postToIngestor(
      '/events/huggingface',
      {
        event: { action: 'update', scope: 'repo.content' },
        repo: {
          type: 'model',
          name: 'openai-community/gpt2',
          headSha,
          url: {
            web: 'https://huggingface.co/openai-community/gpt2',
            api: 'https://huggingface.co/api/models/openai-community/gpt2',
          },
        },
        webhook: { id: 'frontend-demo-webhook' },
      },
      this.hfWebhookSecret ? { 'X-Webhook-Secret': this.hfWebhookSecret } : {},
    );
  }

  async simulateSageMakerEvent() {
    const runId = Date.now().toString(36);
    const version = String(Date.now()).slice(-6);

    return await this.postToIngestor('/events/sagemaker', {
      id: `evt-${runId}`,
      source: 'aws.sagemaker',
      'detail-type': 'SageMaker Model Package State Change',
      account: '123456789012',
      region: 'eu-west-1',
      time: new Date().toISOString(),
      detail: {
        ModelPackageGroupName: 'credit-risk-xgb',
        ModelPackageVersion: version,
        ModelApprovalStatus: 'Approved',
        ModelPackageArn: `arn:aws:sagemaker:eu-west-1:123456789012:model-package/credit-risk-xgb/${version}`,
        ModelDataUrl: `s3://ernest-models/credit-risk-xgb/${version}/model.tar.gz`,
        ModelArtifactHash: `${runId.padEnd(64, 'b').slice(0, 64)}`,
      },
    });
  }

  private async postToIngestor(
    path: string,
    payload: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ) {
    try {
      const response = await axios.post(`${this.ingestorUrl}${path}`, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(this.ingestorApiKey ? { 'X-Ernest-Ingest-Key': this.ingestorApiKey } : {}),
          ...extraHeaders,
        },
        timeout: 5000,
      });

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string }>;
      const detail = axiosError.response?.data?.error || axiosError.message;
      throw new BadGatewayException(`Could not proxy event to ingestor: ${detail}`);
    }
  }

  private async getIngestorReachability() {
    try {
      const startedAt = Date.now();
      const response = await axios.get(`${this.ingestorUrl}/health`, { timeout: 2000 });
      return {
        reachable: true,
        status: response.data?.status || 'ok',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        reachable: false,
        status: 'unreachable',
        error: axiosError.message,
      };
    }
  }
}
