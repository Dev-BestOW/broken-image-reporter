import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initBrokenImageReporter } from 'broken-image-reporter';
import { App } from './App';

// Started once, as early as possible — before React renders anything.
initBrokenImageReporter({
  debug: true,
  onError: record => {
    // In a real app this would POST to an endpoint you control.
    console.log('[demo] onError fired:', JSON.stringify(record));
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
