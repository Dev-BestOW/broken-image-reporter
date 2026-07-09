import { expect, test, type Page } from '@playwright/test';

/**
 * The harness page exposes the built bundle on `window.lib`. Each test drives it
 * directly, so the fixture stays a blank page and the scenario lives in the test.
 */
declare global {
  interface Window {
    lib: typeof import('../src/index');
    harnessReady: boolean;
  }
}

type Record_ = {
  url: string;
  httpStatus: number | null;
  alt: string | null;
  selector: string | null;
};

const CROSS_ORIGIN = 'http://127.0.0.1:5314/api/missing.png';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.harnessReady === true);
});

/**
 * Render `markup`, let the reporter confirm and probe, and return what it recorded.
 * `useProxy` swaps the CORS-bound `HEAD` probe for one that goes through the server.
 */
async function collect(
  page: Page,
  markup: string,
  { useProxy = false } = {},
): Promise<Record_[]> {
  return page.evaluate(
    async ({ markup, useProxy }) => {
      const { initBrokenImageReporter, createBrokenImageStore } = window.lib;
      const store = createBrokenImageStore();

      initBrokenImageReporter({
        store,
        verifyDelayMs: 50,
        probeTimeoutMs: 2000,
        probeStatus: useProxy
          ? async (url, signal) => {
              const res = await fetch(`/api/probe?url=${encodeURIComponent(url)}`, {
                signal,
              });
              if (!res.ok) return null;
              const { status } = await res.json();
              return status;
            }
          : undefined,
      });

      document.getElementById('root')!.innerHTML = markup;

      // Long enough for the verify delay, the probe, and a 404 on loopback.
      await new Promise(resolve => setTimeout(resolve, 900));
      return store.getSnapshot().errors.map(e => ({
        url: e.url,
        httpStatus: e.httpStatus,
        alt: e.alt,
        selector: e.selector,
      }));
    },
    { markup, useProxy },
  );
}

test('recovers the status behind a same-origin failure', async ({ page }) => {
  const records = await collect(
    page,
    `<img src="/api/expired.png" alt="expired">
     <img src="/api/missing.png" alt="missing">`,
  );

  expect(records).toHaveLength(2);
  expect(records.map(r => [r.alt, r.httpStatus])).toEqual([
    ['expired', 403],
    ['missing', 404],
  ]);
});

test('reports the probe status, not the image status, when HEAD is refused', async ({
  page,
}) => {
  const [record] = await collect(page, `<img src="/api/head-405.png" alt="trap">`);

  // The image is really a 404. The origin answers HEAD with 405, and that is all
  // the probe can see. Documented in the README as a reason to treat 405 as unknown.
  expect(record?.httpStatus).toBe(405);
});

test('cannot read a cross-origin status through the default probe', async ({ page }) => {
  const [record] = await collect(page, `<img src="${CROSS_ORIGIN}" alt="third party">`);

  // The server did return 404. The `HEAD` fetch obeys CORS, so the status is lost.
  expect(record?.url).toBe(CROSS_ORIGIN);
  expect(record?.httpStatus).toBeNull();
});

test('recovers a cross-origin status through a proxied probe', async ({ page }) => {
  const [record] = await collect(page, `<img src="${CROSS_ORIGIN}" alt="third party">`, {
    useProxy: true,
  });

  // Same image, same page. A server is not bound by CORS.
  expect(record?.httpStatus).toBe(404);
});

test('locates the broken image with a selector that resolves back to it', async ({
  page,
}) => {
  const [record] = await collect(
    page,
    `<div id="gallery"><figure><img src="/api/missing.png" alt="in a gallery"></figure></div>`,
  );

  expect(record?.selector).toBe('#gallery > figure > img');

  const resolves = await page.evaluate(
    sel => document.querySelector(sel!)?.getAttribute('alt'),
    record?.selector,
  );
  expect(resolves).toBe('in a gallery');
});

test('records the URL the browser actually tried when a <source> fails', async ({
  page,
}) => {
  const [record] = await collect(
    page,
    `<picture>
       <source srcset="/api/missing.png">
       <img src="/ok.png" alt="fallback never used">
     </picture>`,
  );

  // `currentSrc` holds the failing source, not the `<img>`'s own src.
  expect(record?.url).toContain('/api/missing.png');
});

/**
 * A control that must always be recorded. Without it, every "nothing was recorded"
 * assertion below would also pass against a reporter that does nothing at all —
 * which a mutation test proved is not hypothetical.
 */
const CONTROL = `<img src="/api/expired.png" alt="control">`;
const controlOnly = (records: Record_[]) => records.map(r => r.alt);

test('ignores data: URLs and images that load fine', async ({ page }) => {
  const records = await collect(
    page,
    `${CONTROL}
     <img src="data:image/png;base64,bm90YXBuZw==" alt="data">
     <img src="/ok.png" alt="valid">`,
  );

  expect(controlOnly(records)).toEqual(['control']);
});

test('discards an image whose request a re-render aborted', async ({ page }) => {
  const records = await page.evaluate(async control => {
    const { initBrokenImageReporter, createBrokenImageStore } = window.lib;
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 200 });

    const root = document.getElementById('root')!;
    root.innerHTML = control;

    const img = document.createElement('img');
    img.src = '/api/slow.png'; // three seconds; the swap below aborts it
    root.appendChild(img);

    await new Promise(resolve => setTimeout(resolve, 50));
    img.src = '/ok.png'; // the browser fires `error` for the aborted request

    await new Promise(resolve => setTimeout(resolve, 900));
    return store.getSnapshot().errors.map(e => ({ alt: e.alt }));
  }, CONTROL);

  expect(records.map(r => r.alt)).toEqual(['control']);
});

test('discards an image unmounted before its request settled', async ({ page }) => {
  const records = await page.evaluate(async control => {
    const { initBrokenImageReporter, createBrokenImageStore } = window.lib;
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 200 });

    const root = document.getElementById('root')!;
    root.innerHTML = control;

    const img = document.createElement('img');
    img.src = '/api/slow.png';
    root.appendChild(img);

    await new Promise(resolve => setTimeout(resolve, 50));
    img.remove();

    await new Promise(resolve => setTimeout(resolve, 900));
    return store.getSnapshot().errors.map(e => ({ alt: e.alt }));
  }, CONTROL);

  expect(records.map(r => r.alt)).toEqual(['control']);
});

test('probes a URL broken in several places exactly once', async ({ page }) => {
  const { records, probeCount } = await page.evaluate(async () => {
    const { initBrokenImageReporter, createBrokenImageStore } = window.lib;
    const store = createBrokenImageStore();
    let probeCount = 0;

    initBrokenImageReporter({
      store,
      verifyDelayMs: 50,
      probeStatus: async () => {
        probeCount += 1;
        return 404;
      },
    });

    document.getElementById('root')!.innerHTML = `
      <img src="/api/missing.png"><img src="/api/missing.png"><img src="/api/missing.png">`;

    await new Promise(resolve => setTimeout(resolve, 900));
    return { records: store.getSnapshot().errors, probeCount };
  });

  expect(records).toHaveLength(1);
  expect(probeCount).toBe(1);
});

/**
 * The two documented blind spots. These tests assert the limitation, so that a
 * future change which quietly fixes or worsens it cannot pass unnoticed.
 */
test('does not see an image inside a shadow root', async ({ page }) => {
  const records = await page.evaluate(async control => {
    const { initBrokenImageReporter, createBrokenImageStore } = window.lib;
    const store = createBrokenImageStore();
    initBrokenImageReporter({ store, verifyDelayMs: 50 });

    const root = document.getElementById('root')!;
    root.innerHTML = control;

    const host = document.createElement('div');
    root.appendChild(host);
    host.attachShadow({ mode: 'open' }).innerHTML = '<img src="/api/missing.png">';

    await new Promise(resolve => setTimeout(resolve, 900));
    return store.getSnapshot().errors.map(e => ({ alt: e.alt }));
  }, CONTROL);

  // `error` is `composed: false`, so it never reaches the window listener — while the
  // control, in the light DOM, is recorded. The reporter is alive; the image is unseen.
  expect(records.map(r => r.alt)).toEqual(['control']);
});

test('does not see a failing CSS background-image', async ({ page }) => {
  const records = await collect(
    page,
    `${CONTROL}
     <div style="width:20px;height:20px;background-image:url('/api/missing.png')"></div>`,
  );

  // A failing background fires no event at all. There is nothing to listen for.
  expect(controlOnly(records)).toEqual(['control']);
});
