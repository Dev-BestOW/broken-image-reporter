# Vue + Vite example

The same page as [`../react-vite`](../react-vite), built with Vue. It exists to show
that the core is genuinely framework-agnostic: **no part of this example imports
`broken-image-reporter/react`, and no Vue-specific package exists.**

```bash
npm install
npm run dev   # http://localhost:5200
```

## Binding the store to Vue

`initBrokenImageReporter` is plain JavaScript, so `src/main.ts` calls it exactly as the
React example does. Reading the collected failures is the only part that touches a
framework, and the store exposes a `subscribe` / `getSnapshot` pair for precisely that
reason. The whole binding is `src/useBrokenImageReport.ts`, ~20 lines:

```ts
const state = shallowRef(store.getSnapshot());
const unsubscribe = store.subscribe(() => (state.value = store.getSnapshot()));
onScopeDispose(unsubscribe);
```

`shallowRef` suffices because the store replaces its snapshot on every change rather
than mutating it. Copy that file into your own project — Svelte, Solid, or a plain
`store.subscribe()` call in vanilla JS adapt just as easily.

## What the page proves

`vite.config.ts` serves the same-origin failures, so their status is recoverable. The
cross-origin ones are real internet URLs, so they are not.

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

Reported rows carry a `selector` too, anchored here at Vue's `#app` mount point.

The last two matter most, and they are not a React problem. Vue patches an `<img>`'s
`src` on re-render and detaches it on `v-if`, so the browser aborts the in-flight
request and fires `error` in both cases — exactly as React does. Neither is a broken
image. The reporter re-checks the element after `verifyDelayMs` and discards both.

See the React example's README for why `/api/head-405.png` reports `405` and why
`google.com` reports `null` despite really being a 404.
