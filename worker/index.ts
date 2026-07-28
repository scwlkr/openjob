/** Cloudflare Worker entry point for Openjob. */
import appRouter from "vinext/server/app-router-entry";
import { GET as releaseMetadata } from "../app/api/version/route.ts";
import { retryPendingAccountDeletions } from "../server/v1-runtime.ts";

const worker = {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/version") {
      return releaseMetadata();
    }
    return appRouter.fetch(request, env, ctx);
  },
  scheduled(
    _controller: ScheduledController,
    _env: CloudflareEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(retryPendingAccountDeletions());
  },
};

export default worker;
