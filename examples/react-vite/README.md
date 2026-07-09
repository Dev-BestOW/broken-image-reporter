# React + Vite example

A runnable page that exercises every branch of the reporter: real failures, failures
whose status cannot be recovered, and `error` events that are not failures at all.

```bash
npm install
npm run dev   # http://localhost:5199
```

This installs `broken-image-reporter` from npm rather than linking the parent
directory, so it exercises the published artifact — exports map, type declarations
and all. To test unreleased local changes instead, build the root package and swap the
dependency for `"broken-image-reporter": "file:../.."`.

## What the page proves

The reporter is started once in `src/main.tsx`. **No `<img>` on the page has an
`onError` prop** — everything below is caught by the capture-phase listener alone.

`vite.config.ts` serves the same-origin failures, so their status is recoverable.
The cross-origin ones are real internet URLs, so they are not.

| Image | Expected |
| --- | --- |
| `/api/expired.png` | reported, `httpStatus: 403` |
| `/api/missing.png` | reported, `httpStatus: 404` |
| `/api/head-405.png` | reported, `httpStatus: 405` |
| `https://www.google.com/nope-xyz.png` | reported, `httpStatus: null` |
| `https://nonexistent.invalid/a.png` | reported, `httpStatus: null` |
| `data:` URL | not reported |
| `/ok.png` | not reported |
| `<AbortedOnRerender>` | not reported |
| `<UnmountedBeforeLoad>` | not reported |

Every reported row also carries a `selector` — here `#root > main > div > div:nth-of-type(3) > img`, anchored at Vite's `#root`. Nothing on this page has an `id` or a `data-testid` near the images, which is the worst case for readability; give a real gallery an `id` and the path shortens to something you can paste into devtools.

## The two probes, side by side

`main.tsx` starts **two** reporters over two stores. They see the same failures; only the way they recover the status differs. The table prints both columns:

| Image | `HEAD` probe | via `/api/probe` |
| --- | --- | --- |
| `/api/expired.png` | `403` | `403` |
| `/api/missing.png` | `404` | `404` |
| `/api/head-405.png` | `405` | **`404`** |
| `https://www.google.com/nope-xyz.png` | `null` | **`404`** |
| `https://nonexistent.invalid/a.png` | `null` | `null` |

The two bold cells are what `probeStatus` buys. Google really does answer `404`, but the browser's `HEAD` probe obeys CORS and never sees it; a server does. The `405` trap dissolves for the same reason — the proxy issues `GET`, which that endpoint answers honestly.

The last row stays `null` in both columns, and should: an unresolvable host is broken, and its status is genuinely unknowable.

`/api/probe` lives in `vite.config.ts`. **It allowlists origins**, because an endpoint that fetches an arbitrary client-supplied URL is an SSRF hole. Copy the allowlist, not just the fetch.

## Three rows worth staring at

Three of these rows are the whole point of the library:

**`/api/head-405.png` really is a 404**, but its origin answers `HEAD` with `405`. The
recorded status describes the probe, not the image. Treat an unexpected `405` as
"unknown", never as the reason the image broke.

**`https://www.google.com/nope-xyz.png` really is a 404 too**, and it still records
`null` — the origin sends no `Access-Control-Allow-Origin`, so the probe `fetch`
rejects without ever seeing the status. Expect `null` from most third-party hosts.

**`AbortedOnRerender` and `UnmountedBeforeLoad` both fire `error` events.** One swaps
its `src` mid-flight, the other unmounts before the response arrives; the browser
aborts the request and reports an error in each case. Neither is a broken image, and
the reporter discards both after re-checking the element. A hand-rolled capture
listener without that re-check would log both.
