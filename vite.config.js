import { defineConfig } from 'vite';

// Relative base so the built site works from any path (e.g. GitHub Pages project sites).
// Two pages: the hiring essay (index.html) and the dating essay (dating.html).
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', dating: 'dating.html' } } },
  worker: { format: 'es' },
});
