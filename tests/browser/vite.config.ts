import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { webFirebaseConfigFor } from "../../config/web-firebase-config.mjs";

export default defineConfig({
  define: {
    __OPENJOB_FIREBASE_CONFIG__: JSON.stringify(
      webFirebaseConfigFor("preview"),
    ),
  },
  root: fileURLToPath(new URL("./fixture", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "firebase/app",
        replacement: fileURLToPath(new URL("./fixture/firebase-app.ts", import.meta.url)),
      },
      {
        find: "firebase/auth",
        replacement: fileURLToPath(new URL("./fixture/firebase-auth.ts", import.meta.url)),
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: true,
  },
});
