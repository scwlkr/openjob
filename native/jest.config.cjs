module.exports = {
  preset: "jest-expo",
  transform: { "^.+\\.mjs$": require("jest-expo/jest-preset").transform["\\.[jt]sx?$"] },
  modulePaths: ["<rootDir>/node_modules"],
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  testMatch: ["<rootDir>/test/**/*.test.ts?(x)"],
};
