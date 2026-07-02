import axios, { type AxiosError } from 'axios';
import { env } from '$env/dynamic/public';

const configuredApiUrl = env.PUBLIC_API_URL ?? '';
const apiUrl = configuredApiUrl === 'http://localhost:3001' ? '' : configuredApiUrl;
const apiKey = env.PUBLIC_ERNEST_API_KEY || undefined;

const api = axios.create({
  baseURL: `${apiUrl}/api`,
  headers: {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-Ernest-Api-Key': apiKey } : {})
  }
});

// Surface rate-limit errors clearly
api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 429) {
      const e = new Error('Too many requests — please wait a moment and try again.');
      (e as any).isRateLimit = true;
      return Promise.reject(e);
    }
    return Promise.reject(err);
  }
);

// ── Types ──────────────────────────────────────────────────────────────────

export interface RegisterModelData {
  modelId: string;
  modelName: string;
  version: string;
  modelPath?: string;
  mlflow: { modelHash: string; gitCommit: string };
  params?: Record<string, unknown>;
  metrics?: Record<string, number>;
  metadata?: Record<string, unknown>;
}

export interface LogInferenceData {
  modelId: string;
  inferenceId: string;
  inputHash: string;
  outputHash: string;
  params?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type ModelStatus = 'active' | 'deprecated' | 'archived';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ProvenanceFilter {
  type?: 'model_registration' | 'inference';
  from?: string;   // ISO date
  to?: string;     // ISO date
}

export interface HealthStatus {
  status: string;
  services?: {
    mongodb?: { status: string; latencyMs?: number };
    ethereum?: { status: string; blockNumber?: number };
    anchor?:   { status: string; lastRun?: string };
  };
}

export interface IngestedEventFilters {
  status?: string;
  source?: string;
  eventType?: string;
  verificationStatus?: string;
}

// ── Models ─────────────────────────────────────────────────────────────────

export const registerModel = async (data: RegisterModelData) =>
  (await api.post('/models', data)).data;

export const getModels = async (page = 1, limit = 20): Promise<PaginatedResponse<any>> => {
  const res = (await api.get('/models', { params: { page, limit } })).data;
  // Backend returns { items, total, page, limit, totalPages }
  if (Array.isArray(res)) return { data: res, total: res.length, page: 1, totalPages: 1 };
  if (res.items)          return { data: res.items, total: res.total, page: res.page, totalPages: res.totalPages };
  return res; // fallback if backend ever switches to { data }
};

export const getAllModels = async (): Promise<any[]> => {
  const res = (await api.get('/models')).data;
  if (Array.isArray(res)) return res;
  return res.items ?? res.data ?? [];
};

export const getModelById = async (modelId: string) =>
  (await api.get(`/models/${modelId}`)).data;

export const getAllModelIds = async () =>
  (await api.get('/models/ids')).data;

export const patchModel = async (modelId: string, status: ModelStatus) =>
  (await api.patch(`/models/${modelId}/status`, { status })).data;

export const getModelIntegrity = async (modelId: string) =>
  (await api.get(`/models/${modelId}/integrity`)).data;

// ── Event ingestion ────────────────────────────────────────────────────────

export const getIngestedEvents = async (
  page = 1,
  limit = 20,
  filters: IngestedEventFilters = {}
): Promise<PaginatedResponse<any>> => {
  const res = (await api.get('/ingested-events', { params: { page, limit, ...filters } })).data;
  if (Array.isArray(res)) return { data: res, total: res.length, page: 1, totalPages: 1 };
  if (res.items) return { data: res.items, total: res.total, page: res.page, totalPages: res.totalPages };
  return res;
};

export const getIngestedEventStats = async () =>
  (await api.get('/ingested-events/stats')).data;

export const getEventFailures = async (
  page = 1,
  limit = 20,
  filters: Pick<IngestedEventFilters, 'source' | 'eventType'> = {}
): Promise<PaginatedResponse<any>> => {
  const res = (await api.get('/ingested-events/failures', { params: { page, limit, ...filters } })).data;
  if (Array.isArray(res)) return { data: res, total: res.length, page: 1, totalPages: 1 };
  if (res.items) return { data: res.items, total: res.total, page: res.page, totalPages: res.totalPages };
  return res;
};

export const getEventFailureStats = async () =>
  (await api.get('/ingested-events/failures/stats')).data;

export const getIngestorAuthStatus = async () =>
  (await api.get('/ingestor/auth')).data;

export const getIngestorHealth = async () =>
  (await api.get('/ingestor/health')).data;

export const simulateHuggingFaceEvent = async () =>
  (await api.post('/ingestor/simulate/huggingface')).data;

export const simulateSageMakerEvent = async () =>
  (await api.post('/ingestor/simulate/sagemaker')).data;

export const simulateAzureMlEvent = async () =>
  (await api.post('/ingestor/simulate/azureml')).data;

export const simulateCloudEventsEvent = async () =>
  (await api.post('/ingestor/simulate/cloudevents')).data;

export const simulateDatabricksEvent = async () =>
  (await api.post('/ingestor/simulate/databricks')).data;

export const simulateVertexAiEvent = async () =>
  (await api.post('/ingestor/simulate/vertexai')).data;

export const simulateOpenLineageEvent = async () =>
  (await api.post('/ingestor/simulate/openlineage')).data;

export const simulateOpenTelemetryLogs = async () =>
  (await api.post('/ingestor/simulate/opentelemetry')).data;

// ── Provenances ────────────────────────────────────────────────────────────

export const getProvenance = async (modelId: string, filters?: ProvenanceFilter) =>
  (await api.get('/provenances', { params: { modelId, ...filters } })).data;

export const exportProvenance = (modelId: string) =>
  `${apiUrl}/api/provenances/${modelId}/export`;

export const exportProvenanceCycloneDx = (modelId: string) =>
  `${apiUrl}/api/provenances/${modelId}/export/cyclonedx`;

// ── Chain ──────────────────────────────────────────────────────────────────

export const getChainStats = async () => (await api.get('/stats')).data;
export const verifyChain   = async () => (await api.get('/verify')).data;
export const getBlockByIndex = async (index: number) => (await api.get(`/blocks/${index}`)).data;

export const getAllBlocks = async (page = 1, limit = 20): Promise<PaginatedResponse<any>> => {
  const res = (await api.get('/blocks', { params: { page, limit } })).data;
  if (Array.isArray(res)) return { data: res, total: res.length, page: 1, totalPages: 1 };
  if (res.items)          return { data: res.items, total: res.total, page: res.page, totalPages: res.totalPages };
  return res;
};
export const logInference  = async (data: LogInferenceData) =>
  (await api.post('/inferences', data)).data;

export const seedDemoData = async () =>
  (await api.post('/demo/seed')).data;

// ── Health ─────────────────────────────────────────────────────────────────

export const getHealth = async (): Promise<HealthStatus> =>
  (await axios.get(`${apiUrl}/health`)).data;
