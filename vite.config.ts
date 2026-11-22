import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The one chunk past Vite's 500 kB is CodeMirror's, loaded after the first paint.
  build: { chunkSizeWarningLimit: 600 },
  // `pnpm tauri dev` runs `pnpm dev` on 1420 (src-tauri/tauri.conf.json).
  clearScreen: false,
  preview: { port: 4791, strictPort: true },
});
