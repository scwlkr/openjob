import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAccountDeletionOperatorTarget,
  prioritizeAccountDeletionJobs,
} from "../server/account-deletion-operator.ts";

const TARGET = {
  requestId: "del_exact123",
  userId: "user_exact123",
};

test("operator targets parse only one exact bounded User and request pair", () => {
  assert.deepEqual(
    parseAccountDeletionOperatorTarget(JSON.stringify(TARGET)),
    TARGET,
  );
  for (const invalid of [
    undefined,
    "",
    "not-json",
    "[]",
    JSON.stringify({ ...TARGET, extra: true }),
    JSON.stringify({ requestId: "del_exact123" }),
    JSON.stringify({ ...TARGET, requestId: "wrong" }),
    JSON.stringify({ ...TARGET, userId: "user_bad/slash" }),
    JSON.stringify({ ...TARGET, userId: `user_${"a".repeat(252)}` }),
  ]) {
    assert.equal(parseAccountDeletionOperatorTarget(invalid), null);
  }
});

test("an exact operator target is prioritized without starving other jobs", () => {
  const jobs = [
    { requestId: "del_other", userId: "user_other" },
    TARGET,
    { requestId: "del_last", userId: "user_last" },
  ];
  assert.deepEqual(prioritizeAccountDeletionJobs(jobs, TARGET), [
    TARGET,
    jobs[0],
    jobs[2],
  ]);
  assert.deepEqual(
    prioritizeAccountDeletionJobs(jobs, {
      requestId: "del_missing",
      userId: "user_missing",
    }),
    jobs,
  );
  assert.deepEqual(prioritizeAccountDeletionJobs(jobs, null), jobs);
});
