<script lang="ts">
  import { onMount } from 'svelte';
  import { getAllBlocks, getBlockByIndex } from '$lib/api';

  // ── List state ─────────────────────────────────────────────────────────────
  let blocks      = $state<any[]>([]);
  let total       = $state(0);
  let totalPages  = $state(1);
  let page        = $state(1);
  const PAGE_SIZE = 10;

  // ── Detail state ────────────────────────────────────────────────────────────
  let selectedBlock  = $state<any>(null);
  let previousBlock  = $state<any>(null);
  let jumpIndex       = $state('');

  // ── UI state ────────────────────────────────────────────────────────────────
  let loadingList   = $state(false);
  let loadingDetail = $state(false);
  let listError     = $state<string | null>(null);
  let detailError   = $state<string | null>(null);

  onMount(() => { loadList(); });

  async function loadList() {
    loadingList = true; listError = null;
    try {
      const res = await getAllBlocks(page, PAGE_SIZE);
      blocks     = res.data;
      total      = res.total;
      totalPages = res.totalPages;
    } catch (e: any) {
      listError = e.message ?? 'Failed to load blocks';
    } finally {
      loadingList = false;
    }
  }

  async function selectBlock(index: number) {
    selectedBlock = null;
    previousBlock = null;
    detailError   = null;
    loadingDetail = true;
    try {
      selectedBlock = await getBlockByIndex(index);
      if (index > 0) {
        try { previousBlock = await getBlockByIndex(index - 1); } catch { previousBlock = null; }
      }
    } catch (e: any) {
      detailError = e?.response?.status === 404
        ? `Block #${index} does not exist — the chain currently ends at #${total - 1}.`
        : e.message ?? `Failed to load block #${index}`;
    } finally {
      loadingDetail = false;
    }
  }

  function jumpToIndex() {
    const n = Number(jumpIndex);
    if (Number.isInteger(n) && n >= 0) selectBlock(n);
  }

  function goPage(p: number) { page = p; loadList(); }

  function chainLinkIntact(block: any, prev: any) {
    return !!block && !!prev && block.previousHash === prev.hash;
  }

  function shortHash(value: string | undefined) {
    if (!value) return '—';
    return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
  }
</script>

<div class="min-h-screen bg-slate-50">
  <!-- Sub-header -->
  <div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4">
    <div class="max-w-6xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-4">
        <a href="/" class="btn-ghost text-sm py-1.5 px-3">← Dashboard</a>
        <h1 class="text-white font-semibold text-lg">Hashchain Blocks</h1>
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
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Raw Chain</h2>
          <div class="flex items-center gap-1">
            <input
              type="number"
              min="0"
              bind:value={jumpIndex}
              onkeydown={(e) => e.key === 'Enter' && jumpToIndex()}
              placeholder="Jump to #"
              class="input-field text-xs py-1 px-2 w-24" />
            <button onclick={jumpToIndex} class="btn-outline text-xs py-1 px-2">Go</button>
          </div>
        </div>

        {#if listError}
          <div class="alert-error">{listError}</div>
        {/if}

        <div class="card overflow-hidden">
          {#if loadingList}
            <div class="py-10 text-center text-slate-400 text-sm">Loading…</div>
          {:else if blocks.length === 0}
            <div class="py-10 text-center text-slate-400 text-sm">No blocks yet.</div>
          {:else}
            {#each blocks as b}
              <button
                onclick={() => selectBlock(b.index)}
                class="w-full text-left px-5 py-3.5 border-b border-slate-100 last:border-0
                       hover:bg-blue-50 transition-colors
                       {selectedBlock?.index === b.index ? 'bg-blue-50 border-l-4 border-l-blue-700 pl-4' : ''}">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono text-sm text-blue-700">#{b.index}</span>
                  <span class="text-xs text-slate-400">{b.data?.type ?? 'genesis'}</span>
                </div>
                <div class="text-xs text-slate-500 mt-0.5 font-mono truncate">{shortHash(b.hash)}</div>
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

        {:else if selectedBlock}
          <div class="space-y-4">

            <!-- Header row: index + prev/next walk -->
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Block Detail</h2>
                <div class="font-mono font-semibold text-blue-700 text-lg">#{selectedBlock.index}</div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  onclick={() => selectBlock(selectedBlock.index - 1)}
                  disabled={selectedBlock.index <= 0}
                  class="btn-outline text-xs py-1.5 px-3 disabled:opacity-40">← Block {selectedBlock.index - 1}</button>
                <button
                  onclick={() => selectBlock(selectedBlock.index + 1)}
                  disabled={selectedBlock.index >= total - 1}
                  class="btn-outline text-xs py-1.5 px-3 disabled:opacity-40">Block {selectedBlock.index + 1} →</button>
              </div>
            </div>

            <!-- Chain link verification -->
            {#if selectedBlock.index > 0}
              <div class="rounded-lg p-4 border {chainLinkIntact(selectedBlock, previousBlock)
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-red-50 border-red-200'}">
                <p class="font-semibold text-sm {chainLinkIntact(selectedBlock, previousBlock) ? 'text-emerald-800' : 'text-red-800'}">
                  {chainLinkIntact(selectedBlock, previousBlock)
                    ? `✓ previousHash matches block #${selectedBlock.index - 1}'s hash`
                    : `✗ previousHash does NOT match block #${selectedBlock.index - 1}'s hash`}
                </p>
              </div>
            {:else}
              <div class="rounded-lg p-4 border bg-blue-50 border-blue-200">
                <p class="font-semibold text-sm text-blue-800">Genesis block — chain start.</p>
              </div>
            {/if}

            <div class="card p-5 space-y-4">
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Type</div>
                  <div class="font-medium text-slate-800">{selectedBlock.data?.type ?? 'genesis'}</div>
                </div>
                <div>
                  <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Timestamp</div>
                  <div class="font-medium text-slate-800">{new Date(selectedBlock.timestamp * 1000).toLocaleString()}</div>
                </div>
              </div>
              <div>
                <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Hash</div>
                <div class="font-mono text-xs text-slate-700 break-all">{selectedBlock.hash}</div>
              </div>
              <div>
                <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Previous Hash</div>
                <div class="font-mono text-xs text-slate-700 break-all">{selectedBlock.previousHash}</div>
              </div>
              <div>
                <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">Data</div>
                <pre class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 overflow-x-auto">{JSON.stringify(selectedBlock.data, null, 2)}</pre>
              </div>
            </div>
          </div>

        {:else}
          <div class="card p-12 text-center text-slate-400">
            <div class="text-3xl mb-3">🔗</div>
            <div class="text-sm">Select a block from the list to inspect it, or jump to an index.</div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
