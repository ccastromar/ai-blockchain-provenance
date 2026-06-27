<script lang="ts">
  import { onMount } from 'svelte';
  import { registerModel, getAllModels } from '$lib/api';

  let { onSuccess }: { onSuccess?: (modelId: string) => void } = $props();

  let existingModels = $state<any[]>([]);
  let selectedPreset = $state('');

  let modelId   = $state('');
  let modelName = $state('');
  let version   = $state('0.1.0');

  onMount(async () => {
    try { existingModels = await getAllModels(); } catch { existingModels = []; }
  });

  function applyPreset(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    selectedPreset = id;
    if (!id) return;
    const m = existingModels.find(m => m.modelId === id);
    if (!m) return;
    modelId   = m.modelId;
    modelName = m.name ?? '';
    version   = m.version ?? DEFAULTS.version;
  }
  let params    = $state('{"param1": "value1", "param2": 10}');
  let metrics   = $state('{"accuracy": 0.9, "f1_score": 0.85}');
  let metadata  = $state('{"dataset": "Sample Dataset", "framework": "PyTorch"}');
  let mlflow    = $state('{"modelHash": "0000000000000000000000000000000000000000000000000000000000000000", "gitCommit": "abcdef1234567890abcdef1234567890abcdef12"}');

  let loading = $state(false);
  let result  = $state<any>(null);
  let error   = $state<string | null>(null);

  const DEFAULTS = {
    version: '0.1.0',
    params:   '{"param1": "value1", "param2": 10}',
    metrics:  '{"accuracy": 0.9, "f1_score": 0.85}',
    metadata: '{"dataset": "Sample Dataset", "framework": "PyTorch"}',
    mlflow:   '{"modelHash": "0000000000000000000000000000000000000000000000000000000000000000", "gitCommit": "abcdef1234567890abcdef1234567890abcdef12"}'
  };

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    loading = true; error = null; result = null;

    try {
      const data = {
        modelId, modelName, version,
        params:   params   ? JSON.parse(params)   : {},
        metrics:  metrics  ? JSON.parse(metrics)  : {},
        metadata: metadata ? JSON.parse(metadata) : {},
        mlflow:   mlflow   ? JSON.parse(mlflow)   : {}
      };
      const submittedId = modelId;
      result = await registerModel(data);

      modelId = ''; modelName = ''; version = DEFAULTS.version;
      params = DEFAULTS.params; metrics = DEFAULTS.metrics;
      metadata = DEFAULTS.metadata; mlflow = DEFAULTS.mlflow;

      onSuccess?.(submittedId);
    } catch (err: any) {
      error = err.response?.data?.message || err.message || 'Failed to register model';
    } finally {
      loading = false;
    }
  }
</script>

<div class="max-w-2xl space-y-6">
  <div>
    <h2 class="text-xl font-semibold text-slate-800">Register AI Model</h2>
    <p class="text-sm text-slate-500 mt-1">Add a new model to the blockchain provenance chain</p>
  </div>

  {#if existingModels.length}
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <label for="reg-preset" class="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2 block">
        Quick-fill from existing model
      </label>
      <select id="reg-preset" onchange={applyPreset} bind:value={selectedPreset} class="field-input text-sm">
        <option value="">— Select a model to pre-fill —</option>
        {#each existingModels as m}
          <option value={m.modelId}>{m.modelId} · {m.name ?? 'No name'} · v{m.version}</option>
        {/each}
      </select>
      <p class="text-xs text-blue-500 mt-1.5">Fills Model ID, Name and Version. Adjust the rest before submitting.</p>
    </div>
  {/if}

  <form onsubmit={handleSubmit} class="space-y-4">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="field-label" for="reg-modelId">Model ID *</label>
        <input id="reg-modelId" type="text" required bind:value={modelId} class="field-input"
          placeholder="chest-xray-classifier-v1" />
      </div>
      <div>
        <label class="field-label" for="reg-version">Version *</label>
        <input id="reg-version" type="text" required bind:value={version} class="field-input"
          placeholder="1.0.0" />
      </div>
    </div>

    <div>
      <label class="field-label" for="reg-modelName">Model Name *</label>
      <input id="reg-modelName" type="text" required bind:value={modelName} class="field-input"
        placeholder="Chest X-ray Classifier v1" />
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="field-label" for="reg-params">Parameters (JSON)</label>
        <textarea id="reg-params" rows={4} bind:value={params} class="field-input font-mono text-xs"
          placeholder="learning_rate, epochs..."></textarea>
      </div>
      <div>
        <label class="field-label" for="reg-metrics">Metrics (JSON)</label>
        <textarea id="reg-metrics" rows={4} bind:value={metrics} class="field-input font-mono text-xs"
          placeholder="accuracy, f1_score..."></textarea>
      </div>
    </div>

    <div>
      <label class="field-label" for="reg-metadata">Metadata (JSON)</label>
      <textarea id="reg-metadata" rows={3} bind:value={metadata} class="field-input font-mono text-xs"
        placeholder="dataset, framework, author..."></textarea>
    </div>

    <div>
      <label class="field-label" for="reg-mlflow">MLFlow (JSON)</label>
      <textarea id="reg-mlflow" rows={3} bind:value={mlflow} class="field-input font-mono text-xs"
        placeholder="modelHash, gitCommit..."></textarea>
    </div>

    <button type="submit" disabled={loading} class="btn-primary w-full">
      {loading ? 'Registering…' : 'Register Model'}
    </button>
  </form>

  {#if error}
    <div class="alert-error">{error}</div>
  {/if}

  {#if result}
    <div class="alert-success">
      <h3 class="font-semibold text-emerald-800 mb-2">✓ Model Registered Successfully</h3>
      <dl class="text-sm text-emerald-700 space-y-1">
        <div><dt class="inline font-medium">Model ID: </dt><dd class="inline">{result.modelId}</dd></div>
        <div><dt class="inline font-medium">Block: </dt><dd class="inline">#{result.blockIndex}</dd></div>
        <div><dt class="inline font-medium">Hash: </dt><dd class="inline font-mono text-xs break-all">{result.blockHash}</dd></div>
      </dl>
    </div>
  {/if}
</div>
