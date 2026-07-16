import { handleV1GroupsRequest } from "@/server/v1-runtime";

export function GET(request: Request) {
  return handleV1GroupsRequest(request);
}
