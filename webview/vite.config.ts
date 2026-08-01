import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'node:path';

// Vite is consumed two ways:
//   1. Build → emits webview/dist/assets/*.{js,css} that the extension host serves.
//   2. Dev   → when OLLOPA_WEBVIEW_DEV=1 is set on the extension host, it loads
//             http://localhost:5173 directly. The CSP and dev script src in
//             webviewProvider.ts point here.
//
// `root: 'src'` puts the source tree at the vite root; `outDir: '../dist'`
// hops back up one level so the build emits `webview/dist` (matching the
// path the extension host reads in `webviewProvider.ts`).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable filenames so the extension's webview HTML can reference them.
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  root: path.resolve(__dirname, 'src'),
});
