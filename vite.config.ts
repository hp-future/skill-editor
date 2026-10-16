import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Library build: the demo page (`index.html`) is the dev entry, while
// `pnpm build` emits the reusable component bundle plus type declarations.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'SkillEditor',
      formats: ['es'],
      fileName: 'skill-editor',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        assetFileNames: 'skill-editor[extname]',
      },
    },
  },
});
