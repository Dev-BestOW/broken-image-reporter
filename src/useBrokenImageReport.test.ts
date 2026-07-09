// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { brokenImageStore, createBrokenImageStore } from './store';
import { useBrokenImageReport } from './useBrokenImageReport';
import type { BrokenImageRecord } from './store';

const record = (url: string, httpStatus: number | null = 404): BrokenImageRecord => ({
  id: url,
  url,
  httpStatus,
  pageUrl: 'https://example.test/page',
  timestamp: '2026-01-01T00:00:00.000Z',
  alt: null,
});

/**
 * jsdom's `Blob` implements neither `text()` nor `arrayBuffer()`, so read it the
 * way a browser without those methods would.
 */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Blobs handed to `URL.createObjectURL`, in call order. */
let objectUrls: Blob[];
/** Anchors that were clicked, captured before `download()` discards them. */
let clicks: { href: string; download: string }[];

beforeEach(() => {
  objectUrls = [];
  clicks = [];

  // jsdom implements neither of these.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    objectUrls.push(blob);
    return `blob:mock/${objectUrls.length}`;
  });
  URL.revokeObjectURL = vi.fn();

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  brokenImageStore.clearErrors();
});

describe('useBrokenImageReport', () => {
  it('starts empty', () => {
    const store = createBrokenImageStore();
    const { result } = renderHook(() => useBrokenImageReport(store));

    expect(result.current.count).toBe(0);
    expect(result.current.errors).toEqual([]);
  });

  it('re-renders when a failure is recorded after mount', () => {
    const store = createBrokenImageStore();
    const { result } = renderHook(() => useBrokenImageReport(store));

    act(() => {
      store.addError(record('https://cdn.test/a.png'));
    });

    expect(result.current.count).toBe(1);
    expect(result.current.errors[0]?.url).toBe('https://cdn.test/a.png');
  });

  it('re-renders when the records are cleared', () => {
    const store = createBrokenImageStore();
    store.addError(record('https://cdn.test/a.png'));
    const { result } = renderHook(() => useBrokenImageReport(store));
    expect(result.current.count).toBe(1);

    act(() => {
      result.current.clearErrors();
    });

    expect(result.current.count).toBe(0);
  });

  // Counting renders would not prove this: React refuses to re-render an
  // unmounted fiber on its own, so a store that never removed the listener would
  // still look correct. Wrap the listener React passes to `subscribe` so we can
  // see whether the store keeps calling it after unmount.
  it('detaches its store listener on unmount', () => {
    const store = createBrokenImageStore();
    const reactListener = vi.fn();
    const realSubscribe = store.subscribe;
    vi.spyOn(store, 'subscribe').mockImplementation(listener =>
      realSubscribe(() => {
        reactListener();
        listener();
      }),
    );

    const { unmount } = renderHook(() => useBrokenImageReport(store));

    act(() => {
      store.addError(record('https://cdn.test/early.png'));
    });
    expect(reactListener).toHaveBeenCalledTimes(1); // subscribed while mounted

    unmount();
    store.addError(record('https://cdn.test/late.png'));

    expect(reactListener).toHaveBeenCalledTimes(1); // and no longer after unmount
    expect(store.getSnapshot().count).toBe(2); // the store itself still works
  });

  it('defaults to the shared store, the same one initBrokenImageReporter writes to', () => {
    const { result } = renderHook(() => useBrokenImageReport());

    act(() => {
      brokenImageStore.addError(record('https://cdn.test/shared.png'));
    });

    expect(result.current.count).toBe(1);
  });

  it('isolates a custom store from the shared one', () => {
    const store = createBrokenImageStore();
    const { result } = renderHook(() => useBrokenImageReport(store));

    act(() => {
      brokenImageStore.addError(record('https://cdn.test/shared.png'));
    });

    expect(result.current.count).toBe(0);
  });

  it('serializes the records without downloading', () => {
    const store = createBrokenImageStore();
    store.addError(record('https://cdn.test/a.png', 403));
    const { result } = renderHook(() => useBrokenImageReport(store));

    expect(JSON.parse(result.current.toJson())).toHaveLength(1);
    expect(result.current.toCsv().split('\n')[1]).toContain('403');
    expect(clicks).toHaveLength(0);
  });

  it('downloads CSV with a default filename', async () => {
    const store = createBrokenImageStore();
    store.addError(record('https://cdn.test/a.png'));
    const { result } = renderHook(() => useBrokenImageReport(store));

    result.current.downloadCsv();

    expect(clicks).toEqual([
      { href: 'blob:mock/1', download: 'broken-images.csv' },
    ]);
    expect(objectUrls[0]?.type).toBe('text/csv');
    await expect(readBlob(objectUrls[0]!)).resolves.toContain('https://cdn.test/a.png');
  });

  // `click()` schedules the download rather than performing it. Revoking on the
  // same tick can invalidate the blob before the browser reads it.
  it('revokes the object URL only after the click tick has passed', async () => {
    const store = createBrokenImageStore();
    store.addError(record('https://cdn.test/a.png'));
    const { result } = renderHook(() => useBrokenImageReport(store));

    result.current.downloadCsv();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock/1');
  });

  // Consumers put these in effect dependency arrays; a fresh closure per render
  // would re-fire the effect forever.
  it('keeps every returned callback referentially stable across renders', () => {
    const store = createBrokenImageStore();
    const { result, rerender } = renderHook(() => useBrokenImageReport(store));
    const first = result.current;

    rerender();

    expect(result.current.downloadJson).toBe(first.downloadJson);
    expect(result.current.downloadCsv).toBe(first.downloadCsv);
    expect(result.current.clearErrors).toBe(first.clearErrors);
    expect(result.current.toJson).toBe(first.toJson);
    expect(result.current.toCsv).toBe(first.toCsv);
  });

  it('downloads JSON under a caller-supplied filename', async () => {
    const store = createBrokenImageStore();
    store.addError(record('https://cdn.test/a.png'));
    const { result } = renderHook(() => useBrokenImageReport(store));

    result.current.downloadJson('report.json');

    expect(clicks[0]?.download).toBe('report.json');
    expect(objectUrls[0]?.type).toBe('application/json');
    const parsed = JSON.parse(await readBlob(objectUrls[0]!));
    expect(parsed[0].url).toBe('https://cdn.test/a.png');
  });
});
