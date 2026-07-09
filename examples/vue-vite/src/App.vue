<script setup lang="ts">
import AbortedOnRerender from './AbortedOnRerender.vue';
import UnmountedBeforeLoad from './UnmountedBeforeLoad.vue';
import { useBrokenImageReport } from './useBrokenImageReport';

const { count, errors, clearErrors, toCsv } = useBrokenImageReport();

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
      Installed from npm. The reporter was started in <code>main.ts</code>; no image below
      has an <code>onerror</code> handler, and no Vue-specific package is involved.
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
    <button @click="clearErrors">Clear</button>
    <button @click="logCsv">Log CSV</button>

    <table>
      <thead>
        <tr>
          <th>url</th>
          <th>httpStatus</th>
          <th>alt</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in errors" :key="e.id">
          <td>{{ e.url }}</td>
          <td>{{ e.httpStatus ?? 'null' }}</td>
          <td>{{ e.alt ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
  </main>
</template>
