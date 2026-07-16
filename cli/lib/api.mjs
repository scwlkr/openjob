import { refreshIdToken } from "./auth.mjs";
import { CliError } from "./errors.mjs";

const DEFAULT_API_URL = "https://openjob.dev/api/v1";

export function apiBaseUrl(environment = process.env) {
  const raw = environment.OPENJOB_API_URL || DEFAULT_API_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError("config_invalid", "OPENJOB_API_URL must be a valid URL.", 2);
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new CliError(
      "config_invalid",
      "OPENJOB_API_URL must use HTTPS unless it targets localhost or loopback.",
      2,
    );
  }
  return raw.replace(/\/$/, "");
}

export async function apiRequest(
  path,
  init = {},
  options = {},
  environment = process.env,
) {
  return createApiClient(environment).request(path, init, options);
}

export async function apiRequestWithIdToken(
  path,
  init = {},
  idToken,
  environment = process.env,
) {
  return createApiClient(environment, idToken).request(path, init);
}

export async function apiCollection(path, options = {}, environment = process.env) {
  return createApiClient(environment).collection(path, options);
}

export function createApiClient(environment = process.env, initialIdToken) {
  let idToken = initialIdToken;

  async function request(path, init = {}, { retryable = false, quiet = false } = {}) {
    idToken ??= await refreshIdToken(environment);
    let authenticationReplayed = false;
    let serviceReplayed = false;
    while (true) {
      let response;
      try {
        response = await send(path, init, idToken, environment);
      } catch (error) {
        if (!retryable || serviceReplayed) throw error;
        serviceReplayed = true;
        await retryNotice(quiet, environment);
        continue;
      }
      if (response.status === 401 && !authenticationReplayed) {
        authenticationReplayed = true;
        idToken = await refreshIdToken(environment);
        continue;
      }
      if (
        retryable &&
        !serviceReplayed &&
        (response.status === 429 || response.status >= 500)
      ) {
        serviceReplayed = true;
        await retryNotice(quiet, environment);
        continue;
      }
      if (!response.ok) throw await apiError(response);
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new CliError("invalid_response", "OpenJob returned invalid JSON.", 8);
      }
    }
  }

  async function collection(path, { limit, quiet = false } = {}) {
    const data = [];
    const seen = new Set();
    let cursor = null;
    do {
      const [pathname, query = ""] = path.split("?", 2);
      const parameters = new URLSearchParams(query);
      if (cursor) parameters.set("cursor", cursor);
      if (limit !== undefined) {
        parameters.set("limit", String(Math.min(limit - data.length, 500)));
      }
      const requestPath = parameters.size ? `${pathname}?${parameters}` : pathname;
      const envelope = await request(requestPath, {}, { retryable: true, quiet });
      if (!Array.isArray(envelope?.data)) {
        throw new CliError("invalid_response", "OpenJob returned an invalid collection.", 8);
      }
      const remaining = limit === undefined ? envelope.data.length : limit - data.length;
      data.push(...envelope.data.slice(0, remaining));
      if (limit !== undefined && data.length >= limit) break;
      cursor = envelope.nextCursor;
      if (cursor !== null && typeof cursor !== "string") {
        throw new CliError("invalid_response", "OpenJob returned an invalid cursor.", 8);
      }
      if (cursor && seen.has(cursor)) {
        throw new CliError("invalid_response", "OpenJob returned a repeated cursor.", 8);
      }
      if (cursor) seen.add(cursor);
    } while (cursor);
    return { data, nextCursor: null };
  }

  return { collection, request };
}

async function retryNotice(quiet, environment) {
  if (!quiet) {
    process.stderr.write("Retrying safe request after a temporary service failure.\n");
  }
  const delay = environment.NODE_ENV === "test" ? 0 : 250;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function send(path, init, idToken, environment) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${idToken}`);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  try {
    return await fetch(`${apiBaseUrl(environment)}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new CliError("service_unavailable", "OpenJob could not reach the service.", 8);
  }
}

async function apiError(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {}
  const exitStatus = new Map([
    [400, 2],
    [401, 3],
    [403, 4],
    [404, 5],
    [409, 6],
    [429, 7],
  ]).get(response.status) ?? 8;
  const error = payload?.error;
  return new CliError(
    typeof error?.code === "string" ? error.code : "service_error",
    typeof error?.message === "string" ? error.message : "OpenJob request failed.",
    exitStatus,
    error?.fieldErrors,
    error && typeof error === "object" ? error : undefined,
  );
}
