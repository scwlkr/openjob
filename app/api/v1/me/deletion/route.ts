import { handleV1AccountDeletionRequest } from "@/server/v1-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleV1AccountDeletionRequest(request);
}

export async function POST(request: Request) {
  return handleV1AccountDeletionRequest(request);
}

export async function PATCH(request: Request) {
  return handleV1AccountDeletionRequest(request);
}

export async function PUT(request: Request) {
  return handleV1AccountDeletionRequest(request);
}
