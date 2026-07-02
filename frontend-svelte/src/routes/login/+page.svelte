<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { authState, setActiveKey, clearActiveKey } from '$lib/auth';
  import { refreshAuthRole } from '$lib/api';

  let keyInput = $state('');
  let submitting = $state(false);
  let error = $state('');

  onMount(() => { refreshAuthRole(); });

  const redirectTo = $derived($page.url.searchParams.get('redirect') || '/');

  const ROLE_LABEL: Record<string, string> = {
    'read-write': 'Full access (read-write)',
    'read-only': 'Read-only',
    anonymous: 'No access',
    loading: '…'
  };

  async function signIn() {
    if (!keyInput.trim()) return;
    submitting = true;
    error = '';
    setActiveKey(keyInput.trim());
    await refreshAuthRole();
    submitting = false;
    if ($authState.role === 'anonymous') {
      error = 'That key was not recognized. Check it and try again.';
      return;
    }
    keyInput = '';
    goto(redirectTo);
  }

  async function signOut() {
    clearActiveKey();
    await refreshAuthRole();
  }
</script>

<div class="min-h-screen bg-slate-50 flex items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <div class="text-center mb-6">
      <div class="w-10 h-10 mx-auto bg-blue-900 rounded-lg flex items-center justify-center font-bold text-white text-lg">E</div>
      <h1 class="mt-3 text-lg font-bold text-slate-900">Sign in to Ernest</h1>
      <p class="text-xs text-slate-500 mt-1">Paste the access key or token you were given.</p>
    </div>

    <div class="card p-6 space-y-4">
      {#if $authState.role !== 'loading' && $authState.role !== 'anonymous'}
        <div class="alert-success text-sm text-emerald-800">
          Signed in as <strong>{ROLE_LABEL[$authState.role]}</strong>{#if $authState.label} · {$authState.label}{/if}
        </div>
        <div class="flex gap-2">
          <a href={redirectTo} class="btn-primary text-sm flex-1 text-center">Continue</a>
          <button onclick={signOut} class="btn-outline text-sm">Sign out</button>
        </div>
        {#if $authState.role === 'read-write'}
          <a href="/settings/tokens" class="block text-center text-xs text-blue-700 hover:underline pt-2">
            Manage access tokens →
          </a>
        {/if}
      {:else}
        {#if error}
          <div class="alert-error text-sm">{error}</div>
        {/if}
        <div>
          <label for="access-key" class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Access key or token</label>
          <input
            id="access-key"
            type="password"
            bind:value={keyInput}
            onkeydown={(e) => e.key === 'Enter' && signIn()}
            placeholder="ernest_ro_… or your admin key"
            class="input-field text-sm w-full" />
        </div>
        <button onclick={signIn} disabled={submitting || !keyInput.trim()} class="btn-primary text-sm w-full">
          {submitting ? 'Checking…' : 'Sign in'}
        </button>
        <p class="text-xs text-slate-400 text-center">Stored only for this browser tab.</p>
      {/if}
    </div>

    <a href="/" class="block text-center text-xs text-slate-400 hover:text-slate-600 mt-4">← Back to dashboard</a>
  </div>
</div>
