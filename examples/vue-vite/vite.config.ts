import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';

const PNG = () => readFileSync(new URL('./public/ok.png', import.meta.url));

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'demo-failing-endpoints',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = (req.url ?? '').split('?')[0];

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
