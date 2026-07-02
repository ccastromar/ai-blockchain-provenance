<script lang="ts">
  import { onMount } from 'svelte';
  import { logInference, getAllModelIds } from '$lib/api';
  import { authState } from '$lib/auth';

  let { initialModelId = '', onSuccess }: {
    initialModelId?: string;
    onSuccess?: (modelId: string) => void;
  } = $props();
  let canWrite = $derived($authState.role === 'read-write');

  function randomHash() {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  let modelId    = $state('');
  let inferenceId = $state('f61c7b91-2e83-4f4a-8c9b-7c0cb90fca1e');
  let input      = $state('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1');
  let outputHash = $state('d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2');
  let params     = $state('{"threshold": 0.8, "preprocessing": "normalize"}');
  let metadata   = $state('{"dataset": "ChestX-ray14", "framework": "TensorFlow"}');

  let loading  = $state(false);
  let result   = $state<any>(null);
  let error    = $state<string | null>(null);
  let modelIds = $state<string[]>([]);

  onMount(async () => {
    modelId = initialModelId;
    try { modelIds = await getAllModelIds(); } catch { modelIds = []; }
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    loading = true; error = null; result = null;

    try {
      result = await logInference({
        modelId, inferenceId,
        inputHash: input, outputHash,
        params:   params   ? JSON.parse(params)   : {},
        metadata: metadata ? JSON.parse(metadata) : {}
      });
      onSuccess?.(modelId);
    } catch (err: any) {
      error = err.response?.data?.message || err.message || 'Failed to log inference';
    } finally {
      loading = false;
    }
  }
</script>

<div class="max-w-2xl space-y-6">
  <div>
    <h2 class="text-xl font-semibold text-slate-800">Log Inference</h2>
    <p class="text-sm text-slate-500 mt-1">Record a model inference event on the blockchain</p>
  </div>

  <form onsubmit={handleSubmit} class="space-y-4">
    <div>
      <label class="field-label" for="inf-modelId">Model ID *</label>
      {#if modelIds.length}
        <select id="inf-modelId" bind:value={modelId} class="field-input">
          <option value="">— Select a model —</option>
          {#each modelIds as id}
            <option value={id}>{id}</option>
          {/each}
        </select>
      {:else}
        <input id="inf-modelId" type="text" required bind:value={modelId} class="field-input"
          placeholder="chest-xray-classifier-v1" />
      {/if}
    </div>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <label class="field-label mb-0" for="inf-input">Input Hash *</label>
        <button type="button" onclick={() => input = randomHash()}
          class="text-xs text-blue-600 hover:text-blue-800 font-medium">⟳ Generate</button>
      </div>
      <textarea id="inf-input" required rows={2} bind:value={input} class="field-input font-mono text-xs"
        placeholder="a1a1a1…"></textarea>
    </div>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <label class="field-label mb-0" for="inf-output">Output Hash *</label>
        <button type="button" onclick={() => outputHash = randomHash()}
          class="text-xs text-blue-600 hover:text-blue-800 font-medium">⟳ Generate</button>
      </div>
      <textarea id="inf-output" required rows={2} bind:value={outputHash} class="field-input font-mono text-xs"
        placeholder="d2d2d2…"></textarea>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="field-label" for="inf-params">Parameters (JSON)</label>
        <textarea id="inf-params" rows={3} bind:value={params} class="field-input font-mono text-xs"
          placeholder="threshold, preprocessing..."></textarea>
      </div>
      <div>
        <label class="field-label" for="inf-meta">Metadata (JSON)</label>
        <textarea id="inf-meta" rows={3} bind:value={metadata} class="field-input font-mono text-xs"
          placeholder="dataset, framework..."></textarea>
      </div>
    </div>

    {#if !canWrite}
      <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
        Read-only access — logging an inference requires a read-write key.
      </p>
    {/if}
    <button type="submit" disabled={loading || !canWrite} class="btn-primary w-full">
      {loading ? 'Logging…' : 'Execute & Log Inference'}
    </button>
  </form>

  {#if error}
    <div class="alert-error">{error}</div>
  {/if}

  {#if result}
    <div class="alert-success space-y-3">
      <h3 class="font-semibold text-emerald-800">✓ Inference Logged Successfully</h3>
      <dl class="text-sm text-emerald-700 space-y-1">
        <div><dt class="inline font-medium">Inference ID: </dt><dd class="inline">{result.inferenceId}</dd></div>
        <div><dt class="inline font-medium">Block: </dt><dd class="inline">#{result.blockIndex}</dd></div>
        <div><dt class="inline font-medium">Hash: </dt><dd class="inline font-mono text-xs break-all">{result.blockHash}</dd></div>
      </dl>
      {#if result.output}
        <div class="border-t border-emerald-200 pt-3">
          <div class="text-xs font-medium text-emerald-800 mb-1">Output</div>
          <pre class="bg-white/60 p-2 rounded text-xs overflow-x-auto text-emerald-900">{JSON.stringify(result.output, null, 2)}</pre>
        </div>
      {/if}
      {#if result.hashes}
        <div class="border-t border-emerald-200 pt-3 text-xs text-emerald-700 space-y-1">
          <div><strong>Input hash: </strong><code class="break-all">{result.hashes.input}</code></div>
          <div><strong>Output hash: </strong><code class="break-all">{result.hashes.output}</code></div>
        </div>
      {/if}
    </div>
  {/if}
</div>
