import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build also runs when served from a subpath.
  base: './',
  plugins: [react()],
  // pdf-lib's encoding tables contain U+FFFD as real data; escaping all
  // non-ASCII keeps it intact through hosts that reject the raw character.
  esbuild: { charset: 'ascii' },
});
