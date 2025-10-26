'use client';

import { useState, useEffect } from 'react';
import { getChainStats, verifyChain } from '@/lib/api';
import { format } from 'date-fns';
import Link from 'next/link';

export default function StatsPage() {
  const [stats, setStats] = useState<any>(null);
  const [verification, setVerification] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadStats = async () => {
    try {
      const [statsData, verifyData] = await Promise.all([
        getChainStats(),
        verifyChain()
      ]);
      setStats(statsData);
      setVerification(verifyData);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadStats();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
        <div className="text-white text-2xl">Loading statistics...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-teal-500">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                AITrace Statistics
              </h1>
              <p className="text-gray-600 text-lg">
                Real-time blockchain chain monitoring dashboard
              </p>
            </div>
            <Link 
              href="/"
              className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              ← Back to App
            </Link>
          </div>
          
          <div className="flex items-center gap-4 mt-6">
            <button
              onClick={loadStats}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
            >
              🔄 Refresh Now
            </button>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-5 h-5 text-blue-600 rounded"
              />
              <span className="text-gray-700 font-medium">Auto-refresh (10s)</span>
            </label>
            
            <div className="ml-auto text-sm text-gray-500">
              Last updated: {format(new Date(), 'PPpp')}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Total Blocks */}
          <div className="bg-white rounded-2xl shadow-xl p-8 transform hover:scale-105 transition-transform">
            <div className="text-6xl mb-4">📦</div>
            <div className="text-5xl font-bold text-gray-900 mb-2">
              {stats?.totalBlocks || 0}
            </div>
            <div className="text-gray-600 uppercase tracking-wide font-semibold">
              Total Blocks
            </div>
            <div className="mt-4 text-sm text-gray-500">
              Including genesis block
            </div>
          </div>

          {/* Total Models */}
          <div className="bg-white rounded-2xl shadow-xl p-8 transform hover:scale-105 transition-transform">
            <div className="text-6xl mb-4">🤖</div>
            <div className="text-5xl font-bold text-gray-900 mb-2">
              {stats?.totalModels || 0}
            </div>
            <div className="text-gray-600 uppercase tracking-wide font-semibold">
              AI Models
            </div>
            <div className="mt-4 text-sm text-gray-500">
              Registered in the chain
            </div>
          </div>

          {/* Last Block */}
          <div className="bg-white rounded-2xl shadow-xl p-8 transform hover:scale-105 transition-transform">
            <div className="text-6xl mb-4">🔗</div>
            <div className="text-5xl font-bold text-gray-900 mb-2">
              {stats?.lastBlockIndex || 0}
            </div>
            <div className="text-gray-600 uppercase tracking-wide font-semibold">
              Last Block Index
            </div>
            <div className="mt-4 text-sm text-gray-500">
              Current chain height
            </div>
          </div>
        </div>

        {/* Chain Status */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="flex items-start gap-6">
            <div className="text-8xl">
              {verification?.isValid ? '✅' : '❌'}
            </div>
            
            <div className="flex-1">
              <h2 className="text-3xl font-bold text-gray-900 mb-3">
                Chain Integrity Status
              </h2>
              
              <div className={`inline-block px-6 py-3 rounded-full text-lg font-bold ${
                verification?.isValid 
                  ? 'bg-green-100 text-green-800 border-2 border-green-300' 
                  : 'bg-red-100 text-red-800 border-2 border-red-300'
              }`}>
                {verification?.isValid ? '✓ VALID - Chain is secure and immutable' : '✗ INVALID - Chain integrity compromised'}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-2">Last Block Hash</div>
                  <div className="text-xs font-mono text-gray-900 break-all">
                    {stats?.lastBlockHash || 'N/A'}
                  </div>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-2">Last Block Timestamp</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {stats?.lastBlockTimestamp 
                      ? format(new Date(stats.lastBlockTimestamp), 'PPpp')
                      : 'N/A'
                    }
                  </div>
                </div>
              </div>

              {verification?.errors && verification.errors.length > 0 && (
                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6 mt-6">
                  <h3 className="text-lg font-bold text-yellow-900 mb-3 flex items-center gap-2">
                    <span className="text-2xl">⚠️</span>
                    Verification Errors Detected
                  </h3>
                  <ul className="space-y-2">
                    {verification.errors.map((err: string, i: number) => (
                      <li key={i} className="text-yellow-800 flex items-start gap-2">
                        <span className="text-yellow-600 mt-1">•</span>
                        <span>{err}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Chain Metrics */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h3 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <span className="text-3xl">📊</span>
              Chain Metrics
            </h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-gray-200">
                <span className="text-gray-600">Average Block Size</span>
                <span className="font-bold text-gray-900">
                  {stats?.totalBlocks > 1 
                    ? `~${Math.round(stats.totalBlocks / (stats.totalModels || 1))} events/model`
                    : 'N/A'
                  }
                </span>
              </div>
              
              <div className="flex justify-between items-center py-3 border-b border-gray-200">
                <span className="text-gray-600">Chain Growth Rate</span>
                <span className="font-bold text-gray-900">
                  {stats?.totalBlocks > 1 ? 'Active' : 'Starting'}
                </span>
              </div>
              
              <div className="flex justify-between items-center py-3">
                <span className="text-gray-600">Verification Status</span>
                <span className={`font-bold ${verification?.isValid ? 'text-green-600' : 'text-red-600'}`}>
                  {verification?.isValid ? 'Passing' : 'Failing'}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h3 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <span className="text-3xl">⚡</span>
              Quick Actions
            </h3>
            
            <div className="space-y-3">
              <Link 
                href="/"
                className="block w-full bg-purple-600 hover:bg-purple-700 text-white text-center py-3 px-4 rounded-lg font-semibold transition-colors"
              >
                📝 Register New Model
              </Link>
              
              <Link 
                href="/?tab=inference"
                className="block w-full bg-blue-600 hover:bg-blue-700 text-white text-center py-3 px-4 rounded-lg font-semibold transition-colors"
              >
                🔬 Log Inference
              </Link>
              
              <Link 
                href="/?tab=provenance"
                className="block w-full bg-teal-600 hover:bg-teal-700 text-white text-center py-3 px-4 rounded-lg font-semibold transition-colors"
              >
                🔍 View Provenance
              </Link>
              
              <a 
                href="http://localhost:3001/api/stats"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full bg-gray-600 hover:bg-gray-700 text-white text-center py-3 px-4 rounded-lg font-semibold transition-colors"
              >
                📄 View Raw JSON
              </a>
            </div>
          </div>
        </div>

         {/* 👉 Anchor Info aquí 👇 */}
      <div className="bg-blue-50 rounded-xl p-6 shadow mt-6">
        <h2 className="font-semibold text-lg text-blue-800 mb-2">
          Blockchain Anchor (Ethereum)
        </h2>
        {stats.lastAnchor ? (
          <ul className="text-sm space-y-2">
            <li><strong>Anchored at block:</strong> {stats.lastAnchor.blockNumber}</li>
            <li><strong>Last Block Index:</strong> {stats.lastAnchor.lastBlockIndex}</li>
            <li><strong>Anchor Time:</strong> {new Date(stats.lastAnchor.anchoredAt).toLocaleString()}</li>
            <li>
              <strong>Merkle Root:</strong>
              <code className="block bg-white text-xs p-2 rounded mt-1 break-all">{stats.lastAnchor.merkleRoot}</code>
            </li>
            <li>
              <strong>Tx Hash:</strong>
              <a href={stats.lastAnchor.etherscanUrl}
                 className="text-blue-700 underline break-all"
                 target="_blank" rel="noopener noreferrer"
              >{stats.lastAnchor.txHash}</a>
            </li>
            <li>
              <strong>Chain ID:</strong> {stats.lastAnchor.chainId}
            </li>
            <li><strong>Status:</strong> {stats.lastAnchor.status}</li>
          </ul>
        ) : (
          <div className="text-gray-500">
            No anchor found. The system has not yet anchored the chain state in Ethereum.
          </div>
        )}
      </div>

      </div>
    </div>
  );
}
