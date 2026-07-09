/**
 * Broken image store backing `useSyncExternalStore`.
 *
 * The reporter writes into this store from a global DOM error listener;
 * React components read from it via `useBrokenImageReport`.
 */

type Listener = () => void;

export interface BrokenImageRecord {
  /** Stable identifier for list keys. */
  id: string;
  /** The `src` (or `currentSrc`) that failed to load. */
  url: string;
  /** HTTP status from the follow-up probe, or `null` when it could not be determined. */
  httpStatus: number | null;
  /** `location.href` at the time the failure was recorded. */
  pageUrl: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** The image's `alt` attribute, when present. */
  alt: string | null;
}

export interface BrokenImageState {
  errors: BrokenImageRecord[];
  count: number;
}

export interface BrokenImageStore {
  subscribe(listener: Listener): () => void;
  getSnapshot(): BrokenImageState;
  getServerSnapshot(): BrokenImageState;
  addError(record: BrokenImageRecord): boolean;
  clearErrors(): void;
  exportAsJson(): string;
  exportAsCsv(): string;
}

export interface CreateBrokenImageStoreOptions {
  /** Oldest records are dropped once this many are held. @default 200 */
  maxErrors?: number;
}

const EMPTY_STATE: BrokenImageState = Object.freeze({
  errors: Object.freeze([]) as unknown as BrokenImageRecord[],
  count: 0,
});

/** RFC 4180: escape a field by doubling embedded quotes. */
function csvField(value: string | number | null): string {
  if (value === null || value === '') return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function createBrokenImageStore(
  options: CreateBrokenImageStoreOptions = {},
): BrokenImageStore {
  const { maxErrors = 200 } = options;

  let listeners: Listener[] = [];
  let state: BrokenImageState = EMPTY_STATE;

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter(l => l !== listener);
      };
    },

    getSnapshot() {
      return state;
    },

    // Must be referentially stable across calls, otherwise React throws
    // "The result of getServerSnapshot should be cached to avoid an infinite loop".
    getServerSnapshot() {
      return EMPTY_STATE;
    },

    /** Returns `false` when the URL was already recorded. */
    addError(record) {
      if (state.errors.some(e => e.url === record.url)) return false;

      const errors =
        state.errors.length >= maxErrors
          ? [...state.errors.slice(state.errors.length - maxErrors + 1), record]
          : [...state.errors, record];

      state = { errors, count: errors.length };
      emitChange();
      return true;
    },

    clearErrors() {
      if (state.count === 0) return;
      state = EMPTY_STATE;
      emitChange();
    },

    exportAsJson() {
      return JSON.stringify(state.errors, null, 2);
    },

    exportAsCsv() {
      const header = 'id,url,httpStatus,pageUrl,timestamp,alt';
      const rows = state.errors.map(e =>
        [
          csvField(e.id),
          csvField(e.url),
          e.httpStatus ?? '',
          csvField(e.pageUrl),
          csvField(e.timestamp),
          csvField(e.alt),
        ].join(','),
      );
      return [header, ...rows].join('\n');
    },
  };
}

/** The store used by `initBrokenImageReporter` and `useBrokenImageReport` by default. */
export const brokenImageStore = createBrokenImageStore();
