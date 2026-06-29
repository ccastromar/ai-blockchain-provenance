import axios, { type AxiosError } from 'axios';
import { env } from '$env/dynamic/public';

const apiUrl = env.PUBLIC_API_URL || 'http://localhost:3001';
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

// ── Provenances ────────────────────────────────────────────────────────────

export const getProvenance = async (modelId: string, filters?: ProvenanceFilter) =>
  (await api.get(`/provenances/${modelId}`, { params: filters })).data;

export const exportProvenance = (modelId: string) =>
  `${apiUrl}/api/provenances/${modelId}/export`;

// ── Chain ──────────────────────────────────────────────────────────────────

export const getChainStats = async () => (await api.get('/stats')).data;
export const verifyChain   = async () => (await api.get('/verify')).data;
export const logInference  = async (data: LogInferenceData) =>
  (await api.post('/inferences', data)).data;

// ── Health ─────────────────────────────────────────────────────────────────

export const getHealth = async (): Promise<HealthStatus> =>
  (await axios.get(`${apiUrl}/health`)).data;
