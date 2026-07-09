# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

- Documentation only. Corrected the claim that the reporter sees every image on the
  page. It sees `<img>` tags in the main document; images inside a shadow root and
  CSS `background-image` failures are out of reach, and the README now says so.

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
