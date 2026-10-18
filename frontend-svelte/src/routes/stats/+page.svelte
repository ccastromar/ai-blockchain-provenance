<script lang="ts">
  // Statistics became the Overview at "/"; keep old links and bookmarks working.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  onMount(() => { goto('/', { replaceState: true }); });
</script>
