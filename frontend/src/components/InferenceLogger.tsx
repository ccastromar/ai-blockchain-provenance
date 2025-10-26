'use client';

import { useState } from 'react';
import { logInference } from '@/lib/api';
import { metadata } from '@/app/layout';

interface Props {
  onSuccess?: (modelId: string) => void;
}

export default function InferenceLogger({ onSuccess }: Props) {
  const [formData, setFormData] = useState({
    modelId: '',
    input: '',
    params: '',
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
        modelId: formData.modelId,
        input: JSON.parse(formData.input),
        params: formData.params ? JSON.parse(formData.params) : {},
        metadata: formData.metadata ? JSON.parse(formData.metadata) : {},
      };

      const response = await logInference(data);
      setResult(response);

      if (onSuccess) onSuccess(formData.modelId);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to log inference');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Log Inference</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Execute and track an AI model inference on the blockchain
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Model ID *
          </label>
          <input
            type="text"
            required
            value={formData.modelId}
            onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            placeholder="e.g., chest-xray-classifier-v1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Input Data (JSON) *
          </label>
          <textarea
            required
            value={formData.input}
            onChange={(e) => setFormData({ ...formData, input: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-sm"
            rows={5}
            placeholder='{"patient_id": "P12345", "image_url": "xray_001.jpg", "age": 45, "symptoms": ["cough", "fever"]}'
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
            placeholder='{"threshold": 0.8, "preprocessing": "normalize"}'
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
          {loading ? 'Executing...' : 'Execute & Log Inference'}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-green-900 dark:text-green-100">
            ✅ Inference Logged Successfully!
          </h3>
          
          <div className="space-y-2 text-sm text-green-800 dark:text-green-200">
            <p><strong>Inference ID:</strong> {result.inferenceId}</p>
            <p><strong>Block Index:</strong> {result.blockIndex}</p>
            <p><strong>Block Hash:</strong> <code className="text-xs break-all">{result.blockHash}</code></p>
          </div>

          <div className="border-t border-green-200 dark:border-green-700 pt-3">
            <p className="font-semibold text-green-900 dark:text-green-100 mb-2">Output:</p>
            <pre className="bg-white dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          </div>

          <div className="border-t border-green-200 dark:border-green-700 pt-3">
            <p className="font-semibold text-green-900 dark:text-green-100 mb-2">Hashes:</p>
            <div className="space-y-1 text-xs">
              <p><strong>Input Hash:</strong> <code>{result.hashes.input}</code></p>
              <p><strong>Output Hash:</strong> <code>{result.hashes.output}</code></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
