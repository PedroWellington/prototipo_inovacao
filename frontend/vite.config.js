import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Bind mount do Windows não propaga eventos de arquivo: polling no container.
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
    proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:8000', changeOrigin: false } },
  },
  build: { target: 'es2020', sourcemap: false },
});
