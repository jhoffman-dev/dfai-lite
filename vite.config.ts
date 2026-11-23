import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildDefines } from './tools/build-defines.ts';

export default defineConfig({
  plugins: [react()],
  // The version and commit Settings → About shows (src/app/build-info.ts).
  define: buildDefines(import.meta.dirname),
  // The one chunk past Vite's 500 kB is the editor's (TipTap), loaded after the first paint.
  build: { chunkSizeWarningLimit: 600 },
  // `pnpm tauri dev` runs `pnpm dev` on 1420 (src-tauri/tauri.conf.json).
  clearScreen: false,
  preview: { port: 4791, strictPort: true },
});
