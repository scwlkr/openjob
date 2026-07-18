import { OPENJOB_GIT_COMMIT, OPENJOB_VERSION } from "../../release.ts";

export function GET() {
  return Response.json(
    { version: OPENJOB_VERSION, commit: OPENJOB_GIT_COMMIT },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
