import { handleV1TasksRequest } from "@/server/v1-runtime";

export function PUT(request: Request) {
  return handleV1TasksRequest(request);
}
