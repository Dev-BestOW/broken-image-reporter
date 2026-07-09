# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- `probeStatus`: recover an image's HTTP status your own way, typically by routing the
  probe through your backend, which is not bound by CORS and may use `GET` where an
  origin rejects `HEAD`. The library keeps the timeout, the abort-on-dispose, and the
  one-probe-per-unique-URL guarantee, and defines no wire format. Verified against a
  real cross-origin 404: the built-in probe records `null`, this records `404`.

  The endpoint it implies is an SSRF hole unless you allowlist image origins. The
  README ships a reference implementation that does.

## 0.2.0

### Added

- `BrokenImageRecord.selector`: a CSS path locating the broken image, anchored at the
  nearest ancestor with an `id` or a test id. A URL says an image is broken; this says
  where to go and fix it. Exported as a new trailing CSV column.

  **Breaking for anyone constructing a `BrokenImageRecord` by hand**, such as when
  seeding a store in a test. The field is required.

### Changed

- Corrected the claim that the reporter sees every image on the page. It sees `<img>`
  tags in the main document; images inside a shadow root and CSS `background-image`
  failures are out of reach, and the README now says so.
- Documented that images failing before `initBrokenImageReporter()` runs are never
  recorded, which bites server-rendered HTML behind a deferred module script.

## 0.1.0

Initial release.

- `initBrokenImageReporter()` detects failing `<img>` tags by listening on `window`
  in the capture phase, since image `error` events do not bubble.
- Failures are re-checked after a delay, so images that recovered or unmounted
  during a re-render are not reported as false positives.
- One `HEAD` probe per unique failing URL recovers the HTTP status the browser hides.
  Probes are bounded by `probeTimeoutMs` and aborted when the reporter is disposed.
- `useBrokenImageReport()`, at `broken-image-reporter/react`, exposes the collected
  records to React via `useSyncExternalStore`, with JSON and CSV export.
- The package root is framework-agnostic and does not load React.
