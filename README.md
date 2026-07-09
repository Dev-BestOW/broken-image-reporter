# broken-image-reporter

[![npm](https://img.shields.io/npm/v/broken-image-reporter.svg)](https://www.npmjs.com/package/broken-image-reporter)
[![license](https://img.shields.io/npm/l/broken-image-reporter.svg)](./LICENSE)

Detect broken `<img>` tags on the page — including ones rendered by components you don't control — recover the HTTP status behind the failure, and report it wherever you like.

Zero runtime dependencies. The core is framework-agnostic; React is an optional peer dependency needed only for the hook at `broken-image-reporter/react`.

```bash
npm install broken-image-reporter
```

## Why not `onError`?

An `<img>` `error` event **does not bubble**. A handler on `document` never sees it, so the usual advice is to put an `onError` prop on every image — which only works for images your own code renders. Design-system wrappers, rich-text content, and third-party embeds all slip through.

This library listens on `window` in the **capture** phase, which does see them:

```ts
window.addEventListener('error', handler, /* useCapture */ true);
```

That covers any `<img>` in the main document, whoever rendered it, including a `<picture>` whose `<source>` fails — the failing URL is read from `currentSrc`, so it is the one the browser actually tried. It does **not** cover images inside a shadow root, or CSS `background-image`. See [what this cannot see](#what-this-cannot-see).

It also solves two problems you hit immediately afterwards.

**React aborts image requests during re-renders.** When an `<img>` unmounts or its `src` changes mid-flight, the browser fires `error` even though nothing is broken. Naively logging every event floods you with false positives. After a short delay this library re-checks the element and discards it if the image recovered (`complete && naturalWidth > 0`) or if it was detached from the document.

**The browser hides the status code.** An `error` event tells you *that* the image failed, never *why*. A 403 from an expired signed URL and a 404 from a missing object are indistinguishable — and they need completely different fixes. This library issues one follow-up `HEAD` request per unique failing URL to recover the status.

## Usage

Start the listener once, as early as possible:

```ts
// main.tsx
import { initBrokenImageReporter } from 'broken-image-reporter';

initBrokenImageReporter({
  onError: record => {
    if (record.httpStatus === 403) {
      // Expired signed URL. Send it somewhere useful.
      fetch('/api/report-broken-image', {
        method: 'POST',
        body: JSON.stringify(record),
      });
    }
  },
});
```

That much is plain JavaScript — it works in Vue, Svelte, or no framework at all.

### React

If you use React, read the collected failures anywhere in your tree:

```tsx
import { useBrokenImageReport } from 'broken-image-reporter/react';

function BrokenImageBadge() {
  const { count, errors, clearErrors, downloadCsv } = useBrokenImageReport();
  if (count === 0) return null;

  return (
    <aside>
      <p>{count} broken images</p>
      <ul>
        {errors.map(e => (
          <li key={e.id}>
            {e.url} — {e.httpStatus ?? 'unreachable'}
          </li>
        ))}
      </ul>
      <button onClick={() => downloadCsv()}>Export CSV</button>
      <button onClick={clearErrors}>Clear</button>
    </aside>
  );
}
```

The hook is headless on purpose — bring your own UI, in your own design system. Render it behind `import.meta.env.DEV` and you have an in-app devtool; wire `onError` to your backend and you have production monitoring.

### Examples

Two runnable pages covering every case: a 403, a 404, an origin that rejects `HEAD`, cross-origin failures whose status cannot be recovered, and two `error` events that are *not* broken images.

- [`examples/react-vite`](./examples/react-vite) — the hook.
- [`examples/vue-vite`](./examples/vue-vite) — no hook, no Vue package. Binding the store to Vue's reactivity takes about twenty lines, and the same shape works for Svelte, Solid, or vanilla JS.

## API

Everything except the hook is exported from the package root. The hook — the only
React-dependent export — lives at `broken-image-reporter/react`.

### `initBrokenImageReporter(options?): () => void`

Returns a disposer that removes the listener and cancels any pending checks. Safe to call during SSR, where it no-ops.

| Option | Default | Description |
| --- | --- | --- |
| `onError` | — | Called once per unique failing URL, after the record is stored. |
| `probeHttpStatus` | `true` | Issue a `HEAD` request to recover the status. One extra request per unique failing URL. `false` disables probing entirely, including `probeStatus`. |
| `probeStatus` | built-in `HEAD` | `(url, signal) => Promise<number \| null>`. Recover the status your own way — see [cross-origin images](#recovering-the-status-of-cross-origin-images). |
| `probeTimeoutMs` | `5000` | Abandon an unanswered probe after this long, recording `httpStatus: null`. |
| `verifyDelayMs` | `500` | How long to wait before confirming a failure is real. |
| `ignore` | — | `(url, element) => boolean`. Return `true` to skip a failure entirely. |
| `debug` | `false` | `console.warn` each confirmed failure. |
| `store` | shared store | Pass a `createBrokenImageStore()` instance to isolate state. |

`data:`, `blob:`, and `about:` URLs are always ignored.

### Recovering the status of cross-origin images

The built-in probe is a browser `fetch`, so it obeys CORS. An image on an origin that sends no `Access-Control-Allow-Origin` yields `httpStatus: null` — even though the server did return a real status. Measured against a real 404 on `google.com`: the default probe records `null`, and the same image probed through a backend records `404`.

A server is not bound by CORS, and can use `GET` on origins that reject `HEAD`. `probeStatus` hands you that request; the library keeps the timeout, the abort-on-dispose, and the one-probe-per-unique-URL guarantee. It defines no wire format — the response shape below is yours to change.

```ts
initBrokenImageReporter({
  probeStatus: async (url, signal) => {
    const res = await fetch(`/api/probe?url=${encodeURIComponent(url)}`, { signal });
    if (!res.ok) return null; // the proxy failed; the image's status stays unknown
    const { status } = await res.json();
    return status;
  },
});
```

Forward the `signal`. Without it, a hung origin keeps the request alive after the reporter is disposed.

> [!WARNING]
> **An endpoint that fetches an arbitrary client-supplied URL is an SSRF hole.** Anyone can point it at `http://169.254.169.254/` or an internal host and read the response through your server. Allowlist the origins you actually serve images from.

```ts
// Express. The allowlist is the whole point.
const ALLOWED = new Set(['https://cdn.example.com', 'https://images.example.com']);

app.get('/api/probe', async (req, res) => {
  let origin;
  try {
    origin = new URL(String(req.query.url)).origin;
  } catch {
    return res.status(400).end();
  }
  if (!ALLOWED.has(origin)) return res.status(400).end();

  try {
    const upstream = await fetch(String(req.query.url), { method: 'GET' });
    res.json({ status: upstream.status });
  } catch {
    res.json({ status: null }); // unreachable, not a status
  }
});
```

Because you own the function, `probeStatus` also covers cases that have nothing to do with CORS: adding an auth header, batching probes, or reading a status your CDN already exposes on another endpoint.

### `useBrokenImageReport(store?): UseBrokenImageReportResult`

```ts
import { useBrokenImageReport } from 'broken-image-reporter/react';
```

Subscribes via `useSyncExternalStore`. Returns `{ errors, count, clearErrors, downloadJson, downloadCsv, toJson, toCsv }`.

If you passed a custom `store` to `initBrokenImageReporter`, pass the same one here. Otherwise both entry points share one default store instance.

### `createBrokenImageStore(options?): BrokenImageStore`

Creates an isolated store, useful for tests or for multiple independent reporters. Accepts `maxErrors` (default `200`); the oldest records are dropped past that bound.

### `BrokenImageRecord`

```ts
interface BrokenImageRecord {
  id: string;
  url: string;
  httpStatus: number | null;
  pageUrl: string;
  timestamp: string; // ISO-8601
  alt: string | null;
  selector: string | null; // e.g. '#gallery > figure > img'
}
```

`selector` is a CSS path locating the element, captured while it is still in the document. A URL alone tells you an image is broken; the same URL rendered by three templates gives you nowhere to start, and `alt` is empty on exactly the decorative images nobody notices.

The path is anchored at the nearest ancestor with an `id`, a `data-testid`, `data-test-id`, or `data-cy`, so it survives unrelated markup changes elsewhere on the page. Without such an ancestor it stops after six segments and is a *locator hint*, not an identity — `querySelector` may match an earlier element. It is `null` when the element cannot be described.

## What this cannot see

The capture-phase listener is not a universal net. Two categories of broken image never reach it, and no option turns them on today.

**Images inside a shadow root.** An `error` event is `composed: false`, so it does not cross a shadow boundary and `window` is never on its propagation path. If your design system ships web components that render `<img>` in a shadow root, those failures are invisible to this library — including closed roots, which nothing outside can observe at all. Ordinary framework components are unaffected; this is specifically about `attachShadow`.

**CSS `background-image`.** A background that 404s fires no `error` event anywhere. There is nothing for a listener to hear. Detecting these needs a different mechanism entirely — walking computed styles and probing each URL — which this library does not do.

Both were confirmed against Chrome, alongside the cases that *do* work: a plain `<img>`, and a `<picture>` whose `<source>` fails.

## Caveats worth knowing before you rely on this

**`httpStatus` is `null` more often than you'd expect.** The `HEAD` probe is a `fetch`, so it obeys CORS. If the image origin does not send `Access-Control-Allow-Origin`, the fetch rejects and the status is unknowable — *even though the server did return a real status*. In practice you get a status from your own origin and from CORS-enabled buckets (typical for S3/GCS/CloudFront with a CORS policy), and `null` from most third-party hosts. `null` still means "this image is broken"; it just doesn't tell you why. Route the probe through your own backend with [`probeStatus`](#recovering-the-status-of-cross-origin-images) to lift this.

**Some servers reject `HEAD` itself.** A CDN or origin that answers `HEAD` with `405 Method Not Allowed` gives you `httpStatus: 405` for an image that is really a 404. The status describes the probe, not the original image request — treat an unexpected `405` as "unknown", not as the reason the image broke. A `probeStatus` that issues `GET` from your backend avoids this too.

**Images that fail before you call `init` are lost.** The listener only hears events fired after it is attached. A `<script type="module">` is deferred, so images already in the server-rendered HTML can fail while the bundle is still loading — and those failures are never recorded. Call `initBrokenImageReporter()` from the earliest script you control. Images rendered by your framework after hydration are never at risk.

**The probe is a second request.** It is issued once per unique URL, after the failure is confirmed. Set `probeHttpStatus: false` if that's not acceptable.

**Records are deduplicated by URL, for the lifetime of the page.** The same broken URL appearing in fifty places produces one record and one `onError` call.

**Never put a webhook URL in `onError` on the client.** Bundlers inline environment variables into the shipped JavaScript, so a Slack incoming-webhook URL in your frontend is readable by anyone who opens devtools, and usable by them to post into your channel. Send records to an endpoint you control and forward from there.

## Contributing

```bash
npm install
npm test
npm run typecheck
npm run build
```

Issues and pull requests are welcome at [Dev-BestOW/broken-image-reporter](https://github.com/Dev-BestOW/broken-image-reporter).

## License

MIT © Dev-BestOW
