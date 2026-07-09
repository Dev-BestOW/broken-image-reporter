# broken-image-reporter

[![npm](https://img.shields.io/npm/v/broken-image-reporter.svg)](https://www.npmjs.com/package/broken-image-reporter)
[![license](https://img.shields.io/npm/l/broken-image-reporter.svg)](./LICENSE)

Detect every broken `<img>` on the page — including ones rendered by components you don't control — recover the HTTP status behind the failure, and report it wherever you like.

Zero runtime dependencies. The core is framework-agnostic; React is an optional peer dependency needed only for the hook at `broken-image-reporter/react`.

```bash
npm install broken-image-reporter
```

## Why not `onError`?

An `<img>` `error` event **does not bubble**. A handler on `document` never sees it, so the usual advice is to put an `onError` prop on every image — which only works for images your own code renders. Design-system wrappers, rich-text content, third-party embeds, and `background-image`-adjacent `<img>` tags all slip through.

This library listens on `window` in the **capture** phase, which does see them:

```ts
window.addEventListener('error', handler, /* useCapture */ true);
```

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

### Example

[`examples/react-vite`](./examples/react-vite) is a runnable page covering every case: a 403, a 404, an origin that rejects `HEAD`, cross-origin failures whose status cannot be recovered, and two `error` events that are *not* broken images.

## API

Everything except the hook is exported from the package root. The hook — the only
React-dependent export — lives at `broken-image-reporter/react`.

### `initBrokenImageReporter(options?): () => void`

Returns a disposer that removes the listener and cancels any pending checks. Safe to call during SSR, where it no-ops.

| Option | Default | Description |
| --- | --- | --- |
| `onError` | — | Called once per unique failing URL, after the record is stored. |
| `probeHttpStatus` | `true` | Issue a `HEAD` request to recover the status. One extra request per unique failing URL. |
| `probeTimeoutMs` | `5000` | Abandon an unanswered probe after this long, recording `httpStatus: null`. |
| `verifyDelayMs` | `500` | How long to wait before confirming a failure is real. |
| `ignore` | — | `(url, element) => boolean`. Return `true` to skip a failure entirely. |
| `debug` | `false` | `console.warn` each confirmed failure. |
| `store` | shared store | Pass a `createBrokenImageStore()` instance to isolate state. |

`data:`, `blob:`, and `about:` URLs are always ignored.

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
}
```

## Caveats worth knowing before you rely on this

**`httpStatus` is `null` more often than you'd expect.** The `HEAD` probe is a `fetch`, so it obeys CORS. If the image origin does not send `Access-Control-Allow-Origin`, the fetch rejects and the status is unknowable — *even though the server did return a real status*. In practice you get a status from your own origin and from CORS-enabled buckets (typical for S3/GCS/CloudFront with a CORS policy), and `null` from most third-party hosts. `null` still means "this image is broken"; it just doesn't tell you why.

**Some servers reject `HEAD` itself.** A CDN or origin that answers `HEAD` with `405 Method Not Allowed` gives you `httpStatus: 405` for an image that is really a 404. The status describes the probe, not the original image request — treat an unexpected `405` as "unknown", not as the reason the image broke.

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
