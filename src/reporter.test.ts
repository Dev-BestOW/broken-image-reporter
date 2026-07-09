import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrokenImageStore } from './store';
import { initBrokenImageReporter } from './reporter';

/**
 * These tests run against a hand-rolled DOM stand-in rather than jsdom, because the
 * behaviour under test is precisely the thing jsdom does not model: an `<img>` whose
 * `complete`/`naturalWidth`/`isConnected` change between the `error` event and the
 * delayed re-check.
 */
class FakeImage {
  src: string;
  currentSrc: string;
  complete: boolean;
  naturalWidth: number;
  isConnected: boolean;
  alt: string;

  constructor(init: {
    src: string;
    complete?: boolean;
    naturalWidth?: number;
    isConnected?: boolean;
    alt?: string;
  }) {
    this.src = init.src;
    this.currentSrc = init.src;
    this.complete = init.complete ?? false;
    this.naturalWidth = init.naturalWidth ?? 0;
    this.isConnected = init.isConnected ?? true;
    this.alt = init.alt ?? '';
  }
}

type Listener = { fn: (event: unknown) => void; capture: unknown };

let listeners: Listener[];
let probes: { url: string; method: string | undefined }[];

function emit(target: unknown) {
  for (const l of listeners) l.fn({ target });
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50));

beforeEach(() => {
  listeners = [];
  probes = [];

  vi.stubGlobal('HTMLImageElement', FakeImage);
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/page' },
    addEventListener: (_type: string, fn: Listener['fn'], capture: unknown) =>
      listeners.push({ fn, capture }),
    removeEventListener: (_type: string, fn: Listener['fn']) => {
      const i = listeners.findIndex(l => l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  });
  vi.stubGlobal(
    'fetch',
    async (url: string, opts: { method?: string; signal?: AbortSignal }) => {
      probes.push({ url, method: opts.method });
      if (url.includes('403')) return { status: 403 };
      if (url.includes('cors-blocked')) throw new TypeError('Failed to fetch');
      // An origin that accepts the connection and then never answers. Only an
      // abort — from the timeout or from dispose — can settle this.
      if (url.includes('hangs')) {
        return new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new Error('AbortError')),
          );
        });
      }
      return { status: 404 };
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initBrokenImageReporter', () => {
  it('listens in the capture phase, since image error events do not bubble', () => {
    initBrokenImageReporter({ store: createBrokenImageStore() });
    expect(listeners[0]?.capture).toBe(true);
  });

  it('records a broken image and recovers its HTTP status', async () => {
    const store = createBrokenImageStore();
    const onError = vi.fn();
    initBrokenImageReporter({ store, onError, verifyDelayMs: 10 });

    emit(new FakeImage({ src: 'https://cdn.test/403/a.png', alt: 'hero' }));
    await settle();

    expect(store.getSnapshot().count).toBe(1);
    expect(store.getSnapshot().errors[0]).toMatchObject({
      url: 'https://cdn.test/403/a.png',
      httpStatus: 403,
      alt: 'hero',
      pageUrl: 'https://example.test/page',
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('discards an image that recovered after a re-render aborted its request', async () => {
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 10 });

    emit(new FakeImage({ src: 'https://cdn.test/ok.png', complete: true, naturalWidth: 120 }));
    await settle();

    expect(store.getSnapshot().count).toBe(0);
  });

  it('discards an image that was unmounted before the request settled', async () => {
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 10 });

    emit(new FakeImage({ src: 'https://cdn.test/gone.png', isConnected: false }));
    await settle();

    expect(store.getSnapshot().count).toBe(0);
  });

  it('ignores data:, blob: and about: URLs without probing', async () => {
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 10 });

    emit(new FakeImage({ src: 'data:image/png;base64,AAAA' }));
    emit(new FakeImage({ src: 'blob:https://example.test/xyz' }));
    emit(new FakeImage({ src: 'about:blank' }));
    await settle();

    expect(store.getSnapshot().count).toBe(0);
    expect(probes).toHaveLength(0);
  });

  it('probes and reports a repeated URL exactly once', async () => {
    const store = createBrokenImageStore();
    const onError = vi.fn();
    initBrokenImageReporter({ store, onError, verifyDelayMs: 10 });

    emit(new FakeImage({ src: 'https://cdn.test/404/dup.png' }));
    emit(new FakeImage({ src: 'https://cdn.test/404/dup.png' }));
    emit(new FakeImage({ src: 'https://cdn.test/404/dup.png' }));
    await settle();

    expect(store.getSnapshot().count).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(probes).toHaveLength(1);
    expect(probes[0]?.method).toBe('HEAD');
  });

  it('records a CORS-blocked failure with an unknowable status', async () => {
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 10 });

    emit(new FakeImage({ src: 'https://third-party.test/cors-blocked.png' }));
    await settle();

    expect(store.getSnapshot().errors[0]?.httpStatus).toBeNull();
  });

  it('skips failures rejected by the ignore predicate', async () => {
    const store = createBrokenImageStore();
    initBrokenImageReporter({
      store,
      verifyDelayMs: 10,
      ignore: url => url.includes('/ads/'),
    });

    emit(new FakeImage({ src: 'https://cdn.test/ads/banner.png' }));
    await settle();

    expect(store.getSnapshot().count).toBe(0);
    expect(probes).toHaveLength(0);
  });

  it('does not probe when probeHttpStatus is disabled', async () => {
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 10, probeHttpStatus: false });

    emit(new FakeImage({ src: 'https://cdn.test/404/x.png' }));
    await settle();

    expect(probes).toHaveLength(0);
    expect(store.getSnapshot().errors[0]?.httpStatus).toBeNull();
  });

  it('abandons a probe that never responds, recording an unknowable status', async () => {
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 10, probeTimeoutMs: 20 });

    emit(new FakeImage({ src: 'https://cdn.test/hangs.png' }));
    await settle();

    expect(store.getSnapshot().count).toBe(1);
    expect(store.getSnapshot().errors[0]?.httpStatus).toBeNull();
  });

  it('aborts an in-flight probe on dispose rather than writing to the store', async () => {
    const store = createBrokenImageStore();
    const onError = vi.fn();
    const dispose = initBrokenImageReporter({ store, onError, verifyDelayMs: 10 });

    emit(new FakeImage({ src: 'https://cdn.test/hangs.png' }));
    await new Promise(resolve => setTimeout(resolve, 25)); // the probe is now in flight
    expect(probes).toHaveLength(1);

    dispose();
    await settle();

    expect(store.getSnapshot().count).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancels pending checks and detaches its listener on dispose', async () => {
    const store = createBrokenImageStore();
    const onError = vi.fn();
    const dispose = initBrokenImageReporter({ store, onError, verifyDelayMs: 10 });

    emit(new FakeImage({ src: 'https://cdn.test/404/late.png' }));
    dispose();
    await settle();

    expect(store.getSnapshot().count).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(0);
  });

  it('no-ops during SSR', () => {
    vi.stubGlobal('window', undefined);
    const dispose = initBrokenImageReporter({ store: createBrokenImageStore() });
    expect(dispose).toBeInstanceOf(Function);
    expect(() => dispose()).not.toThrow();
  });
});

describe('createBrokenImageStore', () => {
  const record = (url: string) => ({
    id: url,
    url,
    httpStatus: null,
    pageUrl: '',
    timestamp: '',
    alt: null,
  });

  it('caches getServerSnapshot, which React requires to avoid an infinite loop', () => {
    const store = createBrokenImageStore();
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
  });

  it('drops the oldest records past maxErrors', () => {
    const store = createBrokenImageStore({ maxErrors: 3 });
    for (const url of ['a', 'b', 'c', 'd']) store.addError(record(url));

    expect(store.getSnapshot().count).toBe(3);
    expect(store.getSnapshot().errors.map(e => e.url)).toEqual(['b', 'c', 'd']);
  });

  it('reports whether a record was accepted', () => {
    const store = createBrokenImageStore();
    expect(store.addError(record('a'))).toBe(true);
    expect(store.addError(record('a'))).toBe(false);
  });

  it('stops notifying a listener once it unsubscribes', () => {
    const store = createBrokenImageStore();
    const stays = vi.fn();
    const leaves = vi.fn();

    store.subscribe(stays);
    store.subscribe(leaves)();
    store.addError(record('a'));

    expect(stays).toHaveBeenCalledTimes(1);
    expect(leaves).not.toHaveBeenCalled();
  });

  it('escapes embedded quotes in CSV output', () => {
    const store = createBrokenImageStore();
    store.addError({ ...record('https://a.test/"quoted".png'), httpStatus: 404 });

    const row = store.exportAsCsv().split('\n')[1];
    expect(row).toContain('"https://a.test/""quoted"".png"');
  });
});
