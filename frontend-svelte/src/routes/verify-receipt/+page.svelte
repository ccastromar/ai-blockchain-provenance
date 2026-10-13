<script lang="ts">
  import { onMount } from 'svelte';

  // The verifier runs entirely in the browser via WebAssembly (merkle-wasm, Rust):
  // no request leaves this page. The wasm implementation is pinned byte-for-byte to
  // the backend and Go verifiers by the shared golden fixtures in testdata/.
  let wasmReady = $state(false);
  let wasmError = $state('');
  let verifyReceipt: ((json: string) => string) | null = null;
  let verifyEventProof: ((json: string) => string) | null = null;

  let receiptText = $state('');
  let fileName = $state('');
  let result = $state<any>(null);
  let anchorInfo = $state<any>(null);
  let blockInfo = $state<any>(null);
  // ADR-004 event proof (GET /api/events/{source}/{eventId}/proof) rather than a block receipt.
  let eventInfo = $state<any>(null);
  let anchoredRoot = $state<string | null>(null);

  onMount(async () => {
    try {
      const wasm = await import('$lib/merkle-wasm/merkle_wasm.js');
      await wasm.default();
      verifyReceipt = wasm.verify_receipt;
      verifyEventProof = wasm.verify_event_proof;
      wasmReady = true;
    } catch (e: any) {
      wasmError = e?.message ?? 'Could not load the WebAssembly verifier.';
    }
  });

  async function onFileChosen(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    fileName = file.name;
    receiptText = await file.text();
    runVerification();
  }

  function runVerification() {
    result = null;
    anchorInfo = null;
    blockInfo = null;
    eventInfo = null;
    anchoredRoot = null;
    if (!verifyReceipt || !verifyEventProof || !receiptText.trim()) return;

    let parsed: any = null;
    try {
      parsed = JSON.parse(receiptText);
    } catch {
      /* the verifier reports the parse error */
    }
    if (parsed?.inclusion) {
      result = JSON.parse(verifyEventProof(receiptText));
      eventInfo = parsed.event ?? null;
      blockInfo = parsed.block ?? null;
      anchorInfo = parsed.anchor?.anchor ?? null;
      anchoredRoot = parsed.anchor?.merkleRoot ?? null;
    } else {
      result = JSON.parse(verifyReceipt(receiptText));
      anchorInfo = parsed?.anchor ?? null;
      blockInfo = parsed?.block ?? null;
      anchoredRoot = parsed?.merkleRoot ?? null;
    }
  }
</script>

<div class="min-h-screen bg-slate-50">
  <div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4">
    <div class="max-w-4xl mx-auto flex items-center gap-4">
      <a href="/blocks" class="btn-ghost text-sm py-1.5 px-3">← Blocks</a>
      <h1 class="text-white font-semibold text-lg">Verify Evidence Receipt</h1>
    </div>
  </div>

  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    <div class="card p-5">
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Offline verification</h2>
      <p class="text-sm text-slate-600 mb-4">
        Drop an inclusion receipt (downloaded from a block's <em>⬇ Receipt</em> button or
        <code class="text-xs bg-slate-100 px-1 rounded">GET /api/blocks/:index/proof</code>), or an event proof
        (<code class="text-xs bg-slate-100 px-1 rounded">GET /api/events/:source/:eventId/proof</code>).
        Verification runs entirely in your browser via WebAssembly — nothing is sent anywhere:
        the block data must reproduce its hash, and the hash must climb the Merkle proof to the anchored root.
      </p>

      {#if wasmError}
        <div class="alert-error">{wasmError}</div>
      {:else if !wasmReady}
        <div class="text-sm text-slate-400">Loading WebAssembly verifier…</div>
      {:else}
        <div class="flex flex-col gap-3">
          <input type="file" accept=".json,application/json" onchange={onFileChosen}
            class="text-sm text-slate-600 file:btn-outline file:text-xs file:py-1.5 file:px-3 file:mr-3" />
          <textarea
            bind:value={receiptText}
            oninput={() => runVerification()}
            placeholder={'…or paste the receipt JSON here'}
            rows="6"
            class="input-field text-xs font-mono w-full"></textarea>
        </div>
      {/if}
    </div>

    {#if result}
      <div class="card p-5 space-y-3">
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Verdict{fileName ? ` · ${fileName}` : ''}</h2>

        {#if result.error}
          <div class="alert-error text-sm">{result.error}</div>
        {:else}
          <div class="rounded-lg p-4 border {result.valid ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}">
            <p class="font-semibold text-lg {result.valid ? 'text-emerald-800' : 'text-red-800'}">
              {result.valid ? '✓ Receipt verified' : '✗ Receipt INVALID'}
            </p>
          </div>

          <ul class="text-sm space-y-2">
            {#if eventInfo}
              <li class={result.leafMatchesData ? 'text-emerald-700' : 'text-red-700'}>
                {result.leafMatchesData ? '✓' : '✗'} Event data reproduces its {result.kind === 'batch' ? 'leaf hash' : 'block data'}
              </li>
              {#if result.kind === 'batch'}
                <li class={result.inclusionReachesBlock ? 'text-emerald-700' : 'text-red-700'}>
                  {result.inclusionReachesBlock ? '✓' : '✗'} RFC 6962 audit path ({result.auditPathLength} hashes) reaches the batch root committed in the block
                </li>
              {/if}
            {/if}
            <li class={result.dataMatchesHash ? 'text-emerald-700' : 'text-red-700'}>
              {result.dataMatchesHash ? '✓' : '✗'} Block data reproduces its hash
              {#if !result.dataMatchesHash && result.computedHash}
                <div class="font-mono text-xs text-slate-500 mt-1">computed: {result.computedHash}</div>
              {/if}
            </li>
            {#if !eventInfo}
              <li class={result.proofReachesRoot ? 'text-emerald-700' : 'text-red-700'}>
                {result.proofReachesRoot ? '✓' : '✗'} Merkle proof ({result.proofLength} hashes) reaches the anchored root
              </li>
            {:else if result.anchored}
              <li class={result.anchorProofReachesRoot ? 'text-emerald-700' : 'text-red-700'}>
                {result.anchorProofReachesRoot ? '✓' : '✗'} Anchor proof reaches the anchored root
              </li>
            {:else}
              <li class="text-slate-500">○ Block not covered by an anchor yet — fetch the proof again once it is</li>
            {/if}
            {#if result.signaturePresent}
              <li class={result.signatureValid ? 'text-emerald-700' : 'text-red-700'}>
                {result.signatureValid ? '✓' : '✗'} Emitter signature — signed by <span class="font-mono">{result.signedBy}</span>
                {#if !result.signatureValid && result.error}
                  <div class="text-xs text-slate-500 mt-1">{result.error}</div>
                {/if}
              </li>
            {/if}
          </ul>

          {#if result.valid && blockInfo && anchorInfo}
            <div class="border-t border-slate-100 pt-3 text-sm text-slate-600 space-y-1">
              {#if eventInfo}
                <div>Event <span class="font-mono">{eventInfo.source} / {eventInfo.eventId}</span> · seq {eventInfo.seq} · {eventInfo.data?.type ?? '—'}</div>
              {/if}
              <div>Block <span class="font-mono text-blue-700">#{blockInfo.index}</span> · {blockInfo.data?.type ?? '—'}{#if blockInfo.data?.modelId} · model <span class="font-mono">{blockInfo.data.modelId}</span>{/if}</div>
              <div class="text-xs text-slate-500">Anchored root: <span class="font-mono break-all">{anchoredRoot ?? '—'}</span></div>
              {#if anchorInfo.provider === 'ots'}
                <div class="text-xs text-slate-500">Anchoring: OpenTimestamps (Bitcoin){anchorInfo.bitcoinBlockHeight ? `, attested at block ${anchorInfo.bitcoinBlockHeight}` : ' — pending aggregation'}</div>
                <div class="text-xs text-slate-500">Anchored at {anchorInfo.anchoredAt} · covers blocks 0..{anchorInfo.lastBlockIndex}</div>
                <p class="text-xs text-slate-400 pt-1">To complete the chain of trust, verify the OpenTimestamps proof against Bitcoin (download the .ots proof and root from Ernest, then <code class="bg-slate-100 px-1 rounded">ots verify</code>).</p>
              {:else}
                <div class="text-xs text-slate-500">Anchor tx: <span class="font-mono break-all">{anchorInfo.txHash}</span> (chainId {anchorInfo.chainId})</div>
                <div class="text-xs text-slate-500">Anchored at {anchorInfo.anchoredAt} · covers blocks 0..{anchorInfo.lastBlockIndex}</div>
                <p class="text-xs text-slate-400 pt-1">To complete the chain of trust, confirm that transaction records this root on the public chain.</p>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>
