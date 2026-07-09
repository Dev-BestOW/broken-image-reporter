import { createBrokenImageStore, type ProbeStatus } from 'broken-image-reporter';

/**
 * Two stores watching the same page, so the table can put the two probes side by side.
 *
 * Both reporters listen on `window`, so every failure reaches both. Only the way they
 * recover the HTTP status differs.
 */
export const directStore = createBrokenImageStore();
export const proxiedStore = createBrokenImageStore();

/**
 * Ask our own backend for the status instead of re-requesting the image from the
 * browser. See `/api/probe` in `vite.config.ts` — and note the origin allowlist there.
 *
 * `signal` fires on `probeTimeoutMs` and on dispose. Forwarding it is not optional:
 * without it a hung origin keeps the request alive after the reporter is gone.
 */
export const probeViaProxy: ProbeStatus = async (url, signal) => {
  const res = await fetch(`/api/probe?url=${encodeURIComponent(url)}`, { signal });
  if (!res.ok) return null; // the proxy itself failed; the image's status stays unknown
  const { status } = await res.json();
  return status;
};
