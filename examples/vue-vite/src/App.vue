<script setup lang="ts">
import AbortedOnRerender from './AbortedOnRerender.vue';
import UnmountedBeforeLoad from './UnmountedBeforeLoad.vue';
import { computed } from 'vue';
import { useBrokenImageReport } from './useBrokenImageReport';
import { directStore, proxiedStore } from './reporters';

const { count, errors, clearErrors, toCsv } = useBrokenImageReport(directStore);
const proxied = useBrokenImageReport(proxiedStore);

// Both reporters see every failure; only their probes differ. Key by URL to line the
// two statuses up.
const proxiedStatus = computed(
  () => new Map(proxied.errors.value.map(e => [e.url, e.httpStatus])),
);

const clearBoth = () => {
  clearErrors();
  proxied.clearErrors();
};

// `console` is not exposed to templates, so the handler has to live here.
const logCsv = () => console.log(toCsv());

const CASES = [
  { label: '403 expired (same origin)', src: '/api/expired.png' },
  { label: '404 missing (same origin)', src: '/api/missing.png' },
  { label: '404 but HEAD says 405', src: '/api/head-405.png' },
  { label: 'cross-origin, no CORS', src: 'https://www.google.com/nope-xyz.png' },
  { label: 'unresolvable host', src: 'https://nonexistent.invalid/a.png' },
  { label: 'data: URL (ignored)', src: 'data:image/png;base64,bm90YXBuZw==' },
  { label: 'valid (not reported)', src: '/ok.png' },
];
</script>

<template>
  <main>
    <h1>broken-image-reporter demo (Vue)</h1>
    <p>
      Installed from npm. The reporters were started in <code>main.ts</code>; no image
      below has an <code>onerror</code> handler, and no Vue-specific package is involved.
    </p>
    <p>
      Two reporters watch the same page. One uses the built-in <code>HEAD</code> probe,
      which the browser subjects to CORS. The other passes <code>probeStatus</code> and
      asks <code>/api/probe</code> on this dev server, which is not bound by CORS and
      issues <code>GET</code>.
    </p>

    <div class="row">
      <div class="case" v-for="c in CASES" :key="c.src">
        <img :src="c.src" :alt="c.label" />
        <div>{{ c.label }}</div>
      </div>
      <div class="case">
        <AbortedOnRerender />
        <div>aborted on re-render</div>
      </div>
      <div class="case">
        <UnmountedBeforeLoad />
        <div>unmounted before load</div>
      </div>
    </div>

    <h2>Reported: {{ count }}</h2>
    <button @click="clearBoth">Clear</button>
    <button @click="logCsv">Log CSV</button>

    <table>
      <thead>
        <tr>
          <th>url</th>
          <th>HEAD probe</th>
          <th>via /api/probe</th>
          <th>selector</th>
          <th>alt</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in errors" :key="e.id">
          <td>{{ e.url }}</td>
          <td>{{ e.httpStatus ?? 'null' }}</td>
          <td>{{ proxiedStatus.get(e.url) ?? 'null' }}</td>
          <td><code>{{ e.selector ?? '—' }}</code></td>
          <td>{{ e.alt ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
  </main>
</template>
