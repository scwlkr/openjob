import { handleV1IdentityRequest } from "@/server/v1-runtime";

export function GET(request: Request) {
  return handleV1IdentityRequest(request);
}

export function POST(request: Request) {
  return handleV1IdentityRequest(request);
}
