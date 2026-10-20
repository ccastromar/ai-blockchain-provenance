// Build-time configuration (PUBLIC_* variables, see vite.config.ts).
export const env = import.meta.env as unknown as Record<string, string | undefined>;
