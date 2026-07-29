export type AccountDeletionOperatorTarget = {
  requestId: string;
  userId: string;
};

const MAXIMUM_TARGET_LENGTH = 1_024;
const MAXIMUM_IDENTIFIER_LENGTH = 256;

function validIdentifier(
  value: unknown,
  prefix: "del_" | "user_",
): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAXIMUM_IDENTIFIER_LENGTH &&
    new RegExp(`^${prefix}[A-Za-z0-9]+$`).test(value)
  );
}

export function parseAccountDeletionOperatorTarget(
  value: unknown,
): AccountDeletionOperatorTarget | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAXIMUM_TARGET_LENGTH
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const target = parsed as Record<string, unknown>;
    if (
      Object.keys(target).sort().join(",") !== "requestId,userId" ||
      !validIdentifier(target.requestId, "del_") ||
      !validIdentifier(target.userId, "user_")
    ) {
      return null;
    }
    return {
      requestId: target.requestId,
      userId: target.userId,
    };
  } catch {
    return null;
  }
}

export function prioritizeAccountDeletionJobs<
  Job extends AccountDeletionOperatorTarget,
>(jobs: readonly Job[], target: AccountDeletionOperatorTarget | null) {
  if (!target) return [...jobs];
  const prioritized: Job[] = [];
  const remaining: Job[] = [];
  for (const job of jobs) {
    (job.requestId === target.requestId && job.userId === target.userId
      ? prioritized
      : remaining).push(job);
  }
  return [...prioritized, ...remaining];
}
