import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the Node server under /admin. In dev, API calls are proxied to a running server;
// set VITE_DEV_HOST to the tenant hostname the server should see (tenant is resolved by Host).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    fs: { allow: ['..'] },   // shared/zone-types.json lives one level up
    proxy: {
      '/api': { target: process.env.VITE_DEV_TARGET || 'http://127.0.0.1:3000', changeOrigin: false,
        headers: { host: process.env.VITE_DEV_HOST || 'hoteldemo.caritech.net' } },
      '/ws': { target: process.env.VITE_DEV_TARGET || 'http://127.0.0.1:3000', ws: true,
        headers: { host: process.env.VITE_DEV_HOST || 'hoteldemo.caritech.net' } },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
