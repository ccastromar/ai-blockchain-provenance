<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { format } from 'date-fns';
  import { getChainStats, verifyChain, getHealth } from '$lib/api';

  let stats        = $state<any>(null);
  let verification = $state<any>(null);
  let health       = $state<any>(null);
  let loading      = $state(true);
  let autoRefresh  = $state(true);
  let interval: ReturnType<typeof setInterval> | null = null;

  async function loadStats() {
    try {
      [stats, verification, health] = await Promise.all([getChainStats(), verifyChain(), getHealth()]);
    } catch (e) {
      console.error('Error loading stats:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (interval) clearInterval(interval);
    if (autoRefresh) interval = setInterval(loadStats, 10000);
    return () => { if (interval) clearInterval(interval); };
  });

  onMount(() => { loadStats(); });
  onDestroy(() => { if (interval) clearInterval(interval); });
</script>

<!-- Dark navy header bar -->
<div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4">
  <div class="max-w-7xl mx-auto flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a href="/" class="btn-ghost text-sm py-1.5 px-3">← Dashboard</a>
      <div>
        <h1 class="text-white font-bold text-lg leading-tight">Chain Statistics</h1>
        <p class="text-blue-300 text-xs">Real-time blockchain monitoring</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <button onclick={loadStats} class="btn-ghost text-sm py-1.5 px-3">🔄 Refresh</button>
      <label class="flex items-center gap-2 cursor-pointer text-sm text-blue-200">
        <input type="checkbox" bind:checked={autoRefresh} class="w-4 h-4 accent-sky-400" />
        Auto (10s)
      </label>
      <span class="text-xs text-blue-400 hidden sm:block">
        {format(new Date(), 'HH:mm:ss')}
      </span>
    </div>
  </div>
</div>

{#if loading}
  <div class="min-h-[60vh] flex items-center justify-center">
    <div class="text-center">
      <div class="w-10 h-10 border-4 border-blue-200 border-t-blue-700 rounded-full animate-spin mx-auto mb-4"></div>
      <p class="text-slate-500 text-sm">Loading statistics…</p>
    </div>
  </div>
{:else}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

    <!-- KPI Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
      {#each [
        { icon: '📦', value: stats?.totalBlocks ?? 0,      label: 'Total Blocks',     sub: 'Including genesis block' },
        { icon: '🤖', value: stats?.totalModels ?? 0,      label: 'AI Models',        sub: 'Registered in the chain' },
        { icon: '🔗', value: stats?.lastBlockIndex ?? 0,   label: 'Last Block Index', sub: 'Current chain height' }
      ] as kpi}
        <div class="card p-6 border-t-4 border-blue-700">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-3xl font-bold text-blue-700">{kpi.value}</div>
              <div class="text-sm font-semibold text-slate-700 mt-1">{kpi.label}</div>
              <div class="text-xs text-slate-400 mt-0.5">{kpi.sub}</div>
            </div>
            <span class="text-2xl opacity-60">{kpi.icon}</span>
          </div>
        </div>
      {/each}
    </div>

    <!-- Chain integrity -->
    <div class="card p-6">
      <div class="flex items-center gap-4">
        <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl flex-shrink-0
          {verification?.isValid ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}">
          {verification?.isValid ? '✓' : '✗'}
        </div>
        <div class="flex-1">
          <h2 class="font-semibold text-slate-800">Chain Integrity</h2>
          <span class="inline-block mt-1 px-3 py-1 rounded-full text-sm font-medium
            {verification?.isValid
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-red-100 text-red-700'}">
            {verification?.isValid ? 'VALID — Chain is secure and immutable' : 'INVALID — Chain integrity compromised'}
          </span>
        </div>
        {#if stats?.lastBlockTimestamp}
          <div class="text-right hidden sm:block">
            <div class="text-xs text-slate-400">Last block</div>
            <div class="text-sm font-medium text-slate-700">{format(new Date(stats.lastBlockTimestamp), 'dd MMM HH:mm')}</div>
          </div>
        {/if}
      </div>

      {#if stats?.lastBlockHash}
        <div class="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div class="text-xs text-slate-500 mb-1">Last Block Hash</div>
          <div class="font-mono text-xs text-slate-700 break-all">{stats.lastBlockHash}</div>
        </div>
      {/if}

      {#if verification?.errors?.length}
        <div class="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 class="text-sm font-semibold text-amber-800 mb-2">⚠️ Verification Errors</h3>
          <ul class="space-y-1">
            {#each verification.errors as err}
              <li class="text-sm text-amber-700">• {err}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <!-- Health check -->
    {#if health}
      {@const services = health.services ?? {}}
      <div class="card p-6">
        <h3 class="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span class="text-blue-600">🩺</span> Service Health
          <span class="ml-auto text-xs font-normal px-2 py-1 rounded-full
            {health.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
            {health.status}
          </span>
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {#each [
            { key: 'mongodb',  label: 'MongoDB',       icon: '🗄️' },
            { key: 'ethereum', label: 'Ethereum RPC',  icon: '⛓️' },
            { key: 'anchor',   label: 'Anchor Cron',   icon: '⏱️' }
          ] as svc}
            {@const s = services[svc.key]}
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div class="flex items-center gap-2 mb-2">
                <span>{svc.icon}</span>
                <span class="text-sm font-medium text-slate-700">{svc.label}</span>
                <span class="ml-auto w-2 h-2 rounded-full {s?.status === 'ok' ? 'bg-emerald-400' : s ? 'bg-red-400' : 'bg-slate-300'}"></span>
              </div>
              {#if s}
                <div class="text-xs text-slate-500 space-y-0.5">
                  {#if s.latencyMs != null}<div>Latency: {s.latencyMs}ms</div>{/if}
                  {#if s.blockNumber  != null}<div>Block: #{s.blockNumber}</div>{/if}
                  {#if s.lastRun}<div>Last run: {s.lastRun}</div>{/if}
                </div>
              {:else}
                <div class="text-xs text-slate-400">No data</div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- Chain metrics -->
      <div class="card p-6">
        <h3 class="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span class="text-blue-600">📊</span> Chain Metrics
        </h3>
        <dl class="space-y-3">
          {#each [
            {
              label: 'Average events / model',
              value: stats?.totalBlocks > 1
                ? `${Math.round(stats.totalBlocks / (stats.totalModels || 1))}`
                : 'N/A'
            },
            {
              label: 'Chain growth',
              value: stats?.totalBlocks > 1 ? 'Active' : 'Starting'
            },
            {
              label: 'Verification',
              value: verification?.isValid ? 'Passing' : 'Failing',
              color: verification?.isValid ? 'text-emerald-600' : 'text-red-600'
            }
          ] as row}
            <div class="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-0">
              <dt class="text-sm text-slate-500">{row.label}</dt>
              <dd class="text-sm font-semibold {row.color ?? 'text-slate-800'}">{row.value}</dd>
            </div>
          {/each}
        </dl>
      </div>

      <!-- Quick actions -->
      <div class="card p-6">
        <h3 class="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span class="text-blue-600">⚡</span> Quick Actions
        </h3>
        <div class="space-y-2.5">
          <a href="/" class="flex items-center gap-2 btn-primary w-full justify-center text-sm">
            📝 Register New Model
          </a>
          <a href="/?tab=inference" class="flex items-center gap-2 btn-secondary w-full justify-center text-sm">
            🔬 Log Inference
          </a>
          <a href="/?tab=provenance" class="flex items-center gap-2 btn-outline w-full justify-center text-sm">
            🔍 View Provenance
          </a>
          <a href="http://localhost:3001/api/stats" target="_blank" rel="noopener noreferrer"
            class="flex items-center gap-2 btn-outline w-full justify-center text-sm">
            📄 Raw JSON API
          </a>
        </div>
      </div>
    </div>

    <!-- Ethereum anchor -->
    <div class="card p-6">
      <h3 class="font-semibold text-slate-700 mb-4 flex items-center gap-2">
        <span class="text-blue-600">⛓️</span> Blockchain Anchor <span class="text-xs font-normal text-slate-400 ml-1">(Ethereum)</span>
      </h3>
      {#if stats?.lastAnchor}
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {#each [
            { label: 'Block number',    value: stats.lastAnchor.blockNumber },
            { label: 'Last block idx',  value: stats.lastAnchor.lastBlockIndex },
            { label: 'Anchor time',     value: new Date(stats.lastAnchor.anchoredAt).toLocaleString() },
            { label: 'Chain ID',        value: stats.lastAnchor.chainId },
            { label: 'Status',          value: stats.lastAnchor.status }
          ] as item}
            <div>
              <dt class="text-xs text-slate-400 uppercase tracking-wider mb-0.5">{item.label}</dt>
              <dd class="font-medium text-slate-700">{item.value}</dd>
            </div>
          {/each}
          <div class="sm:col-span-2">
            <dt class="text-xs text-slate-400 uppercase tracking-wider mb-1">Merkle Root</dt>
            <dd class="font-mono text-xs bg-slate-50 border border-slate-200 rounded p-2 break-all text-slate-600">
              {stats.lastAnchor.merkleRoot}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-xs text-slate-400 uppercase tracking-wider mb-1">Tx Hash</dt>
            <dd>
              <a href={stats.lastAnchor.etherscanUrl} target="_blank" rel="noopener noreferrer"
                class="font-mono text-xs text-blue-600 hover:text-blue-800 underline break-all">
                {stats.lastAnchor.txHash}
              </a>
            </dd>
          </div>
        </dl>
      {:else}
        <div class="text-sm text-slate-400 text-center py-6">
          No anchor found. The system has not yet anchored the chain state in Ethereum.
        </div>
      {/if}
    </div>

  </div>
{/if}
