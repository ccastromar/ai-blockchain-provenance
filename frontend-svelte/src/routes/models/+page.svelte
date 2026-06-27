<script lang="ts">
  import { onMount } from 'svelte';
  import { getModels, getModelById, getProvenance, patchModel, getModelIntegrity, type ModelStatus } from '$lib/api';

  // ── List state ─────────────────────────────────────────────────────────────
  let models      = $state<any[]>([]);
  let total       = $state(0);
  let totalPages  = $state(1);
  let page        = $state(1);
  const PAGE_SIZE = 20;

  // ── Detail state ────────────────────────────────────────────────────────────
  let selectedModelId = $state('');
  let selectedModel   = $state<any>(null);
  let provenance      = $state<any>(null);
  let integrity       = $state<any>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  let loadingList      = $state(false);
  let loadingDetail    = $state(false);
  let loadingIntegrity = $state(false);
  let patchingStatus   = $state(false);
  let listError        = $state<string | null>(null);
  let detailError      = $state<string | null>(null);

  onMount(() => { loadList(); });

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
        <a href="/" class="btn-ghost text-sm py-1.5 px-3">← Dashboard</a>
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
                  <div class="font-medium text-slate-800 text-sm truncate">{m.modelId}</div>
                  {#if m.status && m.status !== 'active'}
                    <span class="text-xs px-2 py-0.5 rounded-full flex-shrink-0 {STATUS_STYLES[m.status] ?? ''}">
                      {m.status}
                    </span>
                  {/if}
                </div>
                <div class="text-xs text-slate-500 mt-0.5">{m.name || 'No name'} · v{m.version}</div>
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
              </div>
              <!-- Status badge + dropdown -->
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="text-xs px-2.5 py-1 rounded-full font-medium {STATUS_STYLES[selectedModel.status ?? 'active'] ?? STATUS_STYLES.active}">
                  {selectedModel.status ?? 'active'}
                </span>
                <div class="relative group">
                  <button disabled={patchingStatus}
                    class="btn-outline text-xs py-1.5 px-3 disabled:opacity-50">
                    {patchingStatus ? '…' : 'Change ▾'}
                  </button>
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
                </div>
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
                    {integrity.valid ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}">
                    {integrity.valid ? '✓' : '✗'}
                  </div>
                  <span class="text-sm font-medium {integrity.valid ? 'text-emerald-700' : 'text-red-700'}">
                    {integrity.valid ? 'All blocks are valid' : 'Integrity issues found'}
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

            <!-- Provenance mini-timeline -->
            {#if provenance}
              <div class="card p-5">
                <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Provenance · {provenance.totalBlocks} blocks
                </div>
                <div class="space-y-2 max-h-64 overflow-y-auto pr-1">
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
