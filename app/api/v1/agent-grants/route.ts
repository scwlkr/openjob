import { handleV1AgentGrantsRequest } from "@/server/v1-runtime";

export function GET(request: Request) {
  return handleV1AgentGrantsRequest(request);
}

export function POST(request: Request) {
  return handleV1AgentGrantsRequest(request);
}
