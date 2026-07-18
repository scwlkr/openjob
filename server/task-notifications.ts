import type { StoredNotificationSubscription } from "../db/notification-subscriptions.ts";
import type { GroupId, OpenJobGroup } from "./v1-groups.ts";
import type { TaskId, TaskNotificationIntent } from "./v1-tasks.ts";

export type TaskPushMessage = {
  data: {
    recipientUserId: string;
    eventKind: "assignment" | "completion";
    groupId: GroupId;
    groupName: string;
    taskId: TaskId;
    taskPreview: string;
    launchTarget: string;
  };
  ttl: 86_400;
};

type TaskNotificationDispatcherOptions = {
  groups: {
    get(userId: string, groupId: GroupId): Promise<OpenJobGroup | null>;
  };
  subscriptions: {
    listActive(userId: string): Promise<StoredNotificationSubscription[]>;
    remove(
      installationId: string,
      userId: string,
    ): Promise<boolean | void>;
  };
  push: {
    send(
      subscription: StoredNotificationSubscription,
      message: TaskPushMessage,
    ): Promise<{ status: number }>;
  };
  reportFailure?(failure: {
    eventKind: "assignment" | "completion";
    permanent: boolean;
    status: number | null;
  }): void;
};

function taskPreview(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return characters.length <= 160
    ? normalized
    : `${characters.slice(0, 159).join("")}…`;
}

function isPermanentRejection(status: number) {
  return status === 404 || status === 410;
}

export function createTaskNotificationDispatcher({
  groups,
  subscriptions,
  push,
  reportFailure = () => undefined,
}: TaskNotificationDispatcherOptions) {
  return Object.freeze({
    async dispatch(intent: TaskNotificationIntent) {
      await Promise.all(intent.recipientUserIds.map(async (recipientUserId) => {
        const group = await groups.get(recipientUserId, intent.groupId);
        if (!group) return;
        const installations = await subscriptions.listActive(recipientUserId);
        const message: TaskPushMessage = {
          data: {
            recipientUserId,
            eventKind: intent.eventKind,
            groupId: intent.groupId,
            groupName: group.name,
            taskId: intent.taskId,
            taskPreview: taskPreview(intent.taskText),
            launchTarget:
              `/?notification-group=${encodeURIComponent(intent.groupId)}`,
          },
          ttl: 86_400,
        };

        await Promise.all(installations.map(async (subscription) => {
          try {
            const result = await push.send(subscription, message);
            if (result.status >= 200 && result.status < 300) return;
            const permanent = isPermanentRejection(result.status);
            reportFailure({
              eventKind: intent.eventKind,
              permanent,
              status: result.status,
            });
            if (permanent) {
              await subscriptions.remove(
                subscription.installationId,
                subscription.userId,
              );
            }
          } catch {
            reportFailure({
              eventKind: intent.eventKind,
              permanent: false,
              status: null,
            });
          }
        }));
      }));
    },
  });
}
