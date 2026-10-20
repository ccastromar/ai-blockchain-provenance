// Most Ernest endpoints are untyped JSON; pages read them as Any and render defensively.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any;

/// The message to show for a failed request: the backend's own when it sent one.
export function errorMessage(e: Any, fallback: string): string {
  return e?.response?.data?.message ?? e?.response?.data?.error ?? e?.message ?? fallback;
}

export const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : "—");

export function shortHash(value: string | undefined, head = 12, tail = 6) {
  if (!value) return "—";
  return value.length > head + tail + 2 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}
