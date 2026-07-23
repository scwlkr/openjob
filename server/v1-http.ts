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

export function readPagination(
  url: URL,
):
  | { error: "cursor" | "limit" }
  | { cursor: string | null; limit: number } {
  const cursors = url.searchParams.getAll("cursor");
  const limits = url.searchParams.getAll("limit");
  if (cursors.length > 1 || cursors[0] === "") {
    return { error: "cursor" };
  }
  if (
    limits.length > 1 ||
    (limits.length === 1 &&
      (!/^\d+$/.test(limits[0]) ||
        Number(limits[0]) < 1 ||
        Number(limits[0]) > 500))
  ) {
    return { error: "limit" };
  }
  return {
    cursor: cursors[0] ?? null,
    limit: limits.length === 0 ? 100 : Number(limits[0]),
  };
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

export function signInMethodUnrecognizedResponse(
  requestId: RequestIdFactory,
) {
  return errorResponse(requestId, {
    code: "sign_in_method_unrecognized",
    message: "Choose whether to create a new User or link an existing User.",
    status: 409,
  });
}
