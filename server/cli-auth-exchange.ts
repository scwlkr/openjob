import {
  defaultRequestId,
  errorResponse,
  internalErrorResponse,
  jsonResponse,
  type RequestIdFactory,
} from "./v1-http.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type ExchangeInput = {
  code: string;
  codeVerifier: string;
  redirectUri: string;
};

type ExchangeOptions = {
  clientId: string;
  clientSecret: string;
  fetchImplementation?: typeof fetch;
  requestId?: RequestIdFactory;
};

function validLoopbackRedirect(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const redirect = new URL(value);
    return (
      redirect.protocol === "http:" &&
      redirect.hostname === "127.0.0.1" &&
      redirect.port !== "" &&
      redirect.pathname === "/callback" &&
      redirect.search === "" &&
      redirect.hash === "" &&
      redirect.username === "" &&
      redirect.password === ""
    );
  } catch {
    return false;
  }
}

async function readExchangeInput(request: Request): Promise<ExchangeInput | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return null;
  }
  const text = await request.text();
  if (text.length > 16_384) return null;
  try {
    const input = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof input.code !== "string" ||
      input.code.length < 1 ||
      input.code.length > 4_096 ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(String(input.codeVerifier)) ||
      !validLoopbackRedirect(input.redirectUri)
    ) {
      return null;
    }
    return {
      code: input.code,
      codeVerifier: String(input.codeVerifier),
      redirectUri: String(input.redirectUri),
    };
  } catch {
    return null;
  }
}

function invalidRequest(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "invalid_request",
    message: "The CLI sign-in exchange is invalid.",
    status: 400,
  });
}

function rejectedExchange(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "auth_failed",
    message: "Google sign-in was rejected.",
    status: 400,
  });
}

function unavailableExchange(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "service_unavailable",
    message: "Sign-in is temporarily unavailable.",
    status: 503,
  });
}

function rateLimitedExchange(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "rate_limited",
    message: "Try again later.",
    status: 429,
  });
}

export function createCliAuthExchangeHandler({
  clientId,
  clientSecret,
  fetchImplementation = fetch,
  requestId = defaultRequestId,
}: ExchangeOptions) {
  if (!clientId || !clientSecret) {
    throw new Error("The Google OAuth bindings are unavailable.");
  }

  return async function handleCliAuthExchange(request: Request) {
    try {
      const input = await readExchangeInput(request);
      if (!input) return invalidRequest(requestId);

      let providerResponse: Response;
      try {
        providerResponse = await fetchImplementation(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: input.code,
            code_verifier: input.codeVerifier,
            grant_type: "authorization_code",
            redirect_uri: input.redirectUri,
          }),
        });
      } catch {
        return unavailableExchange(requestId);
      }

      if (providerResponse.status === 429) return rateLimitedExchange(requestId);
      if (providerResponse.status >= 500) return unavailableExchange(requestId);

      let payload: unknown;
      try {
        payload = await providerResponse.json();
      } catch {
        return rejectedExchange(requestId);
      }
      if (
        !providerResponse.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("id_token" in payload) ||
        typeof payload.id_token !== "string"
      ) {
        return rejectedExchange(requestId);
      }
      return jsonResponse({ data: { idToken: payload.id_token } });
    } catch {
      return internalErrorResponse(requestId);
    }
  };
}

export function createCliAuthExchangeRuntimeHandler(
  bindings: () => { clientId: string; clientSecret: string },
  requestId: RequestIdFactory = defaultRequestId,
) {
  return async function handleCliAuthExchange(request: Request) {
    try {
      return await createCliAuthExchangeHandler({
        ...bindings(),
        requestId,
      })(request);
    } catch {
      return internalErrorResponse(requestId);
    }
  };
}
