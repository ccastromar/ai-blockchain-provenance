<script lang="ts">
  import { onMount } from 'svelte';
  import { getIngestedEventStats, getIngestorAuthStatus, getIngestorHealth, simulateAzureMlEvent, simulateCloudEventsEvent, simulateDatabricksEvent, simulateHuggingFaceEvent, simulateOpenLineageEvent, simulateOpenTelemetryLogs, simulateSageMakerEvent, simulateVertexAiEvent } from '$lib/api';
  import { authState } from '$lib/auth';
  import AccessBadge from '$lib/components/AccessBadge.svelte';

  let canWrite = $derived($authState.role === 'read-write');

  type ConnectorState = 'enabled' | 'planned';

  interface Connector {
    id: string;
    name: string;
    source: string;
    status: ConnectorState;
    endpoint?: string;
    eventTypes: string[];
    note: string;
  }

  const connectors: Connector[] = [
    {
      id: 'huggingface',
      name: 'Hugging Face Hub',
      source: 'huggingface',
      status: 'enabled',
      endpoint: '/ingestor/events/huggingface',
      eventTypes: ['model.version.created', 'model.registered', 'model.card.updated'],
      note: 'Repository activity mapped into model lifecycle evidence.'
    },
    {
      id: 'generic-http',
      name: 'Generic HTTP',
      source: 'manual-normalizer-test',
      status: 'enabled',
      endpoint: '/ingestor/events',
      eventTypes: ['model.version.created', 'inference.logged', 'dataset.linked'],
      note: 'Direct event intake for internal services and local emitters.'
    },
    {
      id: 'cloudevents',
      name: 'CloudEvents',
      source: 'cloudevents',
      status: 'enabled',
      endpoint: '/ingestor/events/cloudevents',
      eventTypes: ['model.registered', 'model.deployed', 'inference.logged'],
      note: 'Strict vendor-neutral CloudEvents 1.0 intake for event buses and gateways.'
    },
    {
      id: 'sagemaker',
      name: 'SageMaker EventBridge',
      source: 'sagemaker',
      status: 'enabled',
      endpoint: '/ingestor/events/sagemaker',
      eventTypes: ['training.completed', 'model.approved', 'model.deployed'],
      note: 'Enterprise cloud connector for model package approval, training, and endpoint lifecycle.'
    },
    {
      id: 'azureml',
      name: 'Azure ML Event Grid',
      source: 'azureml',
      status: 'enabled',
      endpoint: '/ingestor/events/azureml',
      eventTypes: ['model.registered', 'training.completed', 'model.deployed', 'drift.detected'],
      note: 'Azure-native connector for registry, run, and monitoring events.'
    },
    {
      id: 'openlineage',
      name: 'OpenLineage',
      source: 'openlineage',
      status: 'enabled',
      endpoint: '/ingestor/events/openlineage',
      eventTypes: ['training.started', 'training.completed', 'dataset.linked'],
      note: 'Training and dataset lineage intake for pipeline evidence.'
    },
    {
      id: 'otel',
      name: 'OpenTelemetry',
      source: 'opentelemetry',
      status: 'enabled',
      endpoint: '/ingestor/events/opentelemetry/logs',
      eventTypes: ['inference.logged', 'drift.detected'],
      note: 'Production inference evidence through observability pipelines.'
    },
    {
      id: 'databricks',
      name: 'Databricks Unity Catalog',
      source: 'databricks',
      status: 'enabled',
      endpoint: '/ingestor/events/databricks',
      eventTypes: ['model.version.created', 'model.deployed', 'dataset.linked'],
      note: 'Unity Catalog model versions, aliases, serving, and lineage evidence.'
    },
    {
      id: 'vertexai',
      name: 'Vertex AI Audit Logs',
      source: 'vertexai',
      status: 'enabled',
      endpoint: '/ingestor/events/vertexai',
      eventTypes: ['model.registered', 'model.deployed', 'training.started'],
      note: 'Google Cloud audit logs routed through Pub/Sub into model lifecycle evidence.'
    }
  ];

  let stats = $state<any>(null);
  let authStatus = $state<any>(null);
  let health = $state<any>(null);
  let loading = $state(false);
  let simulating = $state(false);
  let copiedEndpoint = $state('');
  let error = $state<string | null>(null);
  let simulationResult = $state<any>(null);

  onMount(() => {
    loadStats();
  });

  async function loadStats() {
    loading = true;
    error = null;
    try {
      const [nextStats, nextAuthStatus, nextHealth] = await Promise.all([
        getIngestedEventStats(),
        getIngestorAuthStatus(),
        getIngestorHealth()
      ]);
      stats = nextStats;
      authStatus = nextAuthStatus;
      health = nextHealth;
    } catch (e: any) {
      error = e.message ?? 'Failed to load connector stats';
    } finally {
      loading = false;
    }
  }

  async function simulateConnector(connectorId: string) {
    simulating = true;
    simulationResult = null;
    error = null;
    try {
      if (connectorId === 'sagemaker') {
        simulationResult = await simulateSageMakerEvent();
      } else if (connectorId === 'azureml') {
        simulationResult = await simulateAzureMlEvent();
      } else if (connectorId === 'cloudevents') {
        simulationResult = await simulateCloudEventsEvent();
      } else if (connectorId === 'databricks') {
        simulationResult = await simulateDatabricksEvent();
      } else if (connectorId === 'vertexai') {
        simulationResult = await simulateVertexAiEvent();
      } else if (connectorId === 'openlineage') {
        simulationResult = await simulateOpenLineageEvent();
      } else if (connectorId === 'otel') {
        simulationResult = await simulateOpenTelemetryLogs();
      } else {
        simulationResult = await simulateHuggingFaceEvent();
      }
      await loadStats();
    } catch (e: any) {
      error = e.response?.data?.error ?? e.message ?? 'Failed to simulate connector event';
    } finally {
      simulating = false;
    }
  }

  async function copyEndpoint(endpoint: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${endpoint}`);
    copiedEndpoint = endpoint;
    setTimeout(() => {
      if (copiedEndpoint === endpoint) copiedEndpoint = '';
    }, 1800);
  }

  function sourceCount(source: string) {
    return stats?.bySource?.[source] ?? 0;
  }

  function eventTypeCount(eventType: string) {
    return stats?.byEventType?.[eventType] ?? 0;
  }

  function shortHash(value: string | undefined) {
    if (!value) return '-';
    return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
  }

  function latestMatches(connector: Connector) {
    return stats?.latest?.source === connector.source;
  }

  function healthBadgeClass() {
    return health?.status === 'healthy' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700';
  }
</script>

<div class="min-h-screen bg-slate-50">
  <div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4">
    <div class="max-w-7xl mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-4">
        <a href="/" class="btn-ghost text-sm py-1.5 px-3">Dashboard</a>
        <div>
          <h1 class="text-white font-bold text-lg leading-tight">Connectors</h1>
          <p class="text-blue-300 text-xs">External AI platforms wired into Ernest evidence ingestion</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        {#if canWrite}
          <button class="btn-ghost text-sm py-1.5 px-3" onclick={() => simulateConnector('huggingface')} disabled={simulating || loading}>
            {simulating ? 'Simulating...' : 'Simulate HF'}
          </button>
        {/if}
        <button class="btn-ghost text-sm py-1.5 px-3" onclick={loadStats} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <AccessBadge />
      </div>
    </div>
  </div>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
    {#if error}
      <div class="alert-error">{error}</div>
    {/if}

    {#if simulationResult}
      <section class="border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-lg px-4 py-3 text-sm flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>{simulationResult.provider} event accepted as <strong>{simulationResult.eventType}</strong>.</span>
        <span class="font-mono text-xs">{shortHash(simulationResult.rawEventHash)}</span>
      </section>
    {/if}

    <section class="grid grid-cols-1 sm:grid-cols-4 gap-4">
      <div class="card p-4">
        <div class="text-2xl font-bold text-blue-700">{stats?.total ?? 0}</div>
        <div class="text-sm font-medium text-slate-700">Ingested events</div>
      </div>
      <div class="card p-4">
        <div class="text-2xl font-bold text-blue-700">{connectors.filter((c) => c.status === 'enabled').length}</div>
        <div class="text-sm font-medium text-slate-700">Enabled</div>
      </div>
      <div class="card p-4">
        <div class="text-2xl font-bold text-blue-700">{connectors.filter((c) => c.status === 'planned').length}</div>
        <div class="text-sm font-medium text-slate-700">Planned</div>
      </div>
      <div class="card p-4">
        <div class="text-2xl font-bold text-blue-700">{stats?.latest?.blockIndex ? `#${stats.latest.blockIndex}` : '-'}</div>
        <div class="text-sm font-medium text-slate-700">Latest block</div>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {#each connectors as connector}
          <article class="card p-5 space-y-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-slate-900">{connector.name}</h2>
                <p class="mt-1 text-sm text-slate-500">{connector.note}</p>
              </div>
              <span class="text-xs px-2 py-1 rounded-full {connector.status === 'enabled' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}">
                {connector.status}
              </span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="rounded border border-slate-200 p-3">
                <div class="text-lg font-bold text-slate-900">{sourceCount(connector.source)}</div>
                <div class="text-xs text-slate-500">Events</div>
              </div>
              <div class="rounded border border-slate-200 p-3">
                <div class="text-lg font-bold text-slate-900">{latestMatches(connector) ? `#${stats.latest.blockIndex}` : '-'}</div>
                <div class="text-xs text-slate-500">Latest block</div>
              </div>
            </div>

            {#if connector.endpoint}
              <div class="rounded bg-slate-50 border border-slate-200 p-3">
                <div class="text-xs font-semibold text-slate-400 uppercase">Endpoint</div>
                <div class="mt-1 flex items-center gap-2">
                  <code class="min-w-0 flex-1 truncate text-xs text-slate-700">{connector.endpoint}</code>
                  <button class="btn-outline py-1 px-2 text-xs" onclick={() => copyEndpoint(connector.endpoint!)}>
                    {copiedEndpoint === connector.endpoint ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div class="mt-2 flex items-center justify-between gap-2 text-xs">
                  <span class="font-semibold text-slate-400 uppercase">Auth</span>
                  <span class="{authStatus?.mode === 'shared_secret' ? 'text-emerald-700' : 'text-slate-500'}">{authStatus?.mode ?? '-'}</span>
                </div>
              </div>
            {/if}

            <div>
              <div class="text-xs font-semibold text-slate-400 uppercase mb-2">Mapped event types</div>
              <div class="flex flex-wrap gap-2">
                {#each connector.eventTypes as eventType}
                  <span class="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
                    {eventType}
                    {#if eventTypeCount(eventType) > 0}
                      <span class="text-blue-400">· {eventTypeCount(eventType)}</span>
                    {/if}
                  </span>
                {/each}
              </div>
            </div>

            <div class="flex flex-wrap gap-2 pt-1">
              {#if canWrite && (connector.id === 'huggingface' || connector.id === 'sagemaker' || connector.id === 'azureml' || connector.id === 'cloudevents' || connector.id === 'databricks' || connector.id === 'vertexai' || connector.id === 'openlineage' || connector.id === 'otel')}
                <button class="btn-primary py-2 px-3 text-sm" onclick={() => simulateConnector(connector.id)} disabled={simulating}>
                  {simulating ? 'Simulating...' : 'Simulate'}
                </button>
              {/if}
              <a class="btn-outline py-2 px-3 text-sm" href={`/events?source=${encodeURIComponent(connector.source)}`}>View events</a>
            </div>
          </article>
        {/each}
      </div>

      <aside class="space-y-4">
        <section class="card p-5">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-base font-semibold text-slate-900">Ingestor Health</h2>
            <span class="text-xs px-2 py-1 rounded-full {healthBadgeClass()}">{health?.status ?? 'loading'}</span>
          </div>
          <dl class="mt-4 space-y-3 text-sm">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Ingestor</dt>
                <dd class="text-slate-800">{health?.ingestor?.status ?? '-'}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Latency</dt>
                <dd class="text-slate-800">{health?.ingestor?.latencyMs !== undefined ? `${health.ingestor.latencyMs} ms` : '-'}</dd>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Auth</dt>
                <dd class="text-slate-800">{health?.auth?.mode ?? authStatus?.mode ?? '-'}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">HF secret</dt>
                <dd class="text-slate-800">{health?.auth?.providerSecrets?.huggingface ?? '-'}</dd>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Provider HMAC</dt>
                <dd class="text-slate-800">{health?.auth?.providerSecrets?.providerHmac ?? '-'}</dd>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <a class="rounded border border-slate-200 p-3 hover:bg-blue-50" href="/events">
                <dt class="text-xs font-semibold text-slate-400 uppercase">Provider verified</dt>
                <dd class="text-lg font-bold text-emerald-700">{(health?.stats?.byVerificationStatus?.provider_secret ?? 0) + (health?.stats?.byVerificationStatus?.provider_hmac ?? 0)}</dd>
              </a>
              <a class="rounded border border-slate-200 p-3 hover:bg-red-50" href="/events">
                <dt class="text-xs font-semibold text-slate-400 uppercase">Auth rejected</dt>
                <dd class="text-lg font-bold {health?.failureStats?.byFailureKind?.auth_rejected ? 'text-red-700' : 'text-emerald-700'}">{health?.failureStats?.byFailureKind?.auth_rejected ?? 0}</dd>
              </a>
            </div>
            {#if health?.failureStats?.latest}
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Latest failure</dt>
                <dd class="text-xs text-red-700 truncate">{health.failureStats.latest.error}</dd>
              </div>
            {/if}
          </dl>
        </section>

        <section class="card p-5">
          <h2 class="text-base font-semibold text-slate-900">Latest ingested event</h2>
          {#if stats?.latest}
            <dl class="mt-4 space-y-3 text-sm">
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Source</dt>
                <dd class="text-slate-800">{stats.latest.source}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Event type</dt>
                <dd class="text-slate-800">{stats.latest.eventType}</dd>
              </div>
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Source event ID</dt>
                <dd class="font-mono text-xs text-slate-700 break-all">{stats.latest.sourceEventId}</dd>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <dt class="text-xs font-semibold text-slate-400 uppercase">Status</dt>
                  <dd class="text-slate-800">{stats.latest.status}</dd>
                </div>
                <div>
                  <dt class="text-xs font-semibold text-slate-400 uppercase">Block</dt>
                  <dd class="text-slate-800">{stats.latest.blockIndex ? `#${stats.latest.blockIndex}` : '-'}</dd>
                </div>
              </div>
              <div>
                <dt class="text-xs font-semibold text-slate-400 uppercase">Block hash</dt>
                <dd class="font-mono text-xs text-slate-700 break-all">{stats.latest.blockHash ?? '-'}</dd>
              </div>
            </dl>
          {:else}
            <p class="mt-4 text-sm text-slate-400">No ingested events yet.</p>
          {/if}
        </section>

        <section class="card p-5">
          <h2 class="text-base font-semibold text-slate-900">Top sources</h2>
          <div class="mt-4 space-y-3">
            {#each Object.entries(stats?.bySource ?? {}).slice(0, 6) as [source, count]}
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="truncate text-slate-700">{source}</span>
                <span class="font-semibold text-slate-900">{count}</span>
              </div>
            {:else}
              <p class="text-sm text-slate-400">No source metrics yet.</p>
            {/each}
          </div>
        </section>
      </aside>
    </section>
  </main>
</div>
