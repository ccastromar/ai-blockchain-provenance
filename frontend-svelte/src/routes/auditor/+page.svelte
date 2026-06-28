<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import {
    getAllModels,
    getChainStats,
    getModelById,
    getProvenance,
    verifyChain
  } from '$lib/api';
  import {
    buildLocalAuditReport,
    buildWebLlmPrompt,
    getModelId,
    type LocalAuditReport
  } from '$lib/local-auditor';

  const webLlmModuleUrl = 'https://esm.run/@mlc-ai/web-llm';
  const defaultWebLlmModel = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';

  let models = $state<any[]>([]);
  let selectedModelId = $state('');
  let selectedModel = $state<any>(null);
  let provenance = $state<any>(null);
  let stats = $state<any>(null);
  let verification = $state<any>(null);
  let report = $state<LocalAuditReport | null>(null);
  let loading = $state(false);
  let loadingModels = $state(true);
  let error = $state('');

  let webLlmEngine = $state<any>(null);
  let webLlmModel = $state(defaultWebLlmModel);
  let webLlmStatus = $state('Idle');
  let webLlmProgress = $state('');
  let webLlmMemo = $state('');
  let webLlmError = $state('');
  let runningMemo = $state(false);
  let chainLooksValid = $derived((verification?.isValid ?? stats?.chainValid) === true);

  onMount(() => {
    loadInitialData();
  });

  async function loadInitialData() {
    loadingModels = true;
    error = '';

    try {
      const [loadedModels, loadedStats, loadedVerification] = await Promise.all([
        getAllModels(),
        getChainStats(),
        verifyChain()
      ]);

      models = loadedModels;
      stats = loadedStats;
      verification = loadedVerification;
      selectedModelId = getModelId(models[0]);

      if (selectedModelId && selectedModelId !== 'unknown-model') {
        await runAudit();
      }
    } catch (e: any) {
      error = e?.message ?? 'Could not load auditor data.';
    } finally {
      loadingModels = false;
    }
  }

  async function runAudit() {
    if (!selectedModelId) return;

    loading = true;
    error = '';
    webLlmMemo = '';

    try {
      const listedModel = models.find((model) => getModelId(model) === selectedModelId) ?? null;
      const [modelResult, provenanceResult, loadedStats, loadedVerification] = await Promise.all([
        getModelById(selectedModelId).catch(() => listedModel ?? { modelId: selectedModelId }),
        getProvenance(selectedModelId).catch(() => ({ blocks: [] })),
        getChainStats(),
        verifyChain()
      ]);

      const model = modelResult ?? listedModel ?? { modelId: selectedModelId };
      selectedModel = model;
      provenance = provenanceResult;
      stats = loadedStats;
      verification = loadedVerification;
      report = buildLocalAuditReport({ model, provenance: provenanceResult, stats: loadedStats, verification: loadedVerification });
    } catch (e: any) {
      error = e?.message ?? 'Could not run local audit.';
    } finally {
      loading = false;
    }
  }

  async function loadWebLlm() {
    webLlmError = '';
    webLlmStatus = 'Checking browser';

    if (!browser || !('gpu' in navigator)) {
      webLlmStatus = 'Unavailable';
      webLlmError = 'This browser does not expose WebGPU. The deterministic local audit is still available.';
      return;
    }

    try {
      webLlmStatus = 'Loading module';
      const webllm: any = await import(/* @vite-ignore */ webLlmModuleUrl);
      const createEngine = webllm.CreateMLCEngine ?? webllm.CreateWebWorkerMLCEngine;

      if (!createEngine) {
        throw new Error('WebLLM engine factory was not found in the loaded module.');
      }

      webLlmStatus = 'Loading model';
      webLlmEngine = await createEngine(webLlmModel, {
        initProgressCallback: (progress: any) => {
          webLlmProgress = progress?.text ?? `${Math.round((progress?.progress ?? 0) * 100)}%`;
        }
      });
      webLlmStatus = 'Ready';
    } catch (e: any) {
      webLlmStatus = 'Failed';
      webLlmError = e?.message ?? 'Could not load WebLLM.';
    }
  }

  async function generateMemo() {
    if (!report || !selectedModel) return;

    if (!webLlmEngine) {
      await loadWebLlm();
    }

    if (!webLlmEngine) return;

    runningMemo = true;
    webLlmError = '';
    webLlmMemo = '';

    try {
      const completion = await webLlmEngine.chat.completions.create({
        messages: [
          { role: 'system', content: 'You write precise AI governance audit notes.' },
          { role: 'user', content: buildWebLlmPrompt(selectedModel, report) }
        ],
        temperature: 0.2
      });

      webLlmMemo = completion?.choices?.[0]?.message?.content ?? '';
    } catch (e: any) {
      webLlmError = e?.message ?? 'Could not generate the local memo.';
    } finally {
      runningMemo = false;
    }
  }

  function downloadEvidence() {
    if (!report || !browser) return;

    const filename = `ernest-local-audit-${selectedModelId || 'model'}.md`;
    const blob = new Blob([report.evidencePacket], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="min-h-screen bg-slate-50">
  <header class="bg-blue-900 shadow-lg">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
      <div class="flex flex-col gap-4 md:flex-row md:items-center">
        <div class="flex-1">
          <a href="/" class="inline-flex items-center gap-3">
            <div class="w-9 h-9 bg-sky-400 rounded-lg flex items-center justify-center font-bold text-blue-900 text-lg">E</div>
            <div>
              <h1 class="text-xl font-bold text-white tracking-tight">Local Auditor</h1>
              <p class="text-xs text-blue-200 leading-none mt-0.5">Browser-side evidence review</p>
            </div>
          </a>
        </div>

        <nav class="flex flex-wrap items-center gap-2">
          <a href="/" class="btn-ghost text-sm py-2 px-4">Dashboard</a>
          <a href="/models" class="btn-ghost text-sm py-2 px-4">Models</a>
          <a href="/stats" class="btn-ghost text-sm py-2 px-4">Statistics</a>
        </nav>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
    <section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="card p-6 space-y-5">
        <div>
          <p class="text-sm font-medium text-blue-700">Ernest add-on</p>
          <h2 class="text-2xl font-bold text-slate-900 mt-1">Local WebLLM audit cockpit</h2>
          <p class="text-sm text-slate-600 mt-2 max-w-3xl">
            Review a model evidence packet in the browser, export a concise audit note, and optionally use WebLLM locally when WebGPU is available.
          </p>
        </div>

        {#if error}
          <div class="alert-error">{error}</div>
        {/if}

        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label>
            <span class="field-label">Model</span>
            <select class="field-input" bind:value={selectedModelId} disabled={loadingModels || models.length === 0}>
              {#each models as model}
                <option value={getModelId(model)}>
                  {model.modelName ?? model.name ?? getModelId(model)} · {getModelId(model)}
                </option>
              {/each}
            </select>
          </label>

          <button class="btn-primary min-w-36" onclick={runAudit} disabled={!selectedModelId || loading}>
            {loading ? 'Auditing...' : 'Run audit'}
          </button>
        </div>

        {#if loadingModels}
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Loading models...</div>
        {:else if models.length === 0}
          <div class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No models available yet. Register one from the dashboard to create an evidence packet.</div>
        {/if}
      </div>

      <aside class="card p-6">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Evidence state</h3>
        <div class="mt-5 grid grid-cols-3 gap-3 text-center lg:grid-cols-1 lg:text-left">
          <div class="rounded-lg bg-slate-50 p-3">
            <div class="text-2xl font-bold text-slate-900">{stats?.totalBlocks ?? '-'}</div>
            <div class="text-xs text-slate-500">Blocks</div>
          </div>
          <div class="rounded-lg bg-slate-50 p-3">
            <div class="text-2xl font-bold {chainLooksValid ? 'text-emerald-700' : 'text-red-700'}">
              {chainLooksValid ? 'Valid' : 'Check'}
            </div>
            <div class="text-xs text-slate-500">Hashchain</div>
          </div>
          <div class="rounded-lg bg-slate-50 p-3">
            <div class="text-2xl font-bold text-slate-900">{stats?.latestAnchor || stats?.lastAnchor ? 'Yes' : 'No'}</div>
            <div class="text-xs text-slate-500">Latest anchor</div>
          </div>
        </div>
      </aside>
    </section>

    {#if report}
      <section class="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div class="card p-6 space-y-5">
          <div>
            <p class="text-sm font-medium text-slate-500">Audit score</p>
            <div class="mt-2 flex items-end gap-2">
              <span class="text-5xl font-bold text-slate-900">{report.score}</span>
              <span class="pb-2 text-sm font-semibold text-slate-500">/100</span>
            </div>
            <p class="mt-3 text-sm text-slate-600">{report.summary}</p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg bg-slate-50 p-3">
              <div class="text-2xl font-bold text-slate-900">{report.eventCount}</div>
              <div class="text-xs text-slate-500">Events</div>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <div class="text-2xl font-bold text-slate-900">{report.inferenceCount}</div>
              <div class="text-xs text-slate-500">Inferences</div>
            </div>
          </div>

          <button class="btn-outline w-full" onclick={downloadEvidence}>Download evidence</button>
        </div>

        <div class="space-y-6">
          <section class="card p-6">
            <h3 class="text-lg font-semibold text-slate-900">Findings</h3>
            <div class="mt-4 space-y-3">
              {#each report.findings as finding}
                <div class="rounded-lg border border-slate-200 p-4">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-md px-2 py-1 text-xs font-semibold uppercase {finding.level === 'high' ? 'bg-red-100 text-red-700' : finding.level === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}">
                      {finding.level}
                    </span>
                    <h4 class="font-semibold text-slate-900">{finding.title}</h4>
                  </div>
                  <p class="mt-2 text-sm text-slate-600">{finding.detail}</p>
                </div>
              {/each}
            </div>
          </section>

          <section class="grid gap-6 md:grid-cols-2">
            <div class="card p-6">
              <h3 class="text-lg font-semibold text-slate-900">Missing evidence</h3>
              <ul class="mt-4 space-y-2 text-sm text-slate-600">
                {#each report.missingEvidence.length ? report.missingEvidence : ['None detected by local checks'] as item}
                  <li class="rounded-lg bg-slate-50 px-3 py-2">{item}</li>
                {/each}
              </ul>
            </div>

            <div class="card p-6">
              <h3 class="text-lg font-semibold text-slate-900">Recommended actions</h3>
              <ul class="mt-4 space-y-2 text-sm text-slate-600">
                {#each report.recommendedActions as action}
                  <li class="rounded-lg bg-slate-50 px-3 py-2">{action}</li>
                {/each}
              </ul>
            </div>
          </section>
        </div>
      </section>

      <section class="card p-6 space-y-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div class="flex-1">
            <p class="text-sm font-medium text-blue-700">Optional local LLM</p>
            <h3 class="text-lg font-semibold text-slate-900 mt-1">Generate browser-side audit memo</h3>
            <p class="text-sm text-slate-600 mt-2">
              WebLLM runs in the browser with WebGPU support. No prompt or evidence packet is sent to Ernest or a third-party API by this page.
            </p>
          </div>
          <label class="lg:w-96">
            <span class="field-label">WebLLM model</span>
            <input class="field-input" bind:value={webLlmModel} />
          </label>
        </div>

        <div class="flex flex-wrap gap-3">
          <button class="btn-outline" onclick={loadWebLlm} disabled={webLlmStatus === 'Loading module' || webLlmStatus === 'Loading model'}>
            Load WebLLM
          </button>
          <button class="btn-secondary" onclick={generateMemo} disabled={runningMemo || !report}>
            {runningMemo ? 'Generating...' : 'Generate memo'}
          </button>
          <div class="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
            Status: <span class="font-semibold text-slate-900">{webLlmStatus}</span>{webLlmProgress ? ` - ${webLlmProgress}` : ''}
          </div>
        </div>

        {#if webLlmError}
          <div class="alert-error">{webLlmError}</div>
        {/if}

        {#if webLlmMemo}
          <pre class="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-950 p-5 text-sm leading-6 text-slate-100">{webLlmMemo}</pre>
        {:else}
          <pre class="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">{report.evidencePacket}</pre>
        {/if}
      </section>
    {/if}
  </main>
</div>
