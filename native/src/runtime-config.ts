import Constants from "expo-constants";

export type OpenJobEnvironment = "development" | "preview" | "production";

export type OpenJobRuntimeConfig = {
  apiBasePath: "/api/v1";
  environment: OpenJobEnvironment;
  environmentBadge: "Development" | "Preview" | null;
  releaseVersion: string;
};

function isEnvironment(value: unknown): value is OpenJobEnvironment {
  return (
    value === "development" ||
    value === "preview" ||
    value === "production"
  );
}

export function readRuntimeConfig(): OpenJobRuntimeConfig {
  const openjob = Constants.expoConfig?.extra?.openjob;
  if (
    !openjob ||
    openjob.apiBasePath !== "/api/v1" ||
    !isEnvironment(openjob.environment) ||
    typeof openjob.releaseVersion !== "string"
  ) {
    throw new Error("OpenJob native configuration is incomplete.");
  }

  const expectedBadge =
    openjob.environment === "development"
      ? "Development"
      : openjob.environment === "preview"
        ? "Preview"
        : null;
  if (
    (expectedBadge === null && openjob.environmentBadge != null) ||
    (expectedBadge !== null && openjob.environmentBadge !== expectedBadge)
  ) {
    throw new Error("OpenJob native environment badge is inconsistent.");
  }

  return {
    apiBasePath: "/api/v1",
    environment: openjob.environment,
    environmentBadge: expectedBadge,
    releaseVersion: openjob.releaseVersion,
  };
}
