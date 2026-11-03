import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The built site goes to /docs, which GitHub Pages publishes (Settings → Pages → main /docs).
  build: { chunkSizeWarningLimit: 900, outDir: '../docs', emptyOutDir: true },
  base: './', // works on GitHub Pages under /<repo-name>/
  server: { port: 5173 },
});
