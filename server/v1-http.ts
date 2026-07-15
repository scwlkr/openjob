export type RequestIdFactory = () => string;

export function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function defaultRequestId() {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function errorResponse(
  requestId: RequestIdFactory,
  {
    code,
    fields,
    message,
    status,
  }: {
    code: string;
    fields?: Record<string, string>;
    message: string;
    status: number;
  },
) {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(fields ? { fields } : {}),
        requestId: requestId(),
      },
    },
    status,
  );
}

export function internalErrorResponse(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "internal_error",
    message: "An unexpected error occurred.",
    status: 500,
  });
}

export function isRateLimitError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (("httpStatus" in error && error.httpStatus === 429) ||
      ("code" in error && error.code === "RESOURCE_EXHAUSTED"))
  );
}

export function rateLimitedErrorResponse(requestId: RequestIdFactory) {
  return errorResponse(requestId, {
    code: "rate_limited",
    message: "Try again later.",
    status: 429,
  });
}
