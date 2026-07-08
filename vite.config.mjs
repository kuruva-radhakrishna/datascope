import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single root-level package.json (no frontend/package.json) so Vercel sees
// one deployable project instead of two — a second package.json under
// frontend/ previously made the CLI auto-detect "frontend" + "backend" as
// separate services and refuse the classic buildCommand/outputDirectory config.
export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  server: {
    port: 9080,
    proxy: {
      '/api': 'http://localhost:8090',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
