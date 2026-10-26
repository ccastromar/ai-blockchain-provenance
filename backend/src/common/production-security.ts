/**
 * Fail closed in production. Without any credential Ernest runs with open access (anyone can read
 * and write evidence: see openAccessMode), which is what a local demo wants and what a deployment
 * must never get by forgetting a variable. So with NODE_ENV=production Ernest refuses to start
 * unless it has:
 *
 *  - ERNEST_API_KEY (writes) and ERNEST_READ_API_KEY (reads), and they differ;
 *  - OIDC_ISSUER and OIDC_AUDIENCE (people sign in).
 *
 * ERNEST_OPEN_ACCESS=true is the one, deliberate, way out, for local demo stacks: it is logged on
 * every start.
 */
export function assertProductionSecurity(env: NodeJS.ProcessEnv = process.env, warn: (msg: string) => void = console.warn): void {
  if ((env.NODE_ENV ?? '').trim().toLowerCase() !== 'production') return;
  if ((env.ERNEST_OPEN_ACCESS ?? '').trim().toLowerCase() === 'true') {
    warn(
      'ERNEST_OPEN_ACCESS=true: Ernest runs in production mode without requiring credentials. ' +
        'Use it only for a local demo stack, never where evidence matters.');
    return;
  }
  const missing = ['ERNEST_API_KEY', 'ERNEST_READ_API_KEY', 'OIDC_ISSUER', 'OIDC_AUDIENCE']
    .filter((name) => !(env[name] ?? '').trim());
  if (missing.length) {
    throw new Error(
      `Refusing to start in production without ${missing.join(', ')}: without them Ernest would ` +
        'accept evidence from anyone (set ERNEST_OPEN_ACCESS=true only for a local demo)');
  }
  if (env.ERNEST_API_KEY!.trim() === env.ERNEST_READ_API_KEY!.trim()) {
    throw new Error('Refusing to start in production: ERNEST_API_KEY and ERNEST_READ_API_KEY must differ (a reader could write)');
  }
}
