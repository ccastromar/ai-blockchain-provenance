<script lang="ts">
  import { onMount } from 'svelte';
  import { getChainStats, seedDemoData } from '$lib/api';
  import { authState } from '$lib/auth';
  import ModelRegistration from '$lib/components/ModelRegistration.svelte';
  import InferenceLogger from '$lib/components/InferenceLogger.svelte';

  // Manual evidence entry. In the Chestertown MVP evidence arrives on its own (Prudence decisions
  // and AOS executions over Kafka); this page only simulates it by hand for demos and evaluation.
  type Tab = 'register' | 'inference';

  let activeTab = $state<Tab>('register');
  let canWrite = $derived($authState.role === 'read-write');
  let stats = $state<any>(null);
  let selectedModelId = $state('');
  let lastModelId = $state('');
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
      lastModelId = result.modelId ?? 'demo-credit-risk-v1';
      seedMessage = result.created
        ? 'Demo evidence created.'
        : 'Demo evidence already exists.';
      await loadStats();
    } catch (e: any) {
      seedError = e?.message ?? 'Could not seed demo evidence.';
    } finally {
      seedLoading = false;
    }
  }
</script>

<div class="min-h-screen bg-slate-50">
  <!-- Page toolbar (navigation lives in the shared layout) -->
  <div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4">
    <div class="max-w-7xl mx-auto">
      <div class="flex items-center gap-6">
        <div class="flex-1">
          <h1 class="text-white font-bold text-lg leading-tight">Demo</h1>
          <p class="text-blue-300 text-xs">Manual evidence entry for demos and evaluation</p>
        </div>

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
  </div>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
    <section class="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <p class="font-semibold">Manual entry — simulates what AOS and Prudence send automatically over Kafka.</p>
      <p class="mt-1 text-amber-800">
        In normal operation nobody registers models or logs inferences here: decisions and executions
        reach Ernest on their own. Everything created on this page is real evidence on the chain, so use
        it for demos and evaluation only.
      </p>
    </section>

    {#if !canWrite}
      <div class="card p-8 text-center text-sm text-slate-500">
        Manual entry writes to the chain, so it needs a read-write sign-in.
        <div class="mt-3"><a href="/login" class="btn-outline text-sm">Sign in</a></div>
      </div>
    {:else}
      <section class="rounded-lg border border-blue-200 bg-blue-50 p-5">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-sm font-semibold uppercase text-blue-700">Evaluator shortcut</p>
            <h2 class="mt-1 text-lg font-bold text-slate-900">Seed a ready-to-audit credit-risk demo</h2>
            <p class="mt-1 text-sm text-slate-600">
              Creates one model registration and two hash-only inference events so Models and Audit have evidence immediately.
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
          <div class="mt-4 alert-success text-sm text-emerald-800">
            {seedMessage}
            <a class="underline" href={`/models?model=${encodeURIComponent(lastModelId)}`}>See it in Models</a>
            or <a class="underline" href="/auditor">open the audit</a>.
          </div>
        {/if}
        {#if seedError}
          <div class="mt-4 alert-error">{seedError}</div>
        {/if}
      </section>

      <div class="card overflow-hidden">
        <div class="border-b border-slate-200 bg-slate-50/50">
          <nav class="flex">
            {#each [
              { id: 'register',  label: '📝 Register Model' },
              { id: 'inference', label: '🔬 Log Inference' }
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

        <div class="p-6 space-y-4">
          {#if lastModelId && !seedMessage}
            <div class="alert-success text-sm text-emerald-800">
              Recorded for <span class="font-mono">{lastModelId}</span>.
              <a class="underline" href={`/models?model=${encodeURIComponent(lastModelId)}`}>See its provenance in Models</a>.
            </div>
          {/if}
          {#if activeTab === 'register'}
            <ModelRegistration onSuccess={(id) => { loadStats(); selectedModelId = id; lastModelId = id; activeTab = 'inference'; }} />
          {:else}
            <InferenceLogger initialModelId={selectedModelId} onSuccess={(id) => { loadStats(); selectedModelId = id; lastModelId = id; }} />
          {/if}
        </div>
      </div>
    {/if}
  </main>
</div>
