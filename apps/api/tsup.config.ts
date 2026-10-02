import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  clean: true,
  bundle: true,
  splitting: false,
  noExternal: ['@morphic/db', '@morphic/shared'],
});
