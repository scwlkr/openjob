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
  let transactionSequence = 0;
  let mutateBeforeTransactionCommit = null;
  const transactions = new Map();

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

  function cloneDocuments(source) {
    return new Map(
      [...source].map(([name, document]) => [
        name,
        structuredClone(document),
      ]),
    );
  }

  function directCollectionDocuments(source, path) {
    const prefix = `${database}/documents/${path}/`;
    return [...source.values()]
      .filter(
        ({ name }) =>
          name.startsWith(prefix) && !name.slice(prefix.length).includes("/"),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function fingerprint(value) {
    return JSON.stringify(value ?? null);
  }

  function transactionHasChanged(transaction) {
    for (const name of transaction.documentReads) {
      if (
        fingerprint(documents.get(name)) !==
        fingerprint(transaction.snapshot.get(name))
      ) {
        return true;
      }
    }
    for (const path of transaction.collectionReads) {
      if (
        fingerprint(directCollectionDocuments(documents, path)) !==
        fingerprint(directCollectionDocuments(transaction.snapshot, path))
      ) {
        return true;
      }
    }
    return false;
  }

  function applyCommit(body) {
    commitAttemptCount += 1;
    const writes = body.writes ?? [];
    const transaction = body.transaction
      ? transactions.get(body.transaction)
      : null;
    if (body.transaction && !transaction) {
      return error(400, "INVALID_ARGUMENT", "Unknown transaction.");
    }
    if (transaction) {
      if (mutateBeforeTransactionCommit) {
        const mutate = mutateBeforeTransactionCommit;
        mutateBeforeTransactionCommit = null;
        mutate();
      }
      transactions.delete(body.transaction);
      if (transactionHasChanged(transaction)) {
        return error(409, "ABORTED", "Transaction was aborted.");
      }
    }
    if (writes.length > maxCommitWrites) {
      return error(400, "INVALID_ARGUMENT", "Commit request is too large.");
    }
    const snapshot = new Map(documents);
    for (const write of writes) {
      const name = write.update?.name ?? write.delete ?? write.verify;
      const failure = preconditionError(write, snapshot.get(name));
      if (failure) {
        preconditionFailureCount += 1;
        return error(409, failure, "Commit precondition failed.");
      }
    }

    for (const write of writes) {
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

  function listDocuments(path, url, source = documents) {
    const matching = directCollectionDocuments(source, path);
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
    mutateBeforeNextTransactionCommit(mutate) {
      if (
        typeof mutate !== "function" ||
        mutateBeforeTransactionCommit
      ) {
        throw new TypeError(
          "A transaction mutation hook requires one unused callback.",
        );
      }
      mutateBeforeTransactionCommit = mutate;
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
      if (url.pathname.endsWith("/documents:beginTransaction")) {
        transactionSequence += 1;
        const transaction = Buffer.from(
          `fake-transaction-${transactionSequence}`,
        ).toString("base64");
        transactions.set(transaction, {
          collectionReads: new Set(),
          documentReads: new Set(),
          snapshot: cloneDocuments(documents),
        });
        return Response.json({ transaction });
      }
      if (url.pathname.endsWith("/documents:rollback")) {
        const body = JSON.parse(init.body);
        transactions.delete(body.transaction);
        return Response.json({});
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
      const transactionToken = url.searchParams.get("transaction");
      const transaction = transactionToken
        ? transactions.get(transactionToken)
        : null;
      if (transactionToken && !transaction) {
        return error(400, "INVALID_ARGUMENT", "Unknown transaction.");
      }
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
        transaction?.collectionReads.add(path);
        return listDocuments(path, url, transaction?.snapshot);
      }

      const name = `${database}/documents/${path}`;
      transaction?.documentReads.add(name);
      const document = (transaction?.snapshot ?? documents).get(name);
      return document
        ? Response.json(document)
        : Response.json(
            { error: { status: "NOT_FOUND" } },
            { status: 404 },
          );
    },
  };
}
