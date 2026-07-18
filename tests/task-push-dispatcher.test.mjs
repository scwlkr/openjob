import assert from "node:assert/strict";
import test from "node:test";
import { createTaskNotificationDispatcher } from "../server/task-notifications.ts";

test("Task notification delivery filters membership and isolates installation failures", async () => {
  const sent = [];
  const removed = [];
  const failures = [];
  const subscriptions = [
    {
      installationId: "installation_active",
      userId: "user_eli",
      endpoint: "https://push.example.test/active",
      p256dh: "active-key",
      auth: "active-auth",
      state: "active",
    },
    {
      installationId: "installation_expired",
      userId: "user_eli",
      endpoint: "https://push.example.test/expired",
      p256dh: "expired-key",
      auth: "expired-auth",
      state: "active",
    },
    {
      installationId: "installation_transient",
      userId: "user_eli",
      endpoint: "https://push.example.test/transient",
      p256dh: "transient-key",
      auth: "transient-auth",
      state: "active",
    },
  ];
  const dispatcher = createTaskNotificationDispatcher({
    groups: {
      async get(userId) {
        return userId === "user_eli"
          ? { groupId: "grp_notifications", name: "Release Team" }
          : null;
      },
    },
    subscriptions: {
      async listActive(userId) {
        return userId === "user_eli" ? subscriptions : [];
      },
      async remove(installationId, userId) {
        removed.push({ installationId, userId });
      },
    },
    push: {
      async send(subscription, message) {
        sent.push({ subscription, message });
        if (subscription.installationId === "installation_expired") {
          return { status: 410 };
        }
        if (subscription.installationId === "installation_transient") {
          throw new Error("provider unavailable");
        }
        return { status: 201 };
      },
    },
    reportFailure(failure) {
      failures.push(failure);
    },
  });

  await dispatcher.dispatch({
    eventKind: "assignment",
    groupId: "grp_notifications",
    taskId: "task_release",
    taskText: `  Prepare\n\n   the release ${"x".repeat(180)}  `,
    recipientUserIds: ["user_eli", "user_former"],
  });

  assert.deepEqual(sent.map(({ subscription }) => subscription.installationId), [
    "installation_active",
    "installation_expired",
    "installation_transient",
  ]);
  assert.deepEqual(sent[0].message, {
    data: {
      recipientUserId: "user_eli",
      eventKind: "assignment",
      groupId: "grp_notifications",
      groupName: "Release Team",
      taskId: "task_release",
      taskPreview: `${"Prepare the release "}${"x".repeat(139)}…`,
      launchTarget: "/?notification-group=grp_notifications",
    },
    ttl: 86_400,
  });
  assert.deepEqual(removed, [{
    installationId: "installation_expired",
    userId: "user_eli",
  }]);
  assert.deepEqual(failures, [
    { eventKind: "assignment", permanent: true, status: 410 },
    { eventKind: "assignment", permanent: false, status: null },
  ]);
});
