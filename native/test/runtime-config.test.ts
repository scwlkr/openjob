jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        openjob: {
          apiBasePath: "/api/v1",
          environment: "production",
          releaseVersion: "0.3.3",
        },
      },
    },
  },
}));

import { readRuntimeConfig } from "../src/runtime-config";

test("normalizes an omitted production badge from the embedded manifest", () => {
  expect(readRuntimeConfig()).toEqual({
    apiBasePath: "/api/v1",
    environment: "production",
    environmentBadge: null,
    releaseVersion: "0.3.3",
  });
});
