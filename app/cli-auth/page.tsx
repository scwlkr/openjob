import { CliAuthClient } from "./cli-auth-client";

type SearchValue = string | string[] | undefined;

function one(value: SearchValue) {
  return typeof value === "string" ? value : null;
}

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ callback?: SearchValue; state?: SearchValue }>;
}) {
  const parameters = await searchParams;
  return (
    <CliAuthClient
      callbackUrl={one(parameters.callback)}
      state={one(parameters.state)}
    />
  );
}
