import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Renderer only. Main and preload are bundled by scripts/build.mjs with esbuild.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true,
    // the app page, and the small prompt window the main process opens for its own questions
    rollupOptions: { input: { index: resolve(here, 'src/renderer/index.html'), prompt: resolve(here, 'src/renderer/prompt.html') } }, target: 'chrome130', sourcemap: true, chunkSizeWarningLimit: 4000 },
});
