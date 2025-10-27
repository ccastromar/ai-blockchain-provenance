'use client';

import { useState, useEffect } from 'react';
import ModelRegistration from '@/components/ModelRegistration';
import InferenceLogger from '@/components/InferenceLogger';
import ProvenanceViewer from '@/components/ProvenanceViewer';
import { getChainStats } from '@/lib/api';
import Link from 'next/link';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'register' | 'inference' | 'provenance'>('register');
  const [stats, setStats] = useState<any>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await getChainStats();
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Ernest
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                AI Provenance Blockchain POC
              </p>
            </div>

            <Link href="/models" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold">📚 Models</Link>

             <Link href="/stats" className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors"    >
                📊 Statistics
            </Link>
            
            {stats && (
              <div className="flex gap-6 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{stats.totalBlocks}</div>
                  <div className="text-gray-600 dark:text-gray-400">Blocks</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{stats.totalModels}</div>
                  <div className="text-gray-600 dark:text-gray-400">Models</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${stats.chainValid ? 'text-green-500' : 'text-red-500'}`}>
                    {stats.chainValid ? '✓' : '✗'}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">Chain Valid</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('register')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'register'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                📝 Register Model
              </button>
              <button
                onClick={() => setActiveTab('inference')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'inference'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                🔬 Log Inference
              </button>
              <button
                onClick={() => setActiveTab('provenance')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'provenance'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                🔍 View Provenance
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'register' && (
              <ModelRegistration onSuccess={() => {
                loadStats();
                setActiveTab('inference');
              }} />
            )}
            
            {activeTab === 'inference' && (
              <InferenceLogger 
                onSuccess={(modelId) => {
                  loadStats();
                  setSelectedModelId(modelId);
                  setActiveTab('provenance');
                }} 
              />
            )}
            
            {activeTab === 'provenance' && (
              <ProvenanceViewer initialModelId={selectedModelId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
