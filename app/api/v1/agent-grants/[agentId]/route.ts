import { handleV1AgentGrantsRequest } from "@/server/v1-runtime";

export function DELETE(request: Request) {
  return handleV1AgentGrantsRequest(request);
}
