/**
 * Framework-agnostic entry point. Importing this must never pull in React —
 * the hook lives behind the `broken-image-reporter/react` subpath.
 */

export { initBrokenImageReporter } from './reporter';
export type { InitBrokenImageReporterOptions, ProbeStatus } from './reporter';

export { brokenImageStore, createBrokenImageStore } from './store';
export type {
  BrokenImageRecord,
  BrokenImageState,
  BrokenImageStore,
  CreateBrokenImageStoreOptions,
} from './store';
