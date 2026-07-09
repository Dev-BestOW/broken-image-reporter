import { cssPath } from './selector';
import {
  brokenImageStore as defaultStore,
  type BrokenImageRecord,
  type BrokenImageStore,
} from './store';

/**
 * Recovers the HTTP status of a URL that failed to load as an image, or `null` when
 * the status cannot be determined.
 *
 * Receives an `AbortSignal` that fires on `probeTimeoutMs` and on dispose. Forward it
 * to whatever request you make, or a hung origin keeps the request alive after the
 * reporter is gone. Throwing is treated as `null`.
 */
export type ProbeStatus = (
  url: string,
  signal: AbortSignal,
) => Promise<number | null>;

export interface InitBrokenImageReporterOptions {
  /**
   * Called once per unique failing URL, after the record is committed to the store.
   * Use this to forward to Slack, Sentry, an analytics endpoint, and so on.
   *
   * Never send to a webhook URL embedded in client-side code — proxy through
   * your own backend instead.
   */
  onError?: (record: BrokenImageRecord) => void;

  /**
   * Issue a follow-up `HEAD` request to recover the HTTP status of the failed image.
   *
   * The browser does not expose the status code of a failed `<img>` load, so the
   * only way to distinguish a 403 (expired signed URL) from a 404 (missing object)
   * is to re-request it. This costs one extra request per unique failing URL.
   *
   * The probe can only read a status when the origin serves CORS headers; otherwise
   * `httpStatus` is `null`. An origin that rejects `HEAD` reports `405`, which
   * describes the probe rather than the original image request.
   *
   * Set to `false` to never probe at all. This also disables `probeStatus`. @default true
   */
  probeHttpStatus?: boolean;

  /**
   * Recover the status some other way than the built-in `HEAD` request.
   *
   * The built-in probe is a browser `fetch`, so it obeys CORS: for an image on an
   * origin that sends no `Access-Control-Allow-Origin`, the status is unknowable and
   * `httpStatus` is `null` — even though the server did return a real status. Routing
   * the probe through your own backend lifts that restriction, because a server is not
   * bound by CORS and can use `GET` on origins that reject `HEAD`.
   *
   * This library deliberately defines no wire format. You own the request and the
   * response shape; it keeps the timeout, the abort-on-dispose, and the one-probe-per-
   * unique-URL guarantee.
   *
   * **An endpoint that fetches an arbitrary client-supplied URL is an SSRF hole.**
   * Allowlist the image origins you expect, and never let it reach internal hosts.
   *
   * @example
   * ```ts
   * probeStatus: async (url, signal) => {
   *   const res = await fetch(`/api/probe?url=${encodeURIComponent(url)}`, { signal });
   *   if (!res.ok) return null; // the proxy itself failed; the image's status is unknown
   *   const { status } = await res.json();
   *   return status;
   * }
   * ```
   */
  probeStatus?: ProbeStatus;

  /**
   * Abandon a status probe that has not responded within this many milliseconds,
   * recording `httpStatus: null`. Without a bound, an origin that accepts the
   * connection and never answers would leave the record permanently unresolved.
   * @default 5000
   */
  probeTimeoutMs?: number;

  /**
   * How long to wait before confirming that an image really failed.
   *
   * React can abort an in-flight image request during a re-render, which fires
   * `error` even though nothing is wrong. After this delay the element is
   * re-checked, and healthy or detached images are discarded. @default 500
   */
  verifyDelayMs?: number;

  /** Return `true` to ignore a failure entirely. Runs before any delay or probe. */
  ignore?: (url: string, element: HTMLImageElement) => boolean;

  /** Log each confirmed failure with `console.warn`. @default false */
  debug?: boolean;

  /** Store to write into. Defaults to the module-level shared store. */
  store?: BrokenImageStore;
}

/** URL schemes that can never produce a meaningful network failure. */
const IGNORED_SCHEMES = ['data:', 'blob:', 'about:'];

let idCounter = 0;
function generateId(): string {
  idCounter += 1;
  return `img-err-${idCounter}`;
}

/**
 * The default probe: re-request the image with `HEAD` and read the status off the
 * response. Subject to CORS, which is why `probeStatus` exists.
 */
const headProbe: ProbeStatus = async (url, signal) => {
  const res = await fetch(url, { method: 'HEAD', signal });
  return res.status;
};

/**
 * Run a probe under a timeout, and resolve to `null` when the status is unknowable —
 * a DNS/network failure, a cross-origin response without `Access-Control-Allow-Origin`
 * (the fetch rejects regardless of the status the server actually sent), a timeout,
 * disposal, or a probe that threw.
 *
 * The signal fires on both timeout and dispose, so a hung origin cannot keep a request
 * (or the page) alive after cleanup — provided the probe forwards it.
 */
async function runProbe(
  url: string,
  timeoutMs: number,
  disposeSignal: AbortSignal,
  probe: ProbeStatus,
  debug: boolean,
): Promise<number | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();

  disposeSignal.addEventListener('abort', abort);
  const timer = setTimeout(abort, timeoutMs);

  try {
    const status = await probe(url, controller.signal);
    // A custom probe is user code: it may resolve to anything at runtime, whatever
    // its type says. Only a number is a status.
    return typeof status === 'number' ? status : null;
  } catch (error) {
    if (debug) console.warn('[broken-image] probe failed', url, error);
    return null;
  } finally {
    clearTimeout(timer);
    disposeSignal.removeEventListener('abort', abort);
  }
}

/**
 * Detect `<img>` tags that fail to load anywhere in the main document.
 *
 * Image `error` events do not bubble, so this listens in the **capture** phase on
 * `window` — that catches images rendered by any component or library, including
 * ones that never wire up an `onError` prop.
 *
 * It does not catch images inside a shadow root (`error` is `composed: false`, so
 * it never reaches `window`) or CSS `background-image` failures (which fire no
 * event at all).
 *
 * Safe to call on the server: it no-ops and returns a no-op disposer.
 *
 * @returns A cleanup function that removes the listener and cancels pending checks.
 *
 * @example
 * ```ts
 * const dispose = initBrokenImageReporter({
 *   onError: record => {
 *     if (record.httpStatus === 403) reportToBackend(record);
 *   },
 * });
 * ```
 */
export function initBrokenImageReporter(
  options: InitBrokenImageReporterOptions = {},
): () => void {
  const {
    onError,
    probeHttpStatus = true,
    probeStatus = headProbe,
    probeTimeoutMs = 5000,
    verifyDelayMs = 500,
    ignore,
    debug = false,
    store = defaultStore,
  } = options;

  if (typeof window === 'undefined') return () => {};

  // Tracked so a caller that disposes mid-flight does not get a late store write.
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  // Aborts every in-flight probe at once when the reporter is disposed.
  const disposeController = new AbortController();
  // Claimed before probing, not after: a URL broken in fifty places must cost
  // exactly one probe, and the store can only dedupe once the probe returns.
  const claimedUrls = new Set<string>();
  let disposed = false;

  const commit = (target: HTMLImageElement, url: string) => {
    if (claimedUrls.has(url)) return;
    claimedUrls.add(url);

    const record: Omit<BrokenImageRecord, 'httpStatus'> = {
      id: generateId(),
      url,
      pageUrl: window.location.href,
      timestamp: new Date().toISOString(),
      alt: target.alt || null,
      // Read now, while the element is still in the document. The probe that follows
      // is async, and by the time it resolves the element may have been unmounted.
      selector: cssPath(target),
    };

    const finish = (httpStatus: number | null) => {
      if (disposed) return;
      const full: BrokenImageRecord = { ...record, httpStatus };
      // The store dedupes too — it may be shared with another reporter instance.
      if (!store.addError(full)) return;
      if (debug) console.warn('[broken-image]', full);
      onError?.(full);
    };

    if (!probeHttpStatus) {
      finish(null);
      return;
    }
    void runProbe(
      url,
      probeTimeoutMs,
      disposeController.signal,
      probeStatus,
      debug,
    ).then(finish);
  };

  const handleError = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;

    const url = target.currentSrc || target.src;
    if (!url) return;
    if (IGNORED_SCHEMES.some(scheme => url.startsWith(scheme))) return;
    if (ignore?.(url, target)) return;

    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      if (disposed) return;

      // The image recovered — a re-render aborted the first request, nothing failed.
      if (target.complete && target.naturalWidth > 0) return;
      // The element was unmounted before the request finished; the user never saw a gap.
      if (!target.isConnected) return;

      commit(target, url);
    }, verifyDelayMs);

    pendingTimers.add(timer);
  };

  window.addEventListener('error', handleError, true);

  return () => {
    disposed = true;
    window.removeEventListener('error', handleError, true);
    disposeController.abort();
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
    claimedUrls.clear();
  };
}
