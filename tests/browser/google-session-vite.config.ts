import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({ root: fileURLToPath(new URL('./google-session-fixture', import.meta.url)), publicDir: fileURLToPath(new URL('../../public/', import.meta.url)), plugins: [react()], define: { __OPENJOB_FIREBASE_CONFIG__: '{}', __OPENJOB_QA_PASSWORD_AUTH__: 'null', __OPENJOB_APPLE_SERVICE_ID__: '""' }, server: { host: '127.0.0.1', port: 4193, strictPort: true } });
