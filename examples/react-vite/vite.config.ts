import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const PNG = () => readFileSync(new URL('./public/ok.png', import.meta.url));

/**
 * The proxy must never fetch an arbitrary client-supplied URL — that is an SSRF hole.
 * A real deployment allowlists the origins it serves images from.
 */
const ALLOWED_PROBE_ORIGINS = [
  'http://localhost:5199',
  'http://127.0.0.1:5199',
  'https://www.google.com',
  'https://nonexistent.invalid',
];

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'demo-failing-endpoints',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = (req.url ?? '').split('?')[0];

          // What `probeStatus` calls. A server is not bound by CORS, and can use GET
          // on an origin that refuses HEAD — so it answers where the browser cannot.
          if (url === '/api/probe') {
            const target = new URL(req.url ?? '', 'http://localhost:5199').searchParams.get(
              'url',
            );
            let origin: string | null = null;
            try {
              origin = new URL(String(target)).origin;
            } catch {
              /* malformed; rejected below */
            }
            if (!origin || !ALLOWED_PROBE_ORIGINS.includes(origin)) {
              res.statusCode = 400;
              return res.end('origin not allowed');
            }

            res.setHeader('Content-Type', 'application/json');
            try {
              const upstream = await fetch(String(target), { method: 'GET' });
              return res.end(JSON.stringify({ status: upstream.status }));
            } catch {
              // Unreachable host: broken, but the status is genuinely unknowable.
              return res.end(JSON.stringify({ status: null }));
            }
          }

          // Expired signed URL: 403 on both GET and HEAD.
          if (url === '/api/expired.png') {
            res.statusCode = 403;
            return res.end('Forbidden');
          }

          // Missing object: 404 on both.
          if (url === '/api/missing.png') {
            res.statusCode = 404;
            return res.end('Not Found');
          }

          // The documented trap: really a 404, but HEAD answers 405.
          // The probe should report 405 — describing the probe, not the image.
          if (url === '/api/head-405.png') {
            if (req.method === 'HEAD') {
              res.statusCode = 405;
              return res.end();
            }
            res.statusCode = 404;
            return res.end('Not Found');
          }

          // Slow but valid: used to simulate React aborting an in-flight request.
          if (url === '/api/slow.png') {
            setTimeout(() => {
              res.setHeader('Content-Type', 'image/png');
              res.end(PNG());
            }, 3000);
            return;
          }

          next();
        });
      },
    },
  ],
});
