<script lang="ts">
  import { onMount } from 'svelte';
  import { authState } from '$lib/auth';
  import { refreshAuthRole, listAccessTokens, createAccessToken, revokeAccessToken, type AccessTokenSummary, type AccessTokenRole } from '$lib/api';

  let canWrite = $derived($authState.role === 'read-write');

  let tokens = $state<AccessTokenSummary[]>([]);
  let loading = $state(false);
  let listError = $state('');

  let label = $state('');
  let role = $state<AccessTokenRole>('read-only');
  let expiresInDays = $state<number | ''>('');
  let creating = $state(false);
  let createError = $state('');
  let justCreatedToken = $state('');

  onMount(async () => {
    await refreshAuthRole();
    if ($authState.role === 'read-write') await loadTokens();
  });

  async function loadTokens() {
    loading = true; listError = '';
    try {
      tokens = await listAccessTokens();
    } catch (e: any) {
      listError = e.message ?? 'Failed to load tokens';
    } finally {
      loading = false;
    }
  }

  async function submitCreate() {
    if (!label.trim()) return;
    creating = true; createError = ''; justCreatedToken = '';
    try {
      const result = await createAccessToken(label.trim(), role, expiresInDays === '' ? undefined : Number(expiresInDays));
      justCreatedToken = result.token;
      label = '';
      expiresInDays = '';
      await loadTokens();
    } catch (e: any) {
      createError = e.message ?? 'Failed to create token';
    } finally {
      creating = false;
    }
  }

  async function doRevoke(id: string) {
    try {
      await revokeAccessToken(id);
      await loadTokens();
    } catch (e: any) {
      listError = e.message ?? 'Failed to revoke token';
    }
  }

  function isExpired(t: AccessTokenSummary) {
    return !!t.expiresAt && new Date(t.expiresAt).getTime() < Date.now();
  }

  function statusOf(t: AccessTokenSummary): { label: string; cls: string } {
    if (t.revokedAt) return { label: 'Revoked', cls: 'bg-slate-100 text-slate-500' };
    if (isExpired(t)) return { label: 'Expired', cls: 'bg-amber-100 text-amber-700' };
    return { label: 'Active', cls: 'bg-emerald-100 text-emerald-700' };
  }

  async function copyToken() {
    try { await navigator.clipboard.writeText(justCreatedToken); } catch { /* clipboard may be unavailable */ }
  }
</script>

<div class="min-h-screen bg-slate-50">
  <div class="bg-blue-900 px-4 sm:px-6 lg:px-8 py-4">
    <div class="max-w-4xl mx-auto flex items-center gap-4">
      <a href="/" class="btn-ghost text-sm py-1.5 px-3">← Dashboard</a>
      <h1 class="text-white font-semibold text-lg">Access Tokens</h1>
    </div>
  </div>

  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    {#if $authState.role === 'loading'}
      <div class="card p-12 text-center text-slate-400 text-sm">Loading…</div>
    {:else if !canWrite}
      <div class="card p-8 text-center">
        <div class="text-sm text-slate-600">Managing access tokens requires read-write access.</div>
        <a href="/login?redirect=/settings/tokens" class="btn-primary text-sm mt-4 inline-block">Sign in</a>
      </div>
    {:else}
      <div class="card p-5">
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Issue a new token</h2>
        <p class="text-xs text-slate-500 mb-4">
          Give a named, revocable token to a specific team or auditor instead of sharing the standing read/write keys.
          A read-only token is safe to hand to an external auditor for a limited time.
        </p>

        {#if justCreatedToken}
          <div class="alert-success mb-4">
            <div class="text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-1">Token created — copy it now</div>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-xs bg-white border border-emerald-200 rounded px-2 py-1.5 overflow-x-auto text-emerald-900">{justCreatedToken}</code>
              <button onclick={copyToken} class="btn-outline text-xs py-1.5 px-3">Copy</button>
            </div>
            <p class="text-xs text-emerald-700 mt-2">This value is not stored — it cannot be shown again. If it's lost, revoke it and issue a new one.</p>
          </div>
        {/if}

        {#if createError}
          <div class="alert-error mb-3">{createError}</div>
        {/if}

        <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div class="sm:col-span-2">
            <label for="tok-label" class="text-xs text-slate-500 mb-1 block">Label</label>
            <input id="tok-label" bind:value={label} placeholder="Auditor - Acme Corp" class="input-field text-sm w-full" />
          </div>
          <div>
            <label for="tok-role" class="text-xs text-slate-500 mb-1 block">Role</label>
            <select id="tok-role" bind:value={role} class="input-field text-sm w-full">
              <option value="read-only">Read-only</option>
              <option value="read-write">Read-write</option>
            </select>
          </div>
          <div>
            <label for="tok-expiry" class="text-xs text-slate-500 mb-1 block">Expires in (days)</label>
            <input id="tok-expiry" type="number" min="1" bind:value={expiresInDays} placeholder="Never" class="input-field text-sm w-full" />
          </div>
        </div>
        <button onclick={submitCreate} disabled={creating || !label.trim()} class="btn-primary text-sm mt-4">
          {creating ? 'Creating…' : 'Create token'}
        </button>
      </div>

      <div class="card overflow-hidden">
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 pt-5 mb-3">Issued tokens</h2>
        {#if listError}
          <div class="alert-error mx-5 mb-3">{listError}</div>
        {/if}
        {#if loading}
          <div class="py-10 text-center text-slate-400 text-sm">Loading…</div>
        {:else if tokens.length === 0}
          <div class="py-10 text-center text-slate-400 text-sm">No tokens issued yet.</div>
        {:else}
          <table class="w-full text-sm">
            <thead>
              <tr class="text-xs text-slate-400 uppercase tracking-wider border-t border-slate-100">
                <th class="text-left font-medium px-5 py-2">Label</th>
                <th class="text-left font-medium px-2 py-2">Role</th>
                <th class="text-left font-medium px-2 py-2">Status</th>
                <th class="text-left font-medium px-2 py-2">Expires</th>
                <th class="text-left font-medium px-2 py-2">Last used</th>
                <th class="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {#each tokens as t}
                {@const s = statusOf(t)}
                <tr class="border-t border-slate-100">
                  <td class="px-5 py-2.5 font-medium text-slate-800">{t.label}</td>
                  <td class="px-2 py-2.5 text-slate-600">{t.role}</td>
                  <td class="px-2 py-2.5"><span class="text-xs px-2 py-0.5 rounded-full {s.cls}">{s.label}</span></td>
                  <td class="px-2 py-2.5 text-slate-500">{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : 'Never'}</td>
                  <td class="px-2 py-2.5 text-slate-500">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'Never'}</td>
                  <td class="px-5 py-2.5 text-right">
                    {#if !t.revokedAt}
                      <button onclick={() => doRevoke(t.id)} class="btn-outline text-xs py-1 px-2.5">Revoke</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/if}
  </div>
</div>
