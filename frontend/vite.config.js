import { defineConfig } from 'vite';

export default defineConfig({
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
