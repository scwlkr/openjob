import { handleV1ProviderPreviewRequest } from "@/server/v1-runtime";

export function GET(request: Request) { return handleV1ProviderPreviewRequest(request); }
