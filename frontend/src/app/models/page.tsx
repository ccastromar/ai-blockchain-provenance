'use client';

import { useEffect, useState } from 'react';
import { getAllModels, getModelById, getProvenance } from '@/lib/api';
import Link from 'next/link';

export default function ModelsMasterDetail() {
  const [models, setModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<any | null>(null);
  const [provenance, setProvenance] = useState<any | null>(null);

  useEffect(() => {
    getAllModels().then(setModels);
  }, []);

  useEffect(() => {
    if (selectedModelId) {
      getModelById(selectedModelId).then(setSelectedModel);
      getProvenance(selectedModelId).then(setProvenance);
    }
  }, [selectedModelId]);

  return (
    <div className="max-w-5xl mx-auto mt-12">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-block bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </div>  
      <h1 className="text-3xl font-bold mb-6">AI Models (Master-Detail)</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Master list */}
        <div>
          <h2 className="text-xl font-medium mb-4">Models</h2>
          <ul className="bg-white rounded-lg shadow divide-y divide-gray-200">
            {models.map(m => (
              <li key={m.modelId} className="px-6 py-4 cursor-pointer hover:bg-blue-50"
                  onClick={() => setSelectedModelId(m.modelId)}>
                <strong>{m.modelId}</strong> &mdash; {m.name || <span>No Name</span>}
                <span className="ml-3 text-sm text-gray-500">v{m.version}</span>
              </li>
            ))}
            {models.length === 0 && (
              <li className="px-6 py-4 text-gray-400 text-center">No models registered yet.</li>
            )}
          </ul>
        </div>
        {/* Detail panel */}
        <div>
          {selectedModel ? (
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold mb-2">
                Details for <span className="text-blue-600">{selectedModel.modelId}</span>
              </h2>
              <div className="mb-1 text-sm">Name: <strong>{selectedModel.name}</strong></div>
              <div className="mb-1 text-sm">Version: <strong>{selectedModel.version}</strong></div>
              <div className="mb-1 text-sm">Parameters:</div>
              <pre className="bg-gray-50 mb-2 p-2 rounded text-xs">{JSON.stringify(selectedModel.parameters, null, 2)}</pre>
              <div className="mb-1 text-sm">Metrics:</div>
              <pre className="bg-gray-50 mb-2 p-2 rounded text-xs">{JSON.stringify(selectedModel.metrics, null, 2)}</pre>
              <div className="mb-1 text-sm">Metadata:</div>
              <pre className="bg-gray-50 mb-2 p-2 rounded text-xs">{JSON.stringify(selectedModel.metadata, null, 2)}</pre>
              {/* Provenance panel */}
              {provenance &&
                <div className="mt-6 border-t pt-4">
                  <div className="font-semibold mb-2 text-blue-800">Blockchain Provenance:</div>
                  <ul className="list-disc list-inside">
                    {provenance.history.map((block: any) => (
                      <li key={block.blockIndex} className="text-xs">
                        #{block.blockIndex} • {block.type} @ {block.timestamp}
                        <br />
                        <span className="text-gray-500">Block hash: {block.blockHash.substring(0, 16)}...</span>
                      </li>
                    ))}
                  </ul>
                </div>
              }
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-6 text-gray-400 text-center">Select a model to view details & provenance.</div>
          )}
        </div>
      </div>
    </div>
  );
}
