import { handleV1IdentityRequest } from "@/server/v1-runtime";

export function PUT(request: Request) {
  return handleV1IdentityRequest(request);
}
