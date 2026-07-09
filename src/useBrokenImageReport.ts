import { useCallback, useSyncExternalStore } from 'react';
import {
  brokenImageStore as defaultStore,
  type BrokenImageRecord,
  type BrokenImageStore,
} from './store';

export interface UseBrokenImageReportResult {
  /** Every unique image failure recorded so far, oldest first. */
  errors: BrokenImageRecord[];
  count: number;
  clearErrors: () => void;
  /** Trigger a browser download of the records as JSON. */
  downloadJson: (filename?: string) => void;
  /** Trigger a browser download of the records as CSV. */
  downloadCsv: (filename?: string) => void;
  /** Serialize the records without downloading, e.g. to write to the clipboard. */
  toJson: () => string;
  toCsv: () => string;
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;

  // `click()` only *schedules* the download. Revoking the object URL on this tick
  // can invalidate the blob before the browser reads it, silently saving nothing.
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Subscribe to image failures collected by `initBrokenImageReporter`.
 *
 * Pass the same `store` you passed to `initBrokenImageReporter`, or omit it in
 * both places to use the shared default store.
 *
 * @example
 * ```tsx
 * function BrokenImageBadge() {
 *   const { count, errors, clearErrors } = useBrokenImageReport();
 *   if (count === 0) return null;
 *   return <button onClick={clearErrors}>{count} broken images</button>;
 * }
 * ```
 */
export function useBrokenImageReport(
  store: BrokenImageStore = defaultStore,
): UseBrokenImageReportResult {
  const { errors, count } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  // The store's own methods are already referentially stable; these two close over
  // `store`, so they need memoizing to be safe in an effect's dependency array.
  const downloadJson = useCallback(
    (filename = 'broken-images.json') =>
      download(store.exportAsJson(), filename, 'application/json'),
    [store],
  );

  const downloadCsv = useCallback(
    (filename = 'broken-images.csv') =>
      download(store.exportAsCsv(), filename, 'text/csv'),
    [store],
  );

  return {
    errors,
    count,
    clearErrors: store.clearErrors,
    toJson: store.exportAsJson,
    toCsv: store.exportAsCsv,
    downloadJson,
    downloadCsv,
  };
}
