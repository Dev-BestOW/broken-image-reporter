import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initBrokenImageReporter } from 'broken-image-reporter';
import { App } from './App';
import { directStore, probeViaProxy, proxiedStore } from './reporters';

// Started once, as early as possible — before React renders anything.

// The built-in HEAD probe, issued by the browser and subject to CORS.
initBrokenImageReporter({
  store: directStore,
  debug: true,
  onError: record => {
    // In a real app this would POST to an endpoint you control.
    console.log('[demo] onError fired:', JSON.stringify(record));
  },
});

// The same failures, with the status recovered through our own backend instead.
initBrokenImageReporter({ store: proxiedStore, probeStatus: probeViaProxy });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
