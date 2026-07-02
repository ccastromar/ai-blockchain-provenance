<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { authState } from '$lib/auth';
  import { refreshAuthRole } from '$lib/api';

  onMount(() => { refreshAuthRole(); });

  const ROLE_LABEL: Record<string, string> = {
    'read-write': '🔓 Full access',
    'read-only': '👁 Read-only',
    anonymous: '🔒 No access',
    loading: '…'
  };
</script>

{#if $authState.role !== 'loading' && !$authState.openAccess}
  <a
    href="/login?redirect={encodeURIComponent($page.url.pathname)}"
    class="btn-ghost text-xs py-1.5 px-3"
    title={$authState.label ?? ''}>
    {ROLE_LABEL[$authState.role]}
  </a>
{/if}
