import { createApp } from 'vue';
import { initBrokenImageReporter } from 'broken-image-reporter';
import App from './App.vue';

// Started once, as early as possible — before Vue mounts anything.
initBrokenImageReporter({
  debug: true,
  onError: record => {
    // In a real app this would POST to an endpoint you control.
    console.log('[demo] onError fired:', JSON.stringify(record));
  },
});

createApp(App).mount('#app');
