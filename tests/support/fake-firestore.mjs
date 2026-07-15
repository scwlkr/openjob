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

export function createFakeFirestore() {
  const database = "projects/openjob-dev/databases/(default)";
  const documents = new Map();
  let revision = 0;
  let throttleNextRequest = false;

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
    const snapshot = new Map(documents);
    for (const write of body.writes) {
      const name = write.update?.name ?? write.verify;
      const failure = preconditionError(write, snapshot.get(name));
      if (failure) {
        return error(409, failure, "Commit precondition failed.");
      }
    }

    for (const write of body.writes) {
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
        return applyCommit(body);
      }

      const marker = "/documents/";
      const path = decodeURIComponent(
        url.pathname.slice(url.pathname.indexOf(marker) + marker.length),
      );
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
