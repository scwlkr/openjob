import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreStore } from "../db/firestore.ts";

async function createPrivateKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const base64 = Buffer.from(pkcs8).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function taskDocument(id, values) {
  return {
    name: `projects/openjob-dev/databases/(default)/documents/tasks/${id}`,
    fields: {
      assignee: { stringValue: values.assignee },
      description: { stringValue: values.description },
      ...(values.dueDate ? { dueDate: { stringValue: values.dueDate } } : {}),
      completed: { booleanValue: values.completed },
      createdAt: { timestampValue: values.createdAt },
      updatedAt: { timestampValue: values.updatedAt },
    },
  };
}

test("uses one service token for Firestore task reads and writes", async () => {
  const calls = [];
  let createdDocument;
  const fetchMock = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });

    if (url.hostname === "oauth2.googleapis.com") {
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }

    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-token");
    if (!init.method || init.method === "GET") {
      return Response.json({
        documents: [
          taskDocument("done", {
            assignee: "sam",
            description: "Done",
            dueDate: "2026-07-01",
            completed: true,
            createdAt: "2026-07-01T12:00:00.000Z",
            updatedAt: "2026-07-01T12:00:00.000Z",
          }),
          taskDocument("open", {
            assignee: "shane",
            description: "Open",
            dueDate: null,
            completed: false,
            createdAt: "2026-07-02T12:00:00.000Z",
            updatedAt: "2026-07-02T12:00:00.000Z",
          }),
          taskDocument("due", {
            assignee: "eli",
            description: "Due",
            dueDate: "2026-07-03",
            completed: false,
            createdAt: "2026-07-03T12:00:00.000Z",
            updatedAt: "2026-07-03T12:00:00.000Z",
          }),
        ],
      });
    }

    if (init.method === "POST") {
      const id = url.searchParams.get("documentId");
      createdDocument = {
        name: `projects/openjob-dev/databases/(default)/documents/tasks/${id}`,
        ...JSON.parse(init.body),
      };
      return Response.json(createdDocument);
    }

    if (url.pathname.endsWith("/missing")) {
      return Response.json({ error: { message: "missing" } }, { status: 404 });
    }

    const update = JSON.parse(init.body);
    createdDocument.fields = { ...createdDocument.fields, ...update.fields };
    return Response.json(createdDocument);
  };

  const store = createFirestoreStore(
    {
      projectId: "openjob-dev",
      clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
      privateKey: await createPrivateKey(),
    },
    fetchMock,
  );

  const listed = await store.listTasks();
  assert.deepEqual(listed.map((task) => task.id), ["due", "open", "done"]);

  const created = await store.createTask({
    assignee: "shane",
    description: "Ship Openjob",
    dueDate: null,
  });
  assert.equal(created.description, "Ship Openjob");

  const updated = await store.setTaskCompleted(created.id, true);
  assert.equal(updated.completed, true);
  assert.equal(await store.setTaskCompleted("missing", true), null);
  assert.equal(calls.filter(({ url }) => url.hostname === "oauth2.googleapis.com").length, 1);
});
