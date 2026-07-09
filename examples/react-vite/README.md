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
