import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { webFirebaseConfigFor } from "../../config/web-firebase-config.mjs";
import nativeIdentities from "../../config/native-identities.json" with { type: "json" };

export default defineConfig({
  root: fileURLToPath(new URL("./personal-workspace-fixture", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "next/link": fileURLToPath(new URL("./personal-workspace-fixture/link.tsx", import.meta.url)) } },
  define: {
    __OPENJOB_FIREBASE_CONFIG__: JSON.stringify(webFirebaseConfigFor("preview")),
    __OPENJOB_APPLE_SERVICE_ID__: JSON.stringify(nativeIdentities.apple.signInServices.nonproduction.serviceId),
    __OPENJOB_QA_PASSWORD_AUTH__: "null",
  },
  server: { host: "127.0.0.1", port: 4178, strictPort: true, proxy: {
    "/api/v1": { target: "http://127.0.0.1:4181", changeOrigin: false },
    "/__test": { target: "http://127.0.0.1:4181", changeOrigin: false },
  } },
});
