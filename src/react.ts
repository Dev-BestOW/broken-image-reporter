/**
 * React entry point: `broken-image-reporter/react`.
 *
 * Split from the root entry so that consumers who only need
 * `initBrokenImageReporter` never load React.
 */

export { useBrokenImageReport } from './useBrokenImageReport';
export type { UseBrokenImageReportResult } from './useBrokenImageReport';

// Re-exported for convenience: a React consumer needs these types to describe
// what the hook returns, and should not have to import from two paths.
export type {
  BrokenImageRecord,
  BrokenImageState,
  BrokenImageStore,
} from './store';
