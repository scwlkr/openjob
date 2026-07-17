import { env } from "cloudflare:workers";
import { GOOGLE_DESKTOP_CLIENT_ID } from "@/cli/lib/oauth-config.mjs";
import { createCliAuthExchangeRuntimeHandler } from "@/server/cli-auth-exchange";

type CliAuthBindings = {
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
};

const handleExchange = createCliAuthExchangeRuntimeHandler(() => {
  const bindings = env as CliAuthBindings;
  if (!bindings.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("The Google OAuth bindings are unavailable.");
  }
  return {
    clientId: GOOGLE_DESKTOP_CLIENT_ID,
    clientSecret: bindings.GOOGLE_OAUTH_CLIENT_SECRET,
  };
});

export function POST(request: Request) {
  return handleExchange(request);
}
