type LegacyBoardDependencies = {
  listTasks: () => Promise<unknown[]>;
};

const NO_STORE = { "cache-control": "no-store" };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function createLegacyBoardApi({
  listTasks,
}: LegacyBoardDependencies) {
  return Object.freeze({
    async fetch(request: Request) {
      if (request.method !== "GET") {
        return Response.json(
          {
            error: {
              code: "legacy_read_only",
              message: "The legacy board is read-only.",
            },
          },
          { headers: NO_STORE, status: 410 },
        );
      }

      try {
        return Response.json(
          { tasks: await listTasks() },
          { headers: NO_STORE },
        );
      } catch (error) {
        return Response.json(
          { error: errorMessage(error) },
          { headers: NO_STORE, status: 500 },
        );
      }
    },
  });
}
