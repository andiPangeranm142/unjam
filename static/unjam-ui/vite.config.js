import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Multi-page Custom UI build: one Vite project, three HTML entries — one per
// Forge module. The manifest maps them via the `unjam-ui` resource entries:
//   panel -> issue-panel.html, page -> project-page.html, admin -> admin-page.html
// `base: './'` is REQUIRED: Forge serves the build from a unique resource URL,
// so every asset reference must be relative.
export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: resolve(root, 'issue-panel.html'),
        page: resolve(root, 'project-page.html'),
        admin: resolve(root, 'admin-page.html'),
      },
    },
  },
});
