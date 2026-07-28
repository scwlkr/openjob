import { handleV1AccountDeletionRequest } from "@/server/v1-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleV1AccountDeletionRequest(request);
}
