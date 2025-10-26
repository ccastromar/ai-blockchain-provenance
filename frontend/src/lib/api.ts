import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface RegisterModelData {
  modelName: string;
  version: string;
  modelPath?: string;
  params?: Record<string, any>;
  metrics?: Record<string, number>;
  metadata?: Record<string, any>;
}

export interface LogInferenceData {
  modelId: string;
  input: any;
  params?: Record<string, any>;
}

export const registerModel = async (data: RegisterModelData) => {
  const response = await api.post('/models', data);
  return response.data;
};

export const logInference = async (data: LogInferenceData) => {
  const response = await api.post('/inference', data);
  return response.data;
};

export const getProvenance = async (modelId: string) => {
  const response = await api.get(`/provenance/${modelId}`);
  return response.data;
};

export const getChainStats = async () => {
  const response = await api.get('/stats');
  return response.data;
};

export const verifyChain = async () => {
  const response = await api.get('/verify');
  return response.data;
};

export const getAllModels = async () => {
  const response = await api.get('/models');
  //console.log('Fetched models:', response.data);
  return response.data; // [{ modelId, name, version, ... }]
};

export const getModelById = async (modelId: string) => {
  const response = await api.get(`/models/${modelId}`);
  return response.data;
};

export const getAllModelIds = async () => {
  const response = await api.get('/models/ids');
  return response.data;
};

