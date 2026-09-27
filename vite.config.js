import { defineConfig } from 'vite';

// Relative base so the built site works from any path (e.g. GitHub Pages project sites).
// Two essays: hiring (hiring/index.html) and dating (dating/index.html); the root index.html
// redirects old links to the hiring essay.
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', hiring: 'hiring/index.html', dating: 'dating/index.html' } } },
  worker: { format: 'es' },
});
