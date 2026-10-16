import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  root: fileURLToPath(new URL('./web/', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { 'next/link': fileURLToPath(new URL('./web/link.tsx', import.meta.url)) } },
  define: {
    __OPENJOB_FIREBASE_CONFIG__: 'globalThis.__OPENJOB_SERVICE_CONFIG__.firebase',
    __OPENJOB_APPLE_SERVICE_ID__: 'globalThis.__OPENJOB_SERVICE_CONFIG__.appleServiceId',
    __OPENJOB_QA_PASSWORD_AUTH__: 'null',
  },
});
