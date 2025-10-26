'use client';

import { useState, useEffect } from 'react';
import { getProvenance, verifyChain, getAllModelIds } from '@/lib/api';
import { format } from 'date-fns';

interface Props {
  initialModelId?: string;
}

export default function ProvenanceViewer({ initialModelId = '' }: Props) {
  const [modelId, setModelId] = useState(initialModelId);
  const [provenance, setProvenance] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<any>(null);
  const [modelIds, setModelIds] = useState<string[]>([]);

  useEffect(() => {
    if (initialModelId) {
      handleSearch();
    }
  }, [initialModelId]);

  useEffect(() => {
    async function fetchIds() {
      try {
        const ids = await getAllModelIds(); 
        setModelIds(ids);
      } catch {
        setModelIds([]);
      }
    }
    fetchIds();
  }, []);

  const handleSearch = async () => {
    if (!modelId.trim()) return;

    setLoading(true);
    setError(null);
    setProvenance(null);

    try {
      const data = await getProvenance(modelId);
      setProvenance(data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch provenance');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const data = await verifyChain();
      setVerification(data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to verify chain');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">View Provenance</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Query the complete audit trail of an AI model from the blockchain
        </p>
      </div>

      <div className="flex gap-3">
        <select
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          required
          className="..."
        >
          <option value="">-- Select Model --</option>
          {modelIds.map(id => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>

        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          placeholder="Enter Model ID (e.g., chest-xray-classifier-v1)"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !modelId.trim()}
          className="bg-primary hover:bg-primary/90 text-white font-medium py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
        <button
          onClick={handleVerify}
          disabled={verifying}
          className="bg-secondary hover:bg-secondary/90 text-white font-medium py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {verifying ? 'Verifying...' : 'Verify Chain'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
        </div>
      )}

      {verification && (
        <div className={`border rounded-lg p-4 ${verification.isValid
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}>
          <h3 className={`font-semibold mb-2 ${verification.isValid ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'
            }`}>
            {verification.isValid ? '✅ Chain is Valid' : '❌ Chain Verification Failed'}
          </h3>
          {verification.errors && verification.errors.length > 0 && (
            <ul className="list-disc list-inside text-sm text-red-800 dark:text-red-200">
              {verification.errors.map((err: string, i: number) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {provenance && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-3">
              📊 Provenance Summary
            </h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-blue-600 dark:text-blue-300 font-medium">Model ID</p>
                <p className="text-blue-900 dark:text-blue-100">{provenance.modelId}</p>
              </div>
              <div>
                <p className="text-blue-600 dark:text-blue-300 font-medium">Total Blocks</p>
                <p className="text-blue-900 dark:text-blue-100">{provenance.totalBlocks}</p>
              </div>
              <div>
                <p className="text-blue-600 dark:text-blue-300 font-medium">Chain Valid</p>
                <p className={`font-bold ${provenance.chainValid ? 'text-green-600' : 'text-red-600'}`}>
                  {provenance.chainValid ? '✓ Yes' : '✗ No'}
                </p>
              </div>
            </div>
          </div>

          {/* History Timeline */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
              📜 History Timeline
            </h3>
            <div className="space-y-3">
              {provenance.history.map((event: any, index: number) => (
                <div
                  key={index}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">
                        {event.type === 'model_registration' ? '📝' : '🔬'}
                      </span>
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {event.type === 'model_registration' ? 'Model Registration' : 'Inference'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {format(new Date(event.timestamp), 'PPpp')}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                      Block #{event.blockIndex}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    {event.version && (
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Version:</strong> {event.version}
                      </p>
                    )}

                    {event.metadata && (
                      <div>
                        <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Metadata:</p>
                        <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded text-xs overflow-x-auto">
                          {JSON.stringify(event.metadata, null, 2)}
                        </pre>
                      </div>
                    )}

                    {event.params && Object.keys(event.params).length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Parameters:</p>
                        <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded text-xs overflow-x-auto">
                          {JSON.stringify(event.params, null, 2)}
                        </pre>
                      </div>
                    )}

                    {(event.inputHash || event.outputHash) && (
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                        {event.inputHash && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            <strong>Input Hash:</strong> <code>{event.inputHash}</code>
                          </p>
                        )}
                        {event.outputHash && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            <strong>Output Hash:</strong> <code>{event.outputHash}</code>
                          </p>
                        )}
                      </div>
                    )}

                    <p className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
                      <strong>Block Hash:</strong> {event.blockHash}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!provenance && !loading && !error && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-lg">🔍 Enter a Model ID to view its provenance</p>
        </div>
      )}
    </div>
  );
}
