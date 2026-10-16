import { handleV1PersonalAgentGrantsRequest } from "@/server/v1-runtime";

export function GET(request: Request) { return handleV1PersonalAgentGrantsRequest(request); }
export function POST(request: Request) { return handleV1PersonalAgentGrantsRequest(request); }
