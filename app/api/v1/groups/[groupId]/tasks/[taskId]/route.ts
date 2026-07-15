import { handleV1TasksRequest } from "@/server/v1-runtime";

export function GET(request: Request) {
  return handleV1TasksRequest(request);
}
