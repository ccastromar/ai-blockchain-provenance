<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { completeLogin } from '$lib/oidc';
  import { refreshAuthRole } from '$lib/api';

  let error = $state('');

  onMount(async () => {
    try {
      const returnTo = await completeLogin();
      await refreshAuthRole();
      goto(returnTo, { replaceState: true });
    } catch (e) {
      error = (e as Error).message;
    }
  });
</script>

<div class="min-h-screen bg-slate-50 flex items-center justify-center px-4">
  <div class="w-full max-w-sm text-center">
    {#if error}
      <div class="card p-6 space-y-3">
        <h1 class="text-lg font-bold text-slate-900">Sign-in failed</h1>
        <div class="alert-error text-sm">{error}</div>
        <a href="/login" class="btn-primary text-sm inline-block">Back to sign in</a>
      </div>
    {:else}
      <div class="card p-6">
        <div class="w-8 h-8 mx-auto border-2 border-blue-900 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-sm text-slate-500 mt-3">Completing sign-in…</p>
      </div>
    {/if}
  </div>
</div>
