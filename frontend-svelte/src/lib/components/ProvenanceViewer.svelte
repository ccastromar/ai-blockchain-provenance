<script lang="ts">
  import { onMount } from 'svelte';
  import { format } from 'date-fns';
  import { getProvenance, verifyChain, getAllModelIds, exportProvenance, type ProvenanceFilter } from '$lib/api';

  let { initialModelId = '' }: { initialModelId?: string } = $props();

  let modelId      = $state(initialModelId ?? '');
  let provenance   = $state<any>(null);
  let loading      = $state(false);
  let error        = $state<string | null>(null);
  let verifying    = $state(false);
  let verification = $state<any>(null);
  let modelIds     = $state<string[]>([]);

  // Filters
  let filterType  = $state<'' | 'model_registration' | 'inference'>('');
  let filterFrom  = $state('');
  let filterTo    = $state('');

  onMount(async () => {
    try { modelIds = await getAllModelIds(); } catch { modelIds = []; }
    if (initialModelId) handleSearch();
  });

  async function handleSearch() {
    if (!modelId.trim()) return;
    loading = true; error = null; provenance = null;
    const filters: ProvenanceFilter = {};
    if (filterType) filters.type = filterType;
    if (filterFrom) filters.from = filterFrom;
    if (filterTo)   filters.to   = filterTo;
    try {
      provenance = await getProvenance(modelId, filters);
    } catch (err: any) {
      error = err.message || 'Failed to fetch provenance';
    } finally {
      loading = false;
    }
  }

  async function handleVerify() {
    verifying = true;
    try {
      verification = await verifyChain();
    } catch (err: any) {
      error = err.message || 'Failed to verify chain';
    } finally {
      verifying = false;
    }
  }

  function handleExport() {
    window.open(exportProvenance(modelId), '_blank');
  }
</script>

<div class="max-w-3xl space-y-6">
  <div>
    <h2 class="text-xl font-semibold text-slate-800">View Provenance</h2>
    <p class="text-sm text-slate-500 mt-1">Query the complete audit trail of a model from the blockchain</p>
  </div>

  <!-- Model selector + actions -->
  <div class="flex gap-2 flex-wrap">
    {#if modelIds.length}
      <select bind:value={modelId} class="field-input flex-1 min-w-0">
        <option value="">— Select a model —</option>
        {#each modelIds as id}
          <option value={id}>{id}</option>
        {/each}
      </select>
    {:else}
      <input type="text" bind:value={modelId}
        onkeydown={(e) => e.key === 'Enter' && handleSearch()}
        class="field-input flex-1" placeholder="Enter Model ID…" />
    {/if}
    <button onclick={handleSearch} disabled={loading || !modelId.trim()} class="btn-primary">
      {loading ? 'Searching…' : 'Search'}
    </button>
    <button onclick={handleVerify} disabled={verifying} class="btn-secondary">
      {verifying ? 'Verifying…' : 'Verify Chain'}
    </button>
    {#if provenance}
      <button onclick={handleExport} class="btn-outline" title="Download as JSON">
        ⬇ Export
      </button>
    {/if}
  </div>

  <!-- Filters -->
  <details class="card">
    <summary class="px-5 py-3 text-sm font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-50 rounded-xl">
      🔎 Filters
      {#if filterType || filterFrom || filterTo}
        <span class="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">active</span>
      {/if}
    </summary>
    <div class="px-5 pb-5 pt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100">
      <div>
        <label class="field-label" for="prov-type">Event type</label>
        <select id="prov-type" bind:value={filterType} class="field-input text-sm">
          <option value="">All types</option>
          <option value="model_registration">Registration</option>
          <option value="inference">Inference</option>
        </select>
      </div>
      <div>
        <label class="field-label" for="prov-from">From</label>
        <input id="prov-from" type="date" bind:value={filterFrom} class="field-input text-sm" />
      </div>
      <div>
        <label class="field-label" for="prov-to">To</label>
        <input id="prov-to" type="date" bind:value={filterTo} class="field-input text-sm" />
      </div>
    </div>
    <div class="px-5 pb-4 flex gap-2">
      <button onclick={handleSearch} disabled={!modelId.trim() || loading} class="btn-primary text-sm py-2">
        Apply filters
      </button>
      <button onclick={() => { filterType = ''; filterFrom = ''; filterTo = ''; handleSearch(); }}
        class="btn-outline text-sm py-2">
        Clear
      </button>
    </div>
  </details>

  {#if error}
    <div class="alert-error">{error}</div>
  {/if}

  {#if verification}
    <div class="rounded-lg p-4 border {verification.isValid
      ? 'bg-emerald-50 border-emerald-200'
      : 'bg-red-50 border-red-200'}">
      <p class="font-semibold text-sm {verification.isValid ? 'text-emerald-800' : 'text-red-800'}">
        {verification.isValid ? '✓ Chain is Valid' : '✗ Chain Verification Failed'}
      </p>
      {#if verification.errors?.length}
        <ul class="mt-2 text-sm text-red-700 list-disc list-inside space-y-1">
          {#each verification.errors as err}
            <li>{err}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if provenance}
    <!-- Summary pills -->
    <div class="grid grid-cols-3 gap-4">
      {#each [
        { label: 'Model ID',     value: provenance.modelId,     mono: true },
        { label: 'Total Blocks', value: provenance.totalBlocks },
        { label: 'Chain Valid',
          value: provenance.chainValid ? '✓ Yes' : '✗ No',
          color: provenance.chainValid ? 'text-emerald-600' : 'text-red-600' }
      ] as pill}
        <div class="card p-4">
          <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">{pill.label}</div>
          <div class="text-sm font-semibold {pill.color ?? 'text-slate-800'} {pill.mono ? 'font-mono truncate' : ''}">
            {pill.value}
          </div>
        </div>
      {/each}
    </div>

    <!-- Timeline -->
    <div>
      <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">History Timeline</h3>
      <div class="space-y-3">
        {#each provenance.history as event, i (i)}
          <div class="card p-5">
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0
                  {event.type === 'model_registration' ? 'bg-blue-100 text-blue-600' : 'bg-sky-100 text-sky-600'}">
                  {event.type === 'model_registration' ? '📝' : '🔬'}
                </div>
                <div>
                  <p class="font-medium text-slate-800 text-sm">
                    {event.type === 'model_registration' ? 'Model Registration' : 'Inference'}
                  </p>
                  <p class="text-xs text-slate-400">{format(new Date(event.timestamp), 'dd MMM yyyy · HH:mm:ss')}</p>
                </div>
              </div>
              <span class="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full">Block #{event.blockIndex}</span>
            </div>

            <div class="space-y-2.5 text-sm">
              {#if event.version}
                <div class="text-slate-600"><span class="font-medium">Version:</span> {event.version}</div>
              {/if}
              {#if event.metadata}
                <div>
                  <div class="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Metadata</div>
                  <pre class="bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs overflow-x-auto text-slate-600">{JSON.stringify(event.metadata, null, 2)}</pre>
                </div>
              {/if}
              {#if event.params && Object.keys(event.params).length}
                <div>
                  <div class="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Parameters</div>
                  <pre class="bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs overflow-x-auto text-slate-600">{JSON.stringify(event.params, null, 2)}</pre>
                </div>
              {/if}
              {#if event.inputHash || event.outputHash}
                <div class="border-t border-slate-100 pt-2 space-y-1">
                  {#if event.inputHash}
                    <div class="text-xs text-slate-500"><span class="font-medium">Input Hash:</span> <code class="font-mono">{event.inputHash}</code></div>
                  {/if}
                  {#if event.outputHash}
                    <div class="text-xs text-slate-500"><span class="font-medium">Output Hash:</span> <code class="font-mono">{event.outputHash}</code></div>
                  {/if}
                </div>
              {/if}
              <div class="text-xs text-slate-400 font-mono break-all border-t border-slate-100 pt-2">
                <span class="font-medium not-italic text-slate-500">Block Hash:</span> {event.blockHash}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>

  {:else if !loading && !error}
    <div class="card py-16 text-center text-slate-400">
      <div class="text-3xl mb-3">🔍</div>
      <p class="text-sm">Select a model or enter an ID to view its provenance trail</p>
    </div>
  {/if}
</div>
