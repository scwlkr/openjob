import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  {
    ignores: [
      ".artifacts/**",
      ".expo/**",
      "android/**",
      "coverage/**",
      "ios/**",
      "node_modules/**",
    ],
  },
]);
