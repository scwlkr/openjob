import assert from "node:assert/strict";

export async function createPrivateKey() {
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

export function createFakeFirestore({ projectId = "openjob-dev" } = {}) {
  const database = `projects/${projectId}/databases/(default)`;
  const documents = new Map();
  let revision = 0;
  let throttleNextRequest = false;
  let commitBarrier = null;
  let commitWaiters = [];
  let commitAttemptCount = 0;
  let preconditionFailureCount = 0;
  let maxCommitWrites = Number.POSITIVE_INFINITY;
  let pausedDocumentRead = null;

  function resolveCommitWaiters() {
    if (!commitBarrier) return;
    const queued = commitBarrier.queued.length;
    const pending = [];
    for (const waiter of commitWaiters) {
      if (queued >= waiter.count) waiter.resolve();
      else pending.push(waiter);
    }
    commitWaiters = pending;
  }

  function error(httpStatus, status, message) {
    return Response.json(
      { error: { code: httpStatus, message, status } },
      { status: httpStatus },
    );
  }

  function preconditionError(write, current) {
    const precondition = write.currentDocument;
    if (!precondition) return null;
    if (precondition.exists === false && current) {
      return "ALREADY_EXISTS";
    }
    if (precondition.exists === true && !current) {
      return "NOT_FOUND";
    }
    if (precondition.updateTime && current?.updateTime !== precondition.updateTime) {
      return current ? "FAILED_PRECONDITION" : "NOT_FOUND";
    }
    return null;
  }

  function applyCommit(body) {
    commitAttemptCount += 1;
    if (body.writes.length > maxCommitWrites) {
      return error(400, "INVALID_ARGUMENT", "Commit request is too large.");
    }
    const snapshot = new Map(documents);
    for (const write of body.writes) {
      const name = write.update?.name ?? write.delete ?? write.verify;
      const failure = preconditionError(write, snapshot.get(name));
      if (failure) {
        preconditionFailureCount += 1;
        return error(409, failure, "Commit precondition failed.");
      }
    }

    for (const write of body.writes) {
      if (write.delete) {
        documents.delete(write.delete);
        snapshot.delete(write.delete);
        continue;
      }
      if (!write.update) continue;
      const current = snapshot.get(write.update.name);
      const masked = write.updateMask?.fieldPaths;
      const fields = masked
        ? {
            ...(current?.fields ?? {}),
            ...Object.fromEntries(
              masked.map((field) => [field, write.update.fields[field]]),
            ),
          }
        : write.update.fields;
      revision += 1;
      const document = {
        name: write.update.name,
        fields,
        updateTime: `2026-07-15T12:00:00.${String(revision).padStart(6, "0")}Z`,
      };
      documents.set(write.update.name, document);
      snapshot.set(write.update.name, document);
    }
    return Response.json({ commitTime: "2026-07-15T12:00:00.999999Z" });
  }

  function listDocuments(path, url) {
    const prefix = `${database}/documents/${path}/`;
    const matching = [...documents.values()]
      .filter(
        ({ name }) =>
          name.startsWith(prefix) && !name.slice(prefix.length).includes("/"),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const pageSize = Number(url.searchParams.get("pageSize"));
    const token = url.searchParams.get("pageToken");
    let start = 0;
    if (token !== null) {
      const match = token.match(/^page_(\d+)$/);
      if (!match) return error(400, "INVALID_ARGUMENT", "Invalid page token.");
      start = Number(match[1]);
    }
    const page = matching.slice(start, start + pageSize);
    const next = start + page.length;
    return Response.json({
      documents: page,
      ...(next < matching.length ? { nextPageToken: `page_${next}` } : {}),
    });
  }

  return {
    documents,
    commitAttempts() {
      return commitAttemptCount;
    },
    preconditionFailures() {
      return preconditionFailureCount;
    },
    pauseNextDocumentRead(path) {
      if (typeof path !== "string" || path.length === 0 || pausedDocumentRead) {
        throw new TypeError("A document read pause requires one unused path.");
      }
      let notifyPaused;
      let releaseRead;
      const paused = new Promise((resolve) => {
        notifyPaused = resolve;
      });
      const released = new Promise((resolve) => {
        releaseRead = resolve;
      });
      pausedDocumentRead = { path, notifyPaused, released };
      return {
        release() {
          releaseRead();
        },
        waitUntilPaused() {
          return paused;
        },
      };
    },
    setMaxCommitWrites(maximum) {
      if (!Number.isInteger(maximum) || maximum < 1) {
        throw new TypeError("The maximum Commit write count must be positive.");
      }
      maxCommitWrites = maximum;
    },
    synchronizeNextCommits(count = 2) {
      if (!Number.isInteger(count) || count < 2 || commitBarrier) {
        throw new TypeError("Commit synchronization requires an unused count of at least 2.");
      }
      commitBarrier = { count, queued: [] };
    },
    waitForPendingCommits(count = 1) {
      if (
        !commitBarrier ||
        !Number.isInteger(count) ||
        count < 1 ||
        count >= commitBarrier.count
      ) {
        throw new TypeError(
          "Pending commit waits require an active barrier and a count below its target.",
        );
      }
      if (commitBarrier.queued.length >= count) return Promise.resolve();
      return new Promise((resolve) => commitWaiters.push({ count, resolve }));
    },
    throttleNextRequest() {
      throttleNextRequest = true;
    },
    async fetch(input, init = {}) {
      const url = new URL(input);
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({
          access_token: "test-service-access",
          expires_in: 3600,
        });
      }

      assert.equal(
        new Headers(init.headers).get("authorization"),
        "Bearer test-service-access",
      );
      if (throttleNextRequest) {
        throttleNextRequest = false;
        return error(429, "RESOURCE_EXHAUSTED", "Firestore rate limited.");
      }
      if (url.pathname.endsWith("/documents:commit")) {
        const body = JSON.parse(init.body);
        if (commitBarrier) {
          const barrier = commitBarrier;
          return new Promise((resolve) => {
            barrier.queued.push({ body, resolve });
            resolveCommitWaiters();
            if (barrier.queued.length === barrier.count) {
              commitBarrier = null;
              for (const queued of barrier.queued) {
                queued.resolve(applyCommit(queued.body));
              }
            }
          });
        }
        return applyCommit(body);
      }

      const marker = "/documents/";
      const path = decodeURIComponent(
        url.pathname.slice(url.pathname.indexOf(marker) + marker.length),
      );
      if (pausedDocumentRead?.path === path) {
        const paused = pausedDocumentRead;
        pausedDocumentRead = null;
        paused.notifyPaused();
        await paused.released;
      }
      if (
        path
          .split("/")
          .some((segment) => Buffer.byteLength(segment, "utf8") > 1_500)
      ) {
        return error(400, "INVALID_ARGUMENT", "Document ID is too long.");
      }
      if (url.searchParams.has("pageSize")) {
        return listDocuments(path, url);
      }

      const document = documents.get(`${database}/documents/${path}`);
      return document
        ? Response.json(document)
        : Response.json(
            { error: { status: "NOT_FOUND" } },
            { status: 404 },
          );
    },
  };
}
