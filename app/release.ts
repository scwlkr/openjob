import packageMetadata from "../package.json" with { type: "json" };

declare const __OPENJOB_VERSION__: string;
declare const __OPENJOB_GIT_COMMIT__: string;

export const OPENJOB_VERSION =
  typeof __OPENJOB_VERSION__ === "string"
    ? __OPENJOB_VERSION__
    : packageMetadata.version;

export const OPENJOB_GIT_COMMIT =
  typeof __OPENJOB_GIT_COMMIT__ === "string"
    ? __OPENJOB_GIT_COMMIT__
    : typeof process !== "undefined"
      ? process.env.OPENJOB_GIT_COMMIT ?? "unknown"
      : "unknown";
