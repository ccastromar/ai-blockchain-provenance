<script>
  import '../app.css';
  import { env } from '$env/dynamic/public';
  import { page } from '$app/stores';
  import AccessBadge from '$lib/components/AccessBadge.svelte';
  import { authState } from '$lib/auth';
  let { children } = $props();

  // One navigation for every page: the same destinations are always shown, the current one is
  // highlighted. Page-specific actions (Refresh, Simulate…) stay in each page's own toolbar.
  const baseSections = [
    { href: '/', label: 'Overview' },
    { href: '/models', label: 'Models' },
    { href: '/blocks', label: 'Blocks' },
    { href: '/events', label: 'Events' },
    { href: '/connectors', label: 'Connectors' },
    { href: '/auditor', label: 'Audit' },
    { href: '/verify-receipt', label: 'Verify receipt' },
    { href: '/settings/tokens', label: 'Tokens' },
  ];
  // Demo (manual evidence entry) writes to the chain: only offered to read-write users, so
  // visitors of the public portal see real evidence only.
  let sections = $derived($authState.role === 'read-write'
    ? [...baseSections, { href: '/demo', label: 'Demo' }]
    : baseSections);

  // Chestertown app-switcher — one platform, three modules. Ernest is the "assure" vertex.
  // URLs are deploy-configured; these are dev defaults.
  const apps = [
    { label: 'AOS',      vertex: 'operate', accent: '#2563eb', url: env.PUBLIC_AOS_URL      ?? 'http://localhost:5173' },
    { label: 'Prudence', vertex: 'govern',  accent: '#d97706', url: env.PUBLIC_PRUDENCE_URL ?? 'http://localhost:5200' },
    { label: 'Ernest',   vertex: 'assure',  accent: '#0d9488', url: env.PUBLIC_ERNEST_URL   ?? 'http://localhost:5174' },
  ];
  const current = 'assure';

  const isActive = (/** @type {string} */ href, /** @type {string} */ path) =>
    href === '/' ? path === '/' : path === href || path.startsWith(href + '/');

  // Sign-in screens stand alone: there is nowhere to navigate before you are in.
  let bare = $derived($page.url.pathname.startsWith('/login') || $page.url.pathname.startsWith('/auth/'));
</script>

{#if !bare}
  <header class="site-nav">
    <div class="site-nav-inner">
      <a href="/" class="brand" aria-label="Ernest overview">
        <span class="brand-mark">E</span>
        <span class="brand-text">
          <span class="brand-name">Ernest</span>
          <span class="brand-sub">AI Provenance</span>
        </span>
      </a>

      <nav class="sections" aria-label="Ernest sections">
        {#each sections as s}
          <a href={s.href} class:active={isActive(s.href, $page.url.pathname)}
             aria-current={isActive(s.href, $page.url.pathname) ? 'page' : undefined}>{s.label}</a>
        {/each}
      </nav>

      <div class="tools">
        <AccessBadge />
        <nav class="chestertown-switcher" aria-label="Chestertown apps">
          {#each apps as app}
            <a href={app.url} title={`${app.label} — ${app.vertex}`}
               class:here={app.vertex === current}
               style={app.vertex === current ? `background:${app.accent};border-color:${app.accent}` : ''}>
              {app.label}
            </a>
          {/each}
        </nav>
      </div>
    </div>
  </header>
{/if}

{@render children()}

<style>
  .site-nav {
    position: sticky; top: 0; z-index: 50;
    background: #172554; /* blue-950: one shade darker than the page toolbars */
    border-bottom: 1px solid rgba(255,255,255,.08);
    box-shadow: 0 1px 3px rgba(15,23,42,.25);
  }
  .site-nav-inner {
    max-width: 80rem; margin: 0 auto; padding: .5rem 1rem;
    display: flex; align-items: center; gap: 1rem;
  }
  .brand { display: flex; align-items: center; gap: .6rem; text-decoration: none; flex-shrink: 0; }
  .brand-mark {
    width: 2rem; height: 2rem; border-radius: .5rem; background: #38bdf8; color: #1e3a8a;
    display: grid; place-items: center; font-weight: 700;
  }
  .brand-text { display: flex; flex-direction: column; line-height: 1.1; }
  .brand-name { color: #fff; font-weight: 700; letter-spacing: -.01em; }
  .brand-sub { color: #bfdbfe; font-size: .7rem; }
  .sections {
    flex: 1; min-width: 0; display: flex; gap: .125rem;
    overflow-x: auto; scrollbar-width: none; /* phones scroll the row instead of hiding links */
  }
  .sections::-webkit-scrollbar { display: none; }
  .sections a {
    flex-shrink: 0; color: #dbeafe; text-decoration: none; font-size: .8125rem; font-weight: 500;
    padding: .375rem .55rem; border-radius: .5rem; border: 1px solid transparent; white-space: nowrap;
  }
  .sections a:hover { background: rgba(255,255,255,.1); }
  .sections a.active { background: rgba(255,255,255,.16); border-color: rgba(255,255,255,.3); color: #fff; }
  .tools { display: flex; align-items: center; gap: .5rem; flex-shrink: 0; }
  .chestertown-switcher {
    display: flex; gap: 4px; padding: 3px;
    background: rgba(255,255,255,0.92); border: 1px solid #e2e8f0; border-radius: 9999px;
  }
  .chestertown-switcher a {
    font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: #64748b; text-decoration: none; padding: 3px 10px; border-radius: 9999px;
    border: 1px solid transparent;
  }
  .chestertown-switcher a.here { color: #fff; }
  @media (max-width: 768px) {
    .site-nav-inner { flex-wrap: wrap; gap: .5rem; }
    .sections { order: 3; flex-basis: 100%; }
    .tools { margin-left: auto; }
    .brand-sub { display: none; }
  }
</style>
