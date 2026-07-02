<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getEventFailures,
    getEventFailureStats,
    getBlockByIndex,
    getIngestedEvents,
    getIngestedEventStats,
    simulateHuggingFaceEvent
  } from '$lib/api';

  let events = $state<any[]>([]);
  let failures = $state<any[]>([]);
  let stats = $state<any>(null);
  let failureStats = $state<any>(null);
  let selectedEvent = $state<any>(null);
  let selectedBlock = $state<any>(null);
  let total = $state(0);
  let totalPages = $state(1);
  let page = $state(1);
  let loading = $state(false);
  let detailLoading = $state(false);
  let simulating = $state(false);
  let error = $state<string | null>(null);
  let simulationResult = $state<any>(null);
  let statusFilter = $state('');
  let sourceFilter = $state('');
  let eventTypeFilter = $state('');
  let verificationFilter = $state('');

  const PAGE_SIZE = 20;

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    sourceFilter = params.get('source') ?? '';
    eventTypeFilter = params.get('eventType') ?? '';
    statusFilter = params.get('status') ?? '';
    verificationFilter = params.get('verificationStatus') ?? '';
    load();
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const filters = {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(sourceFilter ? { source: sourceFilter } : {}),
        ...(eventTypeFilter ? { eventType: eventTypeFilter } : {}),
        ...(verificationFilter ? { verificationStatus: verificationFilter } : {})
      };
      const [list, nextStats] = await Promise.all([
        getIngestedEvents(page, PAGE_SIZE, filters),
        getIngestedEventStats(),
      ]);
      events = list.data;
      total = list.total;
      totalPages = list.totalPages;
      stats = nextStats;
      const failureFilters = {
        ...(sourceFilter ? { source: sourceFilter } : {}),
        ...(eventTypeFilter ? { eventType: eventTypeFilter } : {})
      };
      const [failureList, nextFailureStats] = await Promise.all([
        getEventFailures(1, 5, failureFilters),
        getEventFailureStats()
      ]);
      failures = failureList.data;
      failureStats = nextFailureStats;
      if (selectedEvent) {
        const refreshed = events.find((event) => event._id === selectedEvent._id);
        if (refreshed) {
          await selectEvent(refreshed);
        }
      }
    } catch (e: any) {
      error = e.message ?? 'Failed to load ingested events';
    } finally {
      loading = false;
    }
  }

  function applyFilters() {
    page = 1;
    load();
  }

  function clearFilters() {
    statusFilter = '';
    sourceFilter = '';
    eventTypeFilter = '';
    verificationFilter = '';
    page = 1;
    load();
  }

  function goPage(nextPage: number) {
    page = nextPage;
    load();
  }

  async function selectEvent(event: any) {
    selectedEvent = event;
    selectedBlock = null;

    if (event.blockIndex === undefined || event.blockIndex === null) return;

    detailLoading = true;
    try {
      selectedBlock = await getBlockByIndex(Number(event.blockIndex));
    } catch {
      selectedBlock = null;
    } finally {
      detailLoading = false;
    }
  }

  async function simulateHF() {
    simulating = true;
    error = null;
    simulationResult = null;
    try {
      simulationResult = await simulateHuggingFaceEvent();
      page = 1;
      sourceFilter = '';
      eventTypeFilter = '';
      statusFilter = '';
      verificationFilter = '';
      await load();
    } catch (e: any) {
      error = e.response?.data?.error ?? e.message ?? 'Failed to simulate Hugging Face event';
    } finally {
      simulating = false;
    }
  }

  function formatDate(value: string | undefined) {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  }

  function shortHash(value: string | undefined) {
    if (!value) return '—';
    return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
  }

  function modelIdFromSelected() {
    return selectedBlock?.data?.modelId ?? '';
  }

  function verificationFromSelected() {
    return selectedEvent?.verificationStatus ?? selectedBlock?.data?.metadata?.verificationStatus ?? '';
  }

  function formatJson(value: any) {
    return JSON.stringify(value ?? {}, null, 2);
  }

  const STATUS_STYLES: Record<string, string> = {
    appended: 'bg-emerald-100 text-emerald-700',
    processing: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    duplicate: 'bg-slate-100 text-slate-600'
  };
</script>

<div class="min-h-screen bg-slate-50">
  <div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-4">
        <a href="/" class="btn-ghost text-sm py-1.5 px-3">Dashboard</a>
        <div>
          <h1 class="text-white font-bold text-lg leading-tight">Event Ingestion</h1>
          <p class="text-blue-300 text-xs">External AI lifecycle events flowing into Ernest</p>
        </div>
        {#if total > 0}
          <span class="text-blue-300 text-sm">{total} events</span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-ghost text-sm py-1.5 px-3" onclick={simulateHF} disabled={simulating || loading}>
          {simulating ? 'Simulating...' : 'Simulate HF'}
        </button>
        <button class="btn-ghost text-sm py-1.5 px-3" onclick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  </div>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
    {#if simulationResult}
      <section class="border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-lg px-4 py-3 text-sm flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>Hugging Face event accepted as <strong>{simulationResult.eventType}</strong>.</span>
        <span class="font-mono text-xs">{shortHash(simulationResult.rawEventHash)}</span>
      </section>
    {/if}

    {#if stats}
      <section class="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div class="card p-4">
          <div class="text-2xl font-bold text-blue-700">{stats.total ?? 0}</div>
          <div class="text-sm font-medium text-slate-700">Total events</div>
        </div>
        <div class="card p-4">
          <div class="text-2xl font-bold text-emerald-700">{(stats.byVerificationStatus?.provider_secret ?? 0) + (stats.byVerificationStatus?.provider_hmac ?? 0)}</div>
          <div class="text-sm font-medium text-slate-700">Provider verified</div>
        </div>
        <div class="card p-4">
          <div class="text-2xl font-bold {failureStats?.total ? 'text-red-700' : 'text-emerald-700'}">{failureStats?.total ?? 0}</div>
          <div class="text-sm font-medium text-slate-700">Failures</div>
        </div>
        <div class="card p-4">
          <div class="text-2xl font-bold {failureStats?.byFailureKind?.auth_rejected ? 'text-red-700' : 'text-emerald-700'}">{failureStats?.byFailureKind?.auth_rejected ?? 0}</div>
          <div class="text-sm font-medium text-slate-700">Auth rejected</div>
        </div>
        {#each Object.entries(stats.byStatus ?? {}).slice(0, 3) as [status, count]}
          <div class="card p-4">
            <div class="text-2xl font-bold text-blue-700">{count}</div>
            <div class="text-sm font-medium text-slate-700 capitalize">{status}</div>
          </div>
        {/each}
      </section>
    {/if}

    <section class="card p-4">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
        <input
          class="input-field"
          placeholder="Filter source"
          bind:value={sourceFilter}
          onkeydown={(e) => e.key === 'Enter' && applyFilters()}
        />
        <input
          class="input-field"
          placeholder="Filter event type"
          bind:value={eventTypeFilter}
          onkeydown={(e) => e.key === 'Enter' && applyFilters()}
        />
        <select class="input-field" bind:value={statusFilter}>
          <option value="">All statuses</option>
          <option value="appended">appended</option>
          <option value="processing">processing</option>
          <option value="failed">failed</option>
          <option value="duplicate">duplicate</option>
        </select>
        <select class="input-field" bind:value={verificationFilter}>
          <option value="">All verification</option>
          <option value="unverified">unverified</option>
          <option value="shared_secret">shared_secret</option>
          <option value="provider_secret">provider_secret</option>
          <option value="provider_hmac">provider_hmac</option>
        </select>
        <div class="flex gap-2">
          <button class="btn-primary flex-1" onclick={applyFilters}>Apply</button>
          <button class="btn-outline flex-1" onclick={clearFilters}>Clear</button>
        </div>
      </div>
    </section>

    {#if error}
      <div class="alert-error">{error}</div>
    {/if}

    <section class="card p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-base font-semibold text-slate-900">Dead-letter visibility</h2>
          <p class="text-sm text-slate-500">Processing failures and auth/provider rejections recorded by the writer.</p>
        </div>
        <a class="btn-outline py-2 px-3 text-sm" href="/events?status=failed">Failed events</a>
      </div>

      {#if failures.length === 0}
        <div class="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          No dead-letter events recorded.
        </div>
      {:else}
        <div class="mt-4 overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th class="px-3 py-2">Source</th>
                <th class="px-3 py-2">Event type</th>
                <th class="px-3 py-2">Kind</th>
                <th class="px-3 py-2">Auth</th>
                <th class="px-3 py-2">Error</th>
                <th class="px-3 py-2">Failed</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {#each failures as failure}
                <tr>
                  <td class="px-3 py-2 font-medium text-slate-800">{failure.source ?? '-'}</td>
                  <td class="px-3 py-2 text-slate-600">{failure.eventType ?? '-'}</td>
                  <td class="px-3 py-2 text-slate-600">{failure.failureKind ?? 'processing_failed'}</td>
                  <td class="px-3 py-2 text-slate-600">{failure.authFailureType ?? '-'}</td>
                  <td class="px-3 py-2 font-mono text-xs text-red-700 max-w-[520px] truncate">{failure.error}</td>
                  <td class="px-3 py-2 text-slate-500 whitespace-nowrap">{formatDate(failure.failedAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
      <div class="card overflow-hidden">
        {#if loading}
          <div class="py-12 text-center text-slate-400 text-sm">Loading events...</div>
        {:else if events.length === 0}
          <div class="py-12 text-center text-slate-400 text-sm">No ingested events found.</div>
        {:else}
          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-slate-50 border-b border-slate-200">
                <tr class="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th class="px-4 py-3">Status</th>
                  <th class="px-4 py-3">Source</th>
                  <th class="px-4 py-3">Event type</th>
                  <th class="px-4 py-3">Verification</th>
                  <th class="px-4 py-3">Source event ID</th>
                  <th class="px-4 py-3">Block</th>
                  <th class="px-4 py-3">Dupes</th>
                  <th class="px-4 py-3">Raw hash</th>
                  <th class="px-4 py-3">Received</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                {#each events as event}
                  <tr
                    class="cursor-pointer hover:bg-blue-50/50 {selectedEvent?._id === event._id ? 'bg-blue-50' : ''}"
                    onclick={() => selectEvent(event)}
                  >
                    <td class="px-4 py-3">
                      <span class="text-xs px-2 py-1 rounded-full {STATUS_STYLES[event.status] ?? 'bg-slate-100 text-slate-600'}">
                        {event.status}
                      </span>
                    </td>
                    <td class="px-4 py-3 font-medium text-slate-800">{event.source}</td>
                    <td class="px-4 py-3 text-slate-600">{event.eventType}</td>
                    <td class="px-4 py-3 text-slate-600">{event.verificationStatus ?? '-'}</td>
                    <td class="px-4 py-3 font-mono text-xs text-slate-600 max-w-[320px] truncate">{event.sourceEventId}</td>
                    <td class="px-4 py-3">
                      {#if event.blockIndex !== undefined && event.blockIndex !== null}
                        <span class="text-blue-700">#{event.blockIndex}</span>
                      {:else}
                        <span class="text-slate-400">-</span>
                      {/if}
                    </td>
                    <td class="px-4 py-3 text-slate-600">{event.duplicateCount ?? 0}</td>
                    <td class="px-4 py-3 font-mono text-xs text-slate-500">{shortHash(event.rawEventHash)}</td>
                    <td class="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(event.receivedAt ?? event.appendedAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <aside class="card p-5 min-h-[360px]">
        {#if !selectedEvent}
          <div class="h-full flex items-center justify-center text-center text-sm text-slate-400">
            Select an event to inspect the ingestion record and linked hashchain block.
          </div>
        {:else}
          <div class="space-y-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-slate-900">Event detail</h2>
                <p class="text-xs text-slate-500">{selectedEvent.source}</p>
              </div>
              <span class="text-xs px-2 py-1 rounded-full {STATUS_STYLES[selectedEvent.status] ?? 'bg-slate-100 text-slate-600'}">
                {selectedEvent.status}
              </span>
            </div>

            <dl class="space-y-3 text-sm">
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Event type</dt>
                <dd class="text-slate-800">{selectedEvent.eventType}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Source event ID</dt>
                <dd class="font-mono text-xs text-slate-700 break-all">{selectedEvent.sourceEventId}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Raw event hash</dt>
                <dd class="font-mono text-xs text-slate-700 break-all">{selectedEvent.rawEventHash ?? '-'}</dd>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <dt class="text-xs font-semibold text-slate-400 uppercase">Block index</dt>
                  <dd class="text-slate-800">{selectedEvent.blockIndex ?? '-'}</dd>
                </div>
                <div>
                  <dt class="text-xs font-semibold text-slate-400 uppercase">Received</dt>
                  <dd class="text-slate-800">{formatDate(selectedEvent.receivedAt)}</dd>
                </div>
              </div>
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Block hash</dt>
                <dd class="font-mono text-xs text-slate-700 break-all">{selectedEvent.blockHash ?? '-'}</dd>
              </div>
              {#if verificationFromSelected()}
                <div>
                  <dt class="text-xs font-semibold text-slate-400 uppercase">Verification</dt>
                  <dd class="text-slate-800">{verificationFromSelected()}</dd>
                </div>
              {/if}
              {#if selectedEvent.duplicateCount}
                <div class="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <dt class="text-xs font-semibold text-slate-400 uppercase">Duplicate handling</dt>
                  <dd class="mt-1 text-slate-800">
                    {selectedEvent.duplicateCount} duplicate {selectedEvent.duplicateCount === 1 ? 'delivery' : 'deliveries'} ignored for original block #{selectedEvent.blockIndex}.
                  </dd>
                  <dd class="mt-1 text-xs text-slate-500">Last seen {formatDate(selectedEvent.duplicateSeenAt)}</dd>
                </div>
              {/if}
            </dl>

            {#if detailLoading}
              <div class="text-sm text-slate-400">Loading linked block...</div>
            {:else if selectedBlock}
              <div class="border-t border-slate-100 pt-4 space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-semibold text-slate-900">Linked block #{selectedBlock.index}</h3>
                    <p class="text-xs text-slate-500">{selectedBlock.data?.type} · {selectedBlock.data?.modelId}</p>
                  </div>
                  {#if modelIdFromSelected()}
                    <a
                      class="btn-outline py-1.5 px-3 text-xs"
                      href={`/api/provenances?modelId=${encodeURIComponent(modelIdFromSelected())}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Provenance
                    </a>
                  {/if}
                </div>
                {#if modelIdFromSelected()}
                  <a
                    class="block text-xs text-blue-700 hover:underline break-all"
                    href={`/api/provenances?modelId=${encodeURIComponent(modelIdFromSelected())}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open provenance JSON
                  </a>
                {/if}
                <pre class="max-h-72 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{formatJson(selectedBlock.data)}</pre>
              </div>
            {/if}
          </div>
        {/if}
      </aside>
    </section>

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
  </main>
</div>
