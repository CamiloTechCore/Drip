import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const raw = process.env.VITE_BASE_PATH ?? env.VITE_BASE_PATH ?? '/';
  const base = `/${raw.split('/').filter(Boolean).join('/')}${raw === '/' ? '' : '/'}`;
  return {
    base, plugins: [react(), VitePWA({
      registerType: 'prompt', includeAssets: ['icons/*.png'],
      manifest: { name: 'Drip · Finanzas contigo', short_name: 'Drip', description: 'Daily Records for Individuals & Partners', lang: 'es', display: 'standalone', orientation: 'portrait', start_url: base, scope: base, theme_color: '#F7F8FA', background_color: '#F7F8FA', icons: [
        {src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png'}, {src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png'}, {src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable'}
      ]},
      workbox: { globPatterns: ['**/*.{js,css,html,png,woff2}'], maximumFileSizeToCacheInBytes: 4000000, navigateFallback: `${base}index.html`, cleanupOutdatedCaches: true, runtimeCaching: [{urlPattern: ({request, url}) => request.method === 'GET' && url.origin === self.location.origin && ['script','style','font','image'].includes(request.destination), handler: 'StaleWhileRevalidate', options: {cacheName: 'drip-static-v1', expiration:{maxEntries: 80,maxAgeSeconds:2592000}}}] }
    })],
    build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'], pdf: ['jspdf', 'jspdf-autotable'] } } } }
  };
});
