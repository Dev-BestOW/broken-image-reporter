/**
 * Fixture server for the end-to-end tests.
 *
 * Serves the built bundle, a harness page, and endpoints that fail in specific,
 * distinguishable ways. Everything is local: the page is loaded from `localhost`
 * and the "third-party" images from `127.0.0.1`, which the browser treats as a
 * different origin. That reproduces a CORS-blocked probe with no internet access.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.E2E_PORT ?? 5314);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A valid 1x1 PNG. */
const OK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The proxy must never fetch an arbitrary client-supplied URL. */
const ALLOWED_PROBE_ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];

const HARNESS = `<!doctype html>
<title>broken-image-reporter e2e harness</title>
<main id="root"></main>
<script type="module">
  import * as lib from '/dist/index.js';
  // The tests drive the library through this handle; the page itself does nothing.
  window.lib = lib;
  window.harnessReady = true;
</script>
`;

const send = (res, status, type, body) =>
  res.writeHead(status, { 'content-type': type }).end(body);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // A server-side probe: not bound by CORS, and free to use GET where HEAD is refused.
  if (path === '/api/probe') {
    const target = url.searchParams.get('url') ?? '';
    let origin = null;
    try {
      origin = new URL(target).origin;
    } catch {
      /* malformed; rejected below */
    }
    if (!origin || !ALLOWED_PROBE_ORIGINS.includes(origin)) {
      return send(res, 400, 'text/plain', 'origin not allowed');
    }
    try {
      const upstream = await fetch(target, { method: 'GET' });
      return send(res, 200, 'application/json', JSON.stringify({ status: upstream.status }));
    } catch {
      return send(res, 200, 'application/json', JSON.stringify({ status: null }));
    }
  }

  // An expired signed URL.
  if (path === '/api/expired.png') return send(res, 403, 'text/plain', 'Forbidden');

  // A missing object.
  if (path === '/api/missing.png') return send(res, 404, 'text/plain', 'Not Found');

  // Really a 404, but HEAD is refused. The probe can only report on itself.
  if (path === '/api/head-405.png') {
    if (req.method === 'HEAD') return res.writeHead(405).end();
    return send(res, 404, 'text/plain', 'Not Found');
  }

  // Slow but valid: used to abort an in-flight request from a re-render or unmount.
  if (path === '/api/slow.png') {
    setTimeout(() => send(res, 200, 'image/png', OK_PNG), 3000);
    return;
  }

  if (path === '/ok.png') return send(res, 200, 'image/png', OK_PNG);

  if (path.startsWith('/dist/')) {
    try {
      const body = await readFile(ROOT + path.slice(1));
      return send(res, 200, 'text/javascript', body);
    } catch {
      return send(res, 404, 'text/plain', 'build the package first');
    }
  }

  return send(res, 200, 'text/html', HARNESS);
}).listen(PORT, () => console.log(`e2e fixture server on http://localhost:${PORT}`));
