import { defineConfig } from 'vite';

// Relative base so the built site works from any path (e.g. GitHub Pages project sites).
// Two essays: hiring (hiring/index.html) and dating (dating/index.html). The root index.html lets
// the reader choose, and sends old links with a #section to the hiring essay.
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', hiring: 'hiring/index.html', dating: 'dating/index.html' } } },
  worker: { format: 'es' },
});
