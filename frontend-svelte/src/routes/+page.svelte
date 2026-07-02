<script lang="ts">
  import { onMount } from 'svelte';
  import { getChainStats, seedDemoData } from '$lib/api';
  import ModelRegistration from '$lib/components/ModelRegistration.svelte';
  import InferenceLogger from '$lib/components/InferenceLogger.svelte';
  import ProvenanceViewer from '$lib/components/ProvenanceViewer.svelte';

  type Tab = 'register' | 'inference' | 'provenance';

  let activeTab = $state<Tab>('register');
  let stats = $state<any>(null);
  let selectedModelId = $state('');
  let seedLoading = $state(false);
  let seedMessage = $state('');
  let seedError = $state('');

  onMount(() => { loadStats(); });

  async function loadStats() {
    try {
      stats = await getChainStats();
    } catch (e) {
      console.error('Error loading stats:', e);
    }
  }

  async function seedDemo() {
    seedLoading = true;
    seedMessage = '';
    seedError = '';

    try {
      const result = await seedDemoData();
      selectedModelId = result.modelId ?? 'demo-credit-risk-v1';
      activeTab = 'provenance';
      seedMessage = result.created
        ? 'Demo evidence created. Open Audit Readiness for the full review.'
        : 'Demo evidence already exists. It is selected below.';
      await loadStats();
    } catch (e: any) {
      seedError = e?.message ?? 'Could not seed demo evidence.';
    } finally {
      seedLoading = false;
    }
  }
</script>

<div class="min-h-screen bg-slate-50">
  <!-- Header -->
  <header class="bg-blue-900 shadow-lg">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
      <div class="flex items-center gap-6">
        <!-- Brand -->
        <div class="flex-1">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-sky-400 rounded-lg flex items-center justify-center font-bold text-blue-900 text-lg">E</div>
            <div>
              <h1 class="text-xl font-bold text-white tracking-tight">Ernest</h1>
              <p class="text-xs text-blue-200 leading-none mt-0.5">AI Provenance · Blockchain</p>
            </div>
          </div>
        </div>

        <!-- Nav links -->
        <nav class="flex items-center gap-2">
          <a href="/models" class="btn-ghost text-sm py-2 px-4">Models</a>
          <a href="/blocks" class="btn-ghost text-sm py-2 px-4">Blocks</a>
          <a href="/connectors" class="btn-ghost text-sm py-2 px-4">Connectors</a>
          <a href="/events" class="btn-ghost text-sm py-2 px-4">Events</a>
          <a href="/stats" class="btn-ghost text-sm py-2 px-4">Statistics</a>
          <a href="/auditor" class="btn-ghost text-sm py-2 px-4">Audit</a>
        </nav>

        <!-- Live stats chips -->
        {#if stats}
          <div class="hidden sm:flex items-center gap-4 pl-4 border-l border-blue-700">
            <div class="text-center">
              <div class="text-lg font-bold text-sky-300">{stats.totalBlocks}</div>
              <div class="text-xs text-blue-300">Blocks</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-bold text-sky-300">{stats.totalModels}</div>
              <div class="text-xs text-blue-300">Models</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-bold {stats.chainValid ? 'text-emerald-400' : 'text-red-400'}">
                {stats.chainValid ? '✓' : '✗'}
              </div>
              <div class="text-xs text-blue-300">Chain</div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </header>

  <!-- Main content -->
  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <section class="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-5">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-sm font-semibold uppercase text-blue-700">Evaluator shortcut</p>
          <h2 class="mt-1 text-lg font-bold text-slate-900">Seed a ready-to-audit credit-risk demo</h2>
          <p class="mt-1 text-sm text-slate-600">
            Creates one model registration and two hash-only inference events so the dashboard and auditor have evidence immediately.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="btn-primary" onclick={seedDemo} disabled={seedLoading}>
            {seedLoading ? 'Seeding...' : 'Seed demo'}
          </button>
          <a class="btn-outline" href="/auditor">Open audit</a>
        </div>
      </div>
      {#if seedMessage}
        <div class="mt-4 alert-success text-sm text-emerald-800">{seedMessage}</div>
      {/if}
      {#if seedError}
        <div class="mt-4 alert-error">{seedError}</div>
      {/if}
    </section>

    <div class="card overflow-hidden">
      <!-- Tab bar -->
      <div class="border-b border-slate-200 bg-slate-50/50">
        <nav class="flex">
          {#each [
            { id: 'register',   label: '📝 Register Model' },
            { id: 'inference',  label: '🔬 Log Inference' },
            { id: 'provenance', label: '🔍 View Provenance' }
          ] as tab}
            <button
              onclick={() => activeTab = tab.id as Tab}
              class="px-6 py-3.5 text-sm font-medium border-b-2 transition-colors {activeTab === tab.id
                ? 'border-blue-700 text-blue-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}">
              {tab.label}
            </button>
          {/each}
        </nav>
      </div>

      <div class="p-6">
        {#if activeTab === 'register'}
          <ModelRegistration onSuccess={(id) => { loadStats(); selectedModelId = id; activeTab = 'inference'; }} />
        {:else if activeTab === 'inference'}
          <InferenceLogger initialModelId={selectedModelId} onSuccess={(id) => { loadStats(); selectedModelId = id; activeTab = 'provenance'; }} />
        {:else}
          <ProvenanceViewer initialModelId={selectedModelId} />
        {/if}
      </div>
    </div>
  </main>
</div>
