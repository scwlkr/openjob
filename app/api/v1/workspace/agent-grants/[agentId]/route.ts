import { handleV1PersonalAgentGrantsRequest } from "@/server/v1-runtime";

export function DELETE(request: Request) { return handleV1PersonalAgentGrantsRequest(request); }
