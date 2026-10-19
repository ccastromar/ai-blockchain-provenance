<script lang="ts">
  import { onMount } from 'svelte';
  import { page as pageStore } from '$app/stores';
  import { getModels, getModelById, getProvenance, patchModel, getModelIntegrity, exportProvenance,
    exportProvenanceCycloneDx, type ModelStatus, type ProvenanceFilter } from '$lib/api';
  import { authState } from '$lib/auth';
  import { env } from '$env/dynamic/public';

  let canWrite = $derived($authState.role === 'read-write');

  // ── List state ─────────────────────────────────────────────────────────────
  let models      = $state<any[]>([]);
  let total       = $state(0);
  let totalPages  = $state(1);
  let page        = $state(1);
  const PAGE_SIZE = 10;

  // ── Detail state ────────────────────────────────────────────────────────────
  let selectedModelId = $state('');
  let selectedModel   = $state<any>(null);
  let provenance      = $state<any>(null);
  let integrity       = $state<any>(null);

  // Provenance filters (event type and date range) for the timeline and its exports.
  let filterType = $state<'' | 'model_registration' | 'inference' | 'policy_decision' | 'external_event'>('');
  let filterFrom = $state('');
  let filterTo   = $state('');
  let filtering  = $state(false);
  let filtersActive = $derived(!!(filterType || filterFrom || filterTo));

  // ── UI state ────────────────────────────────────────────────────────────────
  let loadingList      = $state(false);
  let loadingDetail    = $state(false);
  let loadingIntegrity = $state(false);
  let patchingStatus   = $state(false);
  let listError        = $state<string | null>(null);
  let detailError      = $state<string | null>(null);

  onMount(() => {
    loadList();
    // /models?model=<id> opens that model directly (e.g. from Demo or Audit).
    const preselected = $pageStore.url.searchParams.get('model');
    if (preselected) selectModel(preselected);
  });

  async function loadList() {
    loadingList = true; listError = null;
    try {
      const res = await getModels(page, PAGE_SIZE);
      models     = res.data;
      total      = res.total;
      totalPages = res.totalPages;
    } catch (e: any) {
      listError = e.message ?? 'Failed to load models';
    } finally {
      loadingList = false;
    }
  }

  async function selectModel(id: string) {
    selectedModelId  = id;
    selectedModel    = null;
    provenance       = null;
    integrity        = null;
    filterType = ''; filterFrom = ''; filterTo = '';
    loadingDetail    = true;
    detailError      = null;
    try {
      [selectedModel, provenance] = await Promise.all([
        getModelById(id),
        getProvenance(id)
      ]);
    } catch (e: any) {
      detailError = e.message ?? 'Failed to load model';
    } finally {
      loadingDetail = false;
    }
  }

  function provenanceFilters(): ProvenanceFilter {
    const filters: ProvenanceFilter = {};
    if (filterType) filters.type = filterType;
    if (filterFrom) filters.from = filterFrom;
    if (filterTo)   filters.to   = filterTo;
    return filters;
  }

  async function applyFilters() {
    if (!selectedModelId) return;
    filtering = true;
    try {
      provenance = await getProvenance(selectedModelId, provenanceFilters());
    } catch (e: any) {
      detailError = e.message ?? 'Failed to load provenance';
    } finally {
      filtering = false;
    }
  }

  function clearFilters() {
    filterType = ''; filterFrom = ''; filterTo = '';
    applyFilters();
  }

  async function changeStatus(status: ModelStatus) {
    if (!selectedModelId) return;
    patchingStatus = true;
    try {
      const updated = await patchModel(selectedModelId, status);
      // update in-place in list
      const idx = models.findIndex(m => m.modelId === selectedModelId);
      if (idx !== -1) models[idx] = { ...models[idx], status };
      if (selectedModel) selectedModel = { ...selectedModel, status: updated.status ?? status };
    } catch (e: any) {
      detailError = e.message ?? 'Failed to update status';
    } finally {
      patchingStatus = false;
    }
  }

  async function checkIntegrity() {
    if (!selectedModelId) return;
    loadingIntegrity = true; integrity = null;
    try {
      integrity = await getModelIntegrity(selectedModelId);
    } catch (e: any) {
      detailError = e.message ?? 'Failed to check integrity';
    } finally {
      loadingIntegrity = false;
    }
  }

  function goPage(p: number) { page = p; loadList(); }

  function integrityValid(result: any) {
    return (result?.valid ?? result?.isValid) === true;
  }

  // A system governed elsewhere (Prudence's registry) keeps its lifecycle there: Ernest only
  // holds its evidence, so its status is read-only here (the backend refuses changes too).
  const governedBy = (m: any): string | undefined => m?.governance?.systemOfRecord;
  const ownerUrl = (owner: string) =>
    owner === 'prudence' ? (env.PUBLIC_PRUDENCE_URL ?? 'http://localhost:5200') : undefined;
  const ownerLabel = (owner: string) => owner === 'prudence' ? 'Prudence' : owner;

  const RISK_STYLES: Record<string, string> = {
    PROHIBITED: 'bg-red-100 text-red-700',
    HIGH:       'bg-orange-100 text-orange-700',
    LIMITED:    'bg-amber-100 text-amber-700',
    MINIMAL:    'bg-slate-100 text-slate-600'
  };

  const STATUS_STYLES: Record<string, string> = {
    active:     'bg-emerald-100 text-emerald-700',
    deprecated: 'bg-amber-100 text-amber-700',
    archived:   'bg-slate-100 text-slate-500'
  };
</script>

<div class="min-h-screen bg-slate-50">
  <!-- Sub-header -->
  <div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4">
    <div class="max-w-6xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-4">
        <h1 class="text-white font-semibold text-lg">AI Models</h1>
        {#if total > 0}
          <span class="text-blue-300 text-sm">{total} total</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8">
    <div class="grid grid-cols-1 md:grid-cols-5 gap-6">

      <!-- ── Master list ──────────────────────────────────────────────────── -->
      <div class="md:col-span-2 flex flex-col gap-3">
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Registered Models</h2>

        {#if listError}
          <div class="alert-error">{listError}</div>
        {/if}

        <div class="card overflow-hidden">
          {#if loadingList}
            <div class="py-10 text-center text-slate-400 text-sm">Loading…</div>
          {:else if models.length === 0}
            <div class="py-10 text-center text-slate-400 text-sm">No models registered yet.</div>
          {:else}
            {#each models as m}
              <button
                onclick={() => selectModel(m.modelId)}
                class="w-full text-left px-5 py-3.5 border-b border-slate-100 last:border-0
                       hover:bg-blue-50 transition-colors
                       {selectedModelId === m.modelId ? 'bg-blue-50 border-l-4 border-l-blue-700 pl-4' : ''}">
                <div class="flex items-center justify-between gap-2">
                  <div class="font-medium text-slate-800 text-sm truncate">{governedBy(m) && m.name && m.name !== m.modelId ? m.name : m.modelId}</div>
                  {#if m.status && m.status !== 'active'}
                    <span class="text-xs px-2 py-0.5 rounded-full flex-shrink-0 {STATUS_STYLES[m.status] ?? ''}">
                      {m.status}
                    </span>
                  {/if}
                </div>
                <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{governedBy(m) ? m.modelId : (m.name || 'No name')}{m.version && m.version !== 'external' ? ` · v${m.version}` : ''}</span>
                  {#if governedBy(m)}
                    <span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{ownerLabel(governedBy(m) ?? '')}</span>
                  {/if}
                  {#if m.governance?.riskTier}
                    <span class="px-1.5 py-0.5 rounded {RISK_STYLES[m.governance.riskTier] ?? RISK_STYLES.MINIMAL}">{m.governance.riskTier}</span>
                  {/if}
                </div>
              </button>
            {/each}
          {/if}
        </div>

        <!-- Pagination -->
        {#if totalPages > 1}
          <div class="flex items-center justify-between text-sm">
            <button
              onclick={() => goPage(page - 1)}
              disabled={page <= 1}
              class="btn-outline py-1.5 px-3 text-xs disabled:opacity-40">← Prev</button>
            <span class="text-slate-500 text-xs">Page {page} / {totalPages}</span>
            <button
              onclick={() => goPage(page + 1)}
              disabled={page >= totalPages}
              class="btn-outline py-1.5 px-3 text-xs disabled:opacity-40">Next →</button>
          </div>
        {/if}
      </div>

      <!-- ── Detail panel ─────────────────────────────────────────────────── -->
      <div class="md:col-span-3">
        {#if loadingDetail}
          <div class="card p-12 text-center text-slate-400 text-sm">Loading…</div>

        {:else if detailError}
          <div class="alert-error">{detailError}</div>

        {:else if selectedModel}
          <div class="space-y-4">

            <!-- Header row -->
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Model Detail</h2>
                <div class="font-semibold text-blue-700">{selectedModel.modelId}</div>
                {#if governedBy(selectedModel)}
                  {@const owner = governedBy(selectedModel) ?? ''}
                  <div class="mt-1 text-xs text-slate-500">
                    Governed by
                    {#if ownerUrl(owner)}
                      <a href={ownerUrl(owner)} class="text-blue-700 underline" target="_blank" rel="noopener noreferrer">{ownerLabel(owner)}</a>
                    {:else}
                      {ownerLabel(owner)}
                    {/if}
                    {#if selectedModel.governance?.riskTier}
                      · <span class="px-1.5 py-0.5 rounded {RISK_STYLES[selectedModel.governance.riskTier] ?? RISK_STYLES.MINIMAL}">{selectedModel.governance.riskTier} risk</span>
                    {/if}
                  </div>
                {/if}
              </div>
              <!-- Status badge + dropdown -->
              <div class="flex items-center gap-2 flex-shrink-0">
                {#if !governedBy(selectedModel)}
                <span class="text-xs px-2.5 py-1 rounded-full font-medium {STATUS_STYLES[selectedModel.status ?? 'active'] ?? STATUS_STYLES.active}">
                  {selectedModel.status ?? 'active'}
                </span>
                {/if}
                {#if governedBy(selectedModel)}
                  <span class="text-xs text-slate-400" title="Its lifecycle (approval, suspension, retirement) is managed by its system of record">
                    managed in {ownerLabel(governedBy(selectedModel) ?? '')}
                  </span>
                {:else}
                <div class="relative group" title={canWrite ? '' : 'Read-only access — changing model status requires a read-write key'}>
                  <button disabled={patchingStatus || !canWrite}
                    class="btn-outline text-xs py-1.5 px-3 disabled:opacity-50">
                    {patchingStatus ? '…' : 'Change ▾'}
                  </button>
                  {#if canWrite}
                  <div class="absolute right-0 top-full mt-1 w-36 card py-1 shadow-lg z-10 hidden group-focus-within:block group-hover:block">
                    {#each ['active', 'deprecated', 'archived'] as s}
                      <button
                        onclick={() => changeStatus(s as ModelStatus)}
                        class="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 text-slate-700
                               {(selectedModel.status ?? 'active') === s ? 'font-semibold text-blue-700' : ''}">
                        {s}
                      </button>
                    {/each}
                  </div>
                  {/if}
                </div>
                {/if}
              </div>
            </div>

            <div class="card p-5 space-y-4">
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Name</div>
                  <div class="font-medium text-slate-800">{selectedModel.name}</div>
                </div>
                <div>
                  <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Version</div>
                  <div class="font-medium text-slate-800">{selectedModel.version}</div>
                </div>
              </div>

              {#each [
                { label: 'Parameters', data: selectedModel.parameters },
                { label: 'Metrics',    data: selectedModel.metrics },
                { label: 'Metadata',   data: selectedModel.metadata }
              ] as section}
                {#if section.data && Object.keys(section.data).length}
                  <div>
                    <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">{section.label}</div>
                    <pre class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 overflow-x-auto">{JSON.stringify(section.data, null, 2)}</pre>
                  </div>
                {/if}
              {/each}
            </div>

            <!-- Integrity check -->
            <div class="card p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Model Integrity</h3>
                <button onclick={checkIntegrity} disabled={loadingIntegrity} class="btn-outline text-xs py-1.5 px-3">
                  {loadingIntegrity ? 'Checking…' : 'Check integrity'}
                </button>
              </div>
              {#if integrity}
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-full flex items-center justify-center text-sm
                    {integrityValid(integrity) ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}">
                    {integrityValid(integrity) ? '✓' : '✗'}
                  </div>
                  <span class="text-sm font-medium {integrityValid(integrity) ? 'text-emerald-700' : 'text-red-700'}">
                    {integrityValid(integrity) ? 'All blocks are valid' : 'Integrity issues found'}
                  </span>
                </div>
                {#if integrity.errors?.length}
                  <ul class="mt-2 text-xs text-red-600 space-y-1 list-disc list-inside">
                    {#each integrity.errors as err}
                      <li>{err}</li>
                    {/each}
                  </ul>
                {/if}
              {:else}
                <p class="text-xs text-slate-400">Verify only this model's blocks without scanning the full chain.</p>
              {/if}
            </div>

            <!-- Provenance: timeline with filters and exports -->
            {#if provenance}
              <div class="card p-5">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Provenance · {provenance.totalBlocks} blocks
                    {#if filtersActive}<span class="ml-1 normal-case bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">filtered</span>{/if}
                  </div>
                  <div class="flex gap-2">
                    <a href={exportProvenance(selectedModelId)} target="_blank" rel="noopener noreferrer"
                      class="btn-outline text-xs py-1.5 px-3" title="Download the full provenance as JSON">⬇ JSON</a>
                    <a href={exportProvenanceCycloneDx(selectedModelId)} target="_blank" rel="noopener noreferrer"
                      class="btn-outline text-xs py-1.5 px-3" title="Download as CycloneDX 1.6 AI/ML-BOM">⬇ ML-BOM</a>
                  </div>
                </div>

                <div class="flex flex-wrap items-end gap-2 mb-3 text-xs">
                  <label class="flex flex-col gap-1 text-slate-500">
                    Event type
                    <select bind:value={filterType} class="field-input text-xs py-1.5">
                      <option value="">All</option>
                      <option value="model_registration">Registration</option>
                      <option value="inference">Inference</option>
                      <option value="policy_decision">Policy decision</option>
                      <option value="external_event">Runtime event</option>
                    </select>
                  </label>
                  <label class="flex flex-col gap-1 text-slate-500">
                    From
                    <input type="date" bind:value={filterFrom} class="field-input text-xs py-1.5" />
                  </label>
                  <label class="flex flex-col gap-1 text-slate-500">
                    To
                    <input type="date" bind:value={filterTo} class="field-input text-xs py-1.5" />
                  </label>
                  <button onclick={applyFilters} disabled={filtering} class="btn-primary text-xs py-1.5 px-3">
                    {filtering ? '…' : 'Apply'}
                  </button>
                  {#if filtersActive}
                    <button onclick={clearFilters} class="btn-outline text-xs py-1.5 px-3">Clear</button>
                  {/if}
                </div>

                {#if provenance.history.length === 0}
                  <p class="text-xs text-slate-400">No events match these filters.</p>
                {/if}
                <div class="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {#each provenance.history as block}
                    <div class="flex items-start gap-3 text-xs bg-blue-50 border border-blue-100 rounded-lg p-3">
                      <span class="mt-0.5 text-blue-400 font-mono">#{block.blockIndex}</span>
                      <div class="flex-1 min-w-0">
                        <span class="font-medium text-slate-700">{block.type}</span>
                        <span class="text-slate-400 ml-2">{block.timestamp}</span>
                        <div class="font-mono text-slate-400 truncate mt-0.5">{block.blockHash.substring(0, 24)}…</div>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

        {:else}
          <div class="card p-12 text-center text-slate-400">
            <div class="text-3xl mb-3">🔍</div>
            <div class="text-sm">Select a model from the list to view details.</div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
