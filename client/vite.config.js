import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The client lives in ./client; the built site goes to ./client/dist, which the
// Express server serves in production. In dev, /api is proxied to the API server.
export default defineConfig({
  root: path.resolve(import.meta.dirname, '.'),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});
