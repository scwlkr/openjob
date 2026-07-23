import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createFirestoreRestClient } from "../db/firestore-rest.ts";

const manifest = JSON.parse(
  await readFile(new URL("../config/qa-fixture.json", import.meta.url), "utf8"),
);

const FIXED_CREATED_AT = "2026-07-23T00:00:00.000Z";
const FIXED_COMPLETED_AT = "2026-07-23T01:00:00.000Z";
const MAX_FIXTURE_WRITES = 100;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stable(entry)]),
  );
}

function fieldsEqual(left, right) {
  return JSON.stringify(stable(left ?? {})) === JSON.stringify(stable(right));
}

function documentId(document) {
  return document.name.slice(document.name.lastIndexOf("/") + 1);
}

function updateWrite(store, path, fields, existing) {
  return {
    update: {
      name: store.documentName(path),
      fields,
    },
    currentDocument: existing
      ? { updateTime: existing.updateTime }
      : { exists: false },
  };
}

function dateWithOffset(now, offsetDays) {
  if (offsetDays === null) return null;
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function fixtureEnvironment(environment) {
  const fixture = manifest.environments[environment];
  if (!fixture) {
    throw new Error(`QA fixture environment is not allowed: ${environment}.`);
  }
  return fixture;
}

function assertUserId(value, label) {
  if (typeof value !== "string" || !/^user_[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be an explicit stable OpenJob User ID.`);
  }
}

function assertExactField(document, field, expected, message) {
  if (document?.fields?.[field]?.stringValue !== expected) {
    throw new Error(message);
  }
}

function fixtureMarkerFields(fixture, environment) {
  return {
    environment: { stringValue: environment },
    firebaseProjectId: { stringValue: fixture.firebaseProjectId },
    fixtureId: { stringValue: manifest.fixtureId },
    groupId: { stringValue: fixture.groupId },
    schemaVersion: { integerValue: String(manifest.schemaVersion) },
  };
}

function desiredTaskFields({
  fixture,
  now,
  qaOneUserId,
  qaTwoUserId,
  task,
}) {
  const user = task.assignee === "qaOne"
    ? { ...manifest.users.qaOne, userId: qaOneUserId }
    : task.assignee === "qaTwo"
      ? { ...manifest.users.qaTwo, userId: qaTwoUserId }
      : null;
  const dueDate = dateWithOffset(now(), task.dueOffsetDays);
  return {
    taskId: { stringValue: task.taskId },
    groupId: { stringValue: fixture.groupId },
    text: { stringValue: task.text },
    assigneeState: { stringValue: user ? "assigned" : "unassigned" },
    ...(user
      ? {
          assigneeMembershipId: { stringValue: user.membershipId },
          assigneeUserId: { stringValue: user.userId },
          assigneeUsername: { stringValue: user.username },
        }
      : {}),
    creatorUserId: {
      stringValue: task.assignee === "qaTwo" ? qaOneUserId : qaTwoUserId,
    },
    priority: { stringValue: task.priority },
    ...(dueDate ? { dueDate: { stringValue: dueDate } } : {}),
    state: { stringValue: task.state },
    createdAt: { timestampValue: FIXED_CREATED_AT },
    ...(task.state === "done"
      ? { completedAt: { timestampValue: FIXED_COMPLETED_AT } }
      : {}),
  };
}

export function createQaFixtureStore(config, fetchImplementation = fetch) {
  const firestore = createFirestoreRestClient(config, fetchImplementation);

  return Object.freeze({
    projectId: config.projectId,
    documentName: firestore.documentName,
    async readDocument(path) {
      const response = await firestore.request(
        path,
        {},
        { allowNotFound: true },
      );
      return response.status === 404 ? null : response.json();
    },
    async listDocuments(path) {
      const documents = [];
      let pageToken = null;
      do {
        const parameters = new URLSearchParams({
          pageSize: "500",
          orderBy: "__name__",
        });
        if (pageToken !== null) parameters.set("pageToken", pageToken);
        const response = await firestore.request(`${path}?${parameters}`);
        const page = await response.json();
        documents.push(...(page.documents ?? []));
        pageToken = page.nextPageToken ?? null;
      } while (pageToken !== null);
      return documents;
    },
    async commit(writes) {
      await firestore.request(":commit", {
        method: "POST",
        body: JSON.stringify({ writes }),
      });
    },
  });
}

export async function resetQaFixture({
  confirmation,
  environment,
  now = Date.now,
  qaOneUserId,
  qaTwoUserId,
  store,
}) {
  const fixture = fixtureEnvironment(environment);
  if (store.projectId !== fixture.firebaseProjectId) {
    throw new Error("QA fixture Firebase project does not match the environment.");
  }
  if (confirmation !== fixture.confirmation) {
    throw new Error("QA fixture confirmation does not match the selected target.");
  }
  assertUserId(qaOneUserId, "@qa-one");
  assertUserId(qaTwoUserId, "@qa-two");
  if (qaOneUserId === qaTwoUserId) {
    throw new Error("QA fixture Users must have distinct stable User IDs.");
  }

  const users = [
    {
      key: "qaOne",
      userId: qaOneUserId,
      ...manifest.users.qaOne,
    },
    {
      key: "qaTwo",
      userId: qaTwoUserId,
      ...manifest.users.qaTwo,
    },
  ];
  for (const user of users) {
    const [directory, claim] = await Promise.all([
      store.readDocument(`v1UserDirectory/${user.userId}`),
      store.readDocument(`v1Usernames/${user.username}`),
    ]);
    assertExactField(
      directory,
      "userId",
      user.userId,
      `@${user.username} does not resolve to the expected stable User ID.`,
    );
    assertExactField(
      directory,
      "username",
      user.username,
      `@${user.username} is not the expected immutable Username.`,
    );
    assertExactField(
      claim,
      "userId",
      user.userId,
      `@${user.username} has an inconsistent Username claim.`,
    );
  }

  const fixturePath = `v1QaFixtures/${manifest.fixtureId}`;
  const groupPath = `v1Groups/${fixture.groupId}`;
  const reservationPath = `v1GroupIds/${fixture.groupId}`;
  const [
    fixtureDocument,
    group,
    reservation,
    members,
    evidence,
    tasks,
    bans,
    qaOneAccess,
    qaTwoAccess,
    notificationSubscriptions,
    qaOneInstallations,
    qaTwoInstallations,
  ] = await Promise.all([
    store.readDocument(fixturePath),
    store.readDocument(groupPath),
    store.readDocument(reservationPath),
    store.listDocuments(`${groupPath}/members`),
    store.listDocuments(`${groupPath}/membershipEvidence`),
    store.listDocuments(`${groupPath}/tasks`),
    store.listDocuments(`${groupPath}/bans`),
    store.listDocuments(`v1GroupAccess/${qaOneUserId}/groups`),
    store.listDocuments(`v1GroupAccess/${qaTwoUserId}/groups`),
    store.listDocuments("v1NotificationSubscriptions"),
    store.listDocuments(
      `v1NotificationSubscriptionUsers/${qaOneUserId}/installations`,
    ),
    store.listDocuments(
      `v1NotificationSubscriptionUsers/${qaTwoUserId}/installations`,
    ),
  ]);

  const marker = fixtureMarkerFields(fixture, environment);
  for (const [document, label] of [
    [fixtureDocument, "fixture registry"],
    [group, "Group"],
    [reservation, "Group ID reservation"],
  ]) {
    if (!document) continue;
    for (const [field, expected] of Object.entries(marker)) {
      const kind = "stringValue" in expected ? "stringValue" : "integerValue";
      if (document.fields?.[field]?.[kind] !== expected[kind]) {
        throw new Error(`QA fixture ${label} identity does not match.`);
      }
    }
  }
  if (!group && reservation && !fixtureDocument) {
    throw new Error("QA fixture Group ID is reserved by an unknown identity.");
  }

  const expectedUserIds = new Set(users.map(({ userId }) => userId));
  for (const [documents, label] of [
    [members, "membership"],
    [evidence, "membership evidence"],
  ]) {
    for (const document of documents) {
      const expectedUserId = documentId(document);
      if (!expectedUserIds.has(expectedUserId)) {
        throw new Error("QA fixture Group contains an unexpected User.");
      }
      if (document.fields?.userId?.stringValue !== expectedUserId) {
        throw new Error(
          `QA fixture ${label} belongs to an unexpected User.`,
        );
      }
    }
  }
  for (const document of bans) {
    const expectedUserId = documentId(document);
    if (!expectedUserIds.has(expectedUserId)) {
      throw new Error("QA fixture Group contains an unexpected User.");
    }
    if (document.fields?.userId?.stringValue !== expectedUserId) {
      throw new Error("QA fixture Ban belongs to an unexpected User.");
    }
  }
  for (const accessDocuments of [qaOneAccess, qaTwoAccess]) {
    for (const document of accessDocuments) {
      if (documentId(document) !== fixture.groupId) {
        throw new Error("A QA fixture User belongs to a non-QA Group.");
      }
      if (document.fields?.groupId?.stringValue !== fixture.groupId) {
        throw new Error(
          "A QA fixture access record points to an unexpected Group.",
        );
      }
    }
  }

  const subscriptionsByInstallationId = new Map(
    notificationSubscriptions.map((document) => [documentId(document), document]),
  );
  const notificationDocumentsToDelete = new Map();
  for (const document of notificationSubscriptions) {
    const userId = document.fields?.userId?.stringValue;
    if (!expectedUserIds.has(userId)) continue;
    if (document.fields?.installationId?.stringValue !== documentId(document)) {
      throw new Error("A QA fixture notification installation is malformed.");
    }
    notificationDocumentsToDelete.set(document.name, document);
  }
  for (const [userId, installations] of [
    [qaOneUserId, qaOneInstallations],
    [qaTwoUserId, qaTwoInstallations],
  ]) {
    for (const document of installations) {
      const installationId = documentId(document);
      if (
        document.fields?.installationId?.stringValue !== installationId ||
        document.fields?.userId?.stringValue !== userId
      ) {
        throw new Error("A QA fixture notification index is malformed.");
      }
      const subscription = subscriptionsByInstallationId.get(installationId);
      if (
        subscription &&
        subscription.fields?.userId?.stringValue !== userId
      ) {
        throw new Error(
          "A QA fixture notification index points to another User.",
        );
      }
      notificationDocumentsToDelete.set(document.name, document);
      if (subscription) {
        notificationDocumentsToDelete.set(subscription.name, subscription);
      }
    }
  }

  const existingByPath = new Map(
    [
      fixtureDocument,
      group,
      reservation,
      ...members,
      ...evidence,
      ...tasks,
      ...qaOneAccess,
      ...qaTwoAccess,
    ]
      .filter(Boolean)
      .map((document) => [
        document.name.slice(document.name.indexOf("/documents/") + 11),
        document,
      ]),
  );
  const desired = new Map();
  desired.set(fixturePath, marker);
  desired.set(reservationPath, marker);

  const currentRevision = Number(group?.fields?.stateRevision?.integerValue ?? 0);
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
    throw new Error("QA fixture Group has an invalid state revision.");
  }
  desired.set(groupPath, {
    groupId: { stringValue: fixture.groupId },
    name: { stringValue: fixture.groupName },
    createdAt: { timestampValue: FIXED_CREATED_AT },
    stateRevision: { integerValue: String(currentRevision) },
    ...marker,
  });
  for (const user of users) {
    desired.set(`${groupPath}/members/${user.userId}`, {
      userId: { stringValue: user.userId },
      username: { stringValue: user.username },
      membershipId: { stringValue: user.membershipId },
      role: { stringValue: user.role },
      joinedAt: { timestampValue: FIXED_CREATED_AT },
      fixtureId: { stringValue: manifest.fixtureId },
    });
    desired.set(`${groupPath}/membershipEvidence/${user.userId}`, {
      userId: { stringValue: user.userId },
      username: { stringValue: user.username },
      fixtureId: { stringValue: manifest.fixtureId },
    });
    desired.set(`v1GroupAccess/${user.userId}/groups/${fixture.groupId}`, {
      groupId: { stringValue: fixture.groupId },
      fixtureId: { stringValue: manifest.fixtureId },
    });
  }
  for (const task of manifest.tasks) {
    desired.set(
      `${groupPath}/tasks/${task.taskId}`,
      desiredTaskFields({
        fixture,
        now,
        qaOneUserId,
        qaTwoUserId,
        task,
      }),
    );
  }

  const extraTaskDocuments = tasks.filter(
    (document) =>
      !desired.has(
        document.name.slice(document.name.indexOf("/documents/") + 11),
      ),
  );
  const hasChanges =
    extraTaskDocuments.length > 0 ||
    bans.length > 0 ||
    notificationDocumentsToDelete.size > 0 ||
    [...desired].some(
      ([path, fields]) => !fieldsEqual(existingByPath.get(path)?.fields, fields),
    );
  if (!hasChanges) {
    return {
      changed: false,
      environment,
      fixtureId: manifest.fixtureId,
      groupId: fixture.groupId,
      taskCount: manifest.tasks.length,
      writes: 0,
    };
  }
  if (group) {
    desired.get(groupPath).stateRevision = {
      integerValue: String(currentRevision + 1),
    };
  }

  const writes = [...desired].flatMap(([path, fields]) => {
    const existing = existingByPath.get(path);
    return fieldsEqual(existing?.fields, fields)
      ? []
      : [updateWrite(store, path, fields, existing)];
  });
  for (const document of [
    ...extraTaskDocuments,
    ...bans,
    ...notificationDocumentsToDelete.values(),
  ]) {
    writes.push({
      delete: document.name,
      currentDocument: { updateTime: document.updateTime },
    });
  }
  if (writes.length > MAX_FIXTURE_WRITES) {
    throw new Error("QA fixture write plan exceeds the narrow safety limit.");
  }
  await store.commit(writes);
  return {
    changed: true,
    environment,
    fixtureId: manifest.fixtureId,
    groupId: fixture.groupId,
    taskCount: manifest.tasks.length,
    writes: writes.length,
  };
}

const CLI_USAGE = `Usage:
  npm run qa:fixture:reset -- \\
    --environment preview \\
    --confirm openjob-two-user-qa-v1:openjob-nonprod:grp_qa_two_user_preview_v1

Required environment bindings:
  FIREBASE_PROJECT_ID
  FIREBASE_CLIENT_EMAIL
  FIREBASE_PRIVATE_KEY
  OPENJOB_QA_ONE_USER_ID
  OPENJOB_QA_TWO_USER_ID
`;

function requiredBinding(env, name) {
  const value = env[name];
  if (!value) throw new Error(`The ${name} binding is unavailable.`);
  return value;
}

function parseCliArguments(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    return { help: true };
  }
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !["--environment", "--confirm"].includes(name) ||
      typeof value !== "string" ||
      value.length === 0
    ) {
      throw new Error("Use --help to see the exact QA fixture reset command.");
    }
    if (options[name]) {
      throw new Error(`The ${name} option may be provided only once.`);
    }
    options[name] = value;
  }
  if (!options["--environment"] || !options["--confirm"]) {
    throw new Error("Both --environment and --confirm are required.");
  }
  return {
    help: false,
    confirmation: options["--confirm"],
    environment: options["--environment"],
  };
}

export async function runQaFixtureResetCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
} = {}) {
  const options = parseCliArguments(argv);
  if (options.help) {
    stdout.write(CLI_USAGE);
    return 0;
  }
  const config = {
    projectId: requiredBinding(env, "FIREBASE_PROJECT_ID"),
    clientEmail: requiredBinding(env, "FIREBASE_CLIENT_EMAIL"),
    privateKey: requiredBinding(env, "FIREBASE_PRIVATE_KEY").replaceAll(
      "\\n",
      "\n",
    ),
  };
  const result = await resetQaFixture({
    confirmation: options.confirmation,
    environment: options.environment,
    qaOneUserId: requiredBinding(env, "OPENJOB_QA_ONE_USER_ID"),
    qaTwoUserId: requiredBinding(env, "OPENJOB_QA_TWO_USER_ID"),
    store: createQaFixtureStore(config),
  });
  stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await runQaFixtureResetCli();
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown QA fixture reset failure.";
    process.stderr.write(`QA fixture reset blocked: ${message}\n`);
    process.exitCode = 1;
  }
}
