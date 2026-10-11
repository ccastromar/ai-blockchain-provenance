<script>
  import '../app.css';
  import { env } from '$env/dynamic/public';
  let { children } = $props();

  // Trio app-switcher — one platform, three modules. Ernest is the "assure" vertex.
  // URLs are deploy-configured; these are dev defaults.
  const trio = [
    { label: 'AOS',      vertex: 'operate', accent: '#2563eb', url: env.PUBLIC_AOS_URL      ?? 'http://localhost:5173' },
    { label: 'Prudence', vertex: 'govern',  accent: '#d97706', url: env.PUBLIC_PRUDENCE_URL ?? 'http://localhost:5200' },
    { label: 'Ernest',   vertex: 'assure',  accent: '#0d9488', url: env.PUBLIC_ERNEST_URL   ?? 'http://localhost:5174' },
  ];
  const current = 'assure';
</script>

<nav class="trio-switcher" aria-label="Trio apps">
  {#each trio as app}
    <a href={app.url} title={`${app.label} — ${app.vertex}`}
       class:here={app.vertex === current}
       style={app.vertex === current ? `background:${app.accent};border-color:${app.accent}` : ''}>
      {app.label}
    </a>
  {/each}
</nav>

{@render children()}

<style>
  .trio-switcher {
    position: fixed; top: 12px; right: 12px; z-index: 50;
    display: flex; gap: 4px; padding: 4px;
    background: rgba(255,255,255,0.8); backdrop-filter: blur(8px);
    border: 1px solid #e2e8f0; border-radius: 9999px; box-shadow: 0 1px 3px rgba(15,23,42,.1);
  }
  .trio-switcher a {
    font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: #64748b; text-decoration: none; padding: 4px 12px; border-radius: 9999px;
    border: 1px solid transparent;
  }
  .trio-switcher a.here { color: #fff; }
  :global(.dark) .trio-switcher { background: rgba(15,23,42,.8); border-color: #1e293b; }
</style>
