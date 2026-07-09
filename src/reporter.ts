import {
  brokenImageStore as defaultStore,
  type BrokenImageRecord,
  type BrokenImageStore,
} from './store';

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
   * describes the probe rather than the original image request. @default true
   */
  probeHttpStatus?: boolean;

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
 * Recover the HTTP status of a URL that failed to load as an image.
 *
 * Resolves to `null` when the status is unknowable — a DNS/network failure, a
 * cross-origin response without `Access-Control-Allow-Origin` (the fetch rejects
 * regardless of the status the server actually sent), a timeout, or disposal.
 *
 * The request is aborted both on timeout and when the reporter is disposed, so a
 * hung origin cannot keep a `fetch` (or the page) alive after cleanup.
 */
async function probeStatus(
  url: string,
  timeoutMs: number,
  disposeSignal: AbortSignal,
): Promise<number | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();

  disposeSignal.addEventListener('abort', abort);
  const timer = setTimeout(abort, timeoutMs);

  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return res.status;
  } catch {
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
  // exactly one HEAD request, and the store can only dedupe once the probe returns.
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
    void probeStatus(url, probeTimeoutMs, disposeController.signal).then(finish);
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
