import { handleV1PersonalWorkspaceRequest } from "@/server/v1-runtime";

export function GET(request: Request) { return handleV1PersonalWorkspaceRequest(request); }
export function POST(request: Request) { return handleV1PersonalWorkspaceRequest(request); }
