/** Cloudflare Worker entry point for Openjob. */
import appRouter from "vinext/server/app-router-entry";
import { GET as releaseMetadata } from "../app/api/version/route.ts";

const worker = {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/version") {
      return releaseMetadata();
    }
    return appRouter.fetch(request, env, ctx);
  },
};

export default worker;
