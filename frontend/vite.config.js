import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

// A landing (estática) fica em "/" e o app em "/app/", no mesmo endereço (ver frontend/nginx.conf).
// Em desenvolvimento, este plugin serve a landing em "/" para o Vite espelhar a produção.
const LANDING = resolve(process.env.LANDING_DIR || '../landing');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const landingDev = {
  name: 'landing-dev',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const path = decodeURIComponent(req.url.split('?')[0]);
      if (path.startsWith('/app') || path.startsWith('/api')) return next();
      const file = normalize(join(LANDING, path.endsWith('/') ? `${path}index.html` : path));
      // Só o que a página publica: nada de dependências, scripts de build ou medições.
      if (!file.startsWith(LANDING + sep) || /[\\/](node_modules|\.build|scripts|perf)[\\/]/.test(file)) return next();
      try {
        const body = await readFile(file);
        res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
        res.end(body);
      } catch {
        next();
      }
    });
  },
};

export default defineConfig({
  base: '/app/',
  plugins: [landingDev],
  // PRODUCT_NAME vem do .env da raiz (ou do ambiente, no Docker): único lugar com o nome do produto.
  envDir: '..',
  envPrefix: ['VITE_', 'PRODUCT_NAME'],
  server: {
    port: 5173,
    // Bind mount do Windows não propaga eventos de arquivo: polling no container.
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
    proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:8000', changeOrigin: false } },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    // MapLibre (~800 KB) em chunk próprio: só carrega no explorador e não invalida o cache quando o app muda.
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } },
  },
});
