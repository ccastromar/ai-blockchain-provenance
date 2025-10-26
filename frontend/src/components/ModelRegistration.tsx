'use client';

import { useState } from 'react';
import { registerModel } from '@/lib/api';

interface Props {
  onSuccess?: () => void;
}

export default function ModelRegistration({ onSuccess }: Props) {
  const [formData, setFormData] = useState({
    modelName: '',
    version: '1.0.0',
    params: '',
    metrics: '',
    metadata: '',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = {
        modelName: formData.modelName,
        version: formData.version,
        params: formData.params ? JSON.parse(formData.params) : {},
        metrics: formData.metrics ? JSON.parse(formData.metrics) : {},
        metadata: formData.metadata ? JSON.parse(formData.metadata) : {},
      };

      const response = await registerModel(data);
      setResult(response);
      
      // Reset form
      setFormData({
        modelName: '',
        version: '1.0.0',
        params: '',
        metrics: '',
        metadata: '',
      });

      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to register model');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Register AI Model</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Register a new AI model in the blockchain for provenance tracking
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Model Name *
          </label>
          <input
            type="text"
            required
            value={formData.modelName}
            onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            placeholder="e.g., chest-xray-classifier-v1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Version *
          </label>
          <input
            type="text"
            required
            value={formData.version}
            onChange={(e) => setFormData({ ...formData, version: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            placeholder="e.g., 1.0.0"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Parameters (JSON)
          </label>
          <textarea
            value={formData.params}
            onChange={(e) => setFormData({ ...formData, params: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-sm"
            rows={3}
            placeholder='{"learning_rate": 0.001, "epochs": 50, "batch_size": 32}'
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Metrics (JSON)
          </label>
          <textarea
            value={formData.metrics}
            onChange={(e) => setFormData({ ...formData, metrics: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-sm"
            rows={3}
            placeholder='{"accuracy": 0.95, "f1_score": 0.93, "auc": 0.97}'
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Metadata (JSON)
          </label>
          <textarea
            value={formData.metadata}
            onChange={(e) => setFormData({ ...formData, metadata: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-sm"
            rows={3}
            placeholder='{"dataset": "ChestX-ray14", "framework": "TensorFlow", "author": "Dr. Smith"}'
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Registering...' : 'Register Model'}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <h3 className="font-semibold text-green-900 dark:text-green-100 mb-2">
            ✅ Model Registered Successfully!
          </h3>
          <div className="space-y-1 text-sm text-green-800 dark:text-green-200">
            <p><strong>Model ID:</strong> {result.modelId}</p>
            <p><strong>Block Index:</strong> {result.blockIndex}</p>
            <p><strong>Block Hash:</strong> <code className="text-xs">{result.blockHash}</code></p>
          </div>
        </div>
      )}
    </div>
  );
}
