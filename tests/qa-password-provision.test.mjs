import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getGoogleAccessToken,
  provisionQaPasswordUser,
  runQaPasswordUserProvisionCli,
} from "../scripts/provision-qa-password-user.mjs";

const EMAIL =
  "qa-two-7km2qz9wp4nv8bx6@preview.openjob.invalid";
const PASSWORD = "A7!sQ9@vN2#xL5$kR8%pT4&z";
const FIREBASE_UID = "firebase_qa_two";
const OPENJOB_USER_ID = "user_qa_two_stable";
const TENANT_ID = "OpenJob-QA-Two-mvz9m";
const PROJECT_ID = "openjob-nonprod";
const API_BASE_URL =
  "https://openjob-preview.walkerworlddiscord.workers.dev/api/v1";

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function input(overrides = {}) {
  return {
    email: EMAIL,
    expectedOpenJobUserId: undefined,
    fetchImplementation: async () => {
      throw new Error("Unexpected request.");
    },
    firebaseUid: FIREBASE_UID,
    getAccessToken: async () => "owner-access-token",
    password: PASSWORD,
    ...overrides,
  };
}

function requestBody(init) {
  return JSON.parse(String(init?.body ?? "{}"));
}

test("the canonical fixture records provider kinds without account identifiers", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("../config/qa-fixture.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(fixture.users.qaOne.authentication, {
    kind: "real-provider",
    provider: "google",
  });
  assert.deepEqual(fixture.users.qaTwo.authentication, {
    kind: "internal-qa-password",
    tenantId: TENANT_ID,
  });
  for (const account of Object.values(fixture.users)) {
    assert.equal("email" in account, false);
    assert.equal("password" in account, false);
    assert.equal("uid" in account, false);
  }
});

test("provisioning fails closed before authentication or I/O for a wrong target", async () => {
  let accessTokenCalls = 0;
  let fetchCalls = 0;

  await assert.rejects(
    provisionQaPasswordUser(
      input({
        getAccessToken: async () => {
          accessTokenCalls += 1;
          return "owner-access-token";
        },
        fetchImplementation: async () => {
          fetchCalls += 1;
          return json({});
        },
        target: {
          apiBaseUrl: "https://openjob.dev/api/v1",
          apiKey: "wrong",
          projectId: "openjob-dev",
          tenantId: TENANT_ID,
        },
      }),
    ),
    /does not match the canonical Preview QA target/u,
  );
  assert.equal(accessTokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("a UID or email collision aborts without any remote write", async () => {
  const requests = [];
  const fetchImplementation = async (url, init) => {
    requests.push({ init, url: String(url) });
    const body = requestBody(init);
    if (body.localId) {
      return json({
        users: [
          {
            disabled: false,
            email: "different@preview.openjob.invalid",
            localId: FIREBASE_UID,
          },
        ],
      });
    }
    if (body.email) return json({});
    throw new Error("Unexpected request.");
  };

  await assert.rejects(
    provisionQaPasswordUser(input({ fetchImplementation })),
    /existing tenant account does not match/u,
  );
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every(({ url }) => url.endsWith("/accounts:lookup")),
  );
  assert.ok(
    requests.every(({ init }) => init.method === "POST"),
  );
  assert.ok(
    requests.every(
      ({ init }) => init.headers["x-goog-user-project"] === PROJECT_ID,
    ),
  );
});

test("verified or provider-linked tenant accounts are rejected without a write", async () => {
  for (const forbiddenFields of [
    { emailVerified: true },
    { providerUserInfo: [{ providerId: "google.com" }] },
  ]) {
    const requests = [];
    const fetchImplementation = async (url, init = {}) => {
      requests.push({ init, url: String(url) });
      return json({
        users: [
          {
            disabled: false,
            email: EMAIL,
            localId: FIREBASE_UID,
            ...forbiddenFields,
          },
        ],
      });
    };

    await assert.rejects(
      provisionQaPasswordUser(input({ fetchImplementation })),
      /existing tenant account does not match/u,
    );
    assert.equal(requests.length, 2);
    assert.ok(
      requests.every(({ url }) => url.endsWith("/accounts:lookup")),
    );
  }
});

test("a missing account is admin-created, signed in, and onboarded through ordinary APIs", async () => {
  const requests = [];
  let getMeCalls = 0;
  const fetchImplementation = async (url, init = {}) => {
    const value = String(url);
    const body = requestBody(init);
    requests.push({ body, init, url: value });

    if (value.endsWith("/accounts:lookup")) return json({});
    if (
      value.includes(
        `/v1/projects/${PROJECT_ID}/tenants/${TENANT_ID}/accounts?key=`,
      )
    ) {
      return json({
        email: EMAIL,
        idToken: "ignored-create-token",
        localId: FIREBASE_UID,
      });
    }
    if (value.includes("/v1/accounts:signInWithPassword?key=")) {
      return json({
        email: EMAIL,
        idToken: "qa-id-token",
        localId: FIREBASE_UID,
        refreshToken: "ignored-refresh-token",
      });
    }
    if (value === `${API_BASE_URL}/me` && init.method === "GET") {
      getMeCalls += 1;
      return getMeCalls === 1
        ? json(
            {
              error: {
                code: "sign_in_method_unrecognized",
                message: "Unknown.",
                requestId: "request-safe",
              },
            },
            { status: 409 },
          )
        : json({
            data: {
              groups: [],
              userId: OPENJOB_USER_ID,
              username: "qa-two",
              usernameRequired: false,
            },
          });
    }
    if (value === `${API_BASE_URL}/me` && init.method === "POST") {
      return json({
        data: {
          groups: [],
          userId: OPENJOB_USER_ID,
          username: null,
          usernameRequired: true,
        },
      });
    }
    if (value === `${API_BASE_URL}/me/username` && init.method === "PUT") {
      return json({
        data: {
          groups: [],
          userId: OPENJOB_USER_ID,
          username: "qa-two",
          usernameRequired: false,
        },
      });
    }
    throw new Error("Unexpected request.");
  };

  const result = await provisionQaPasswordUser(
    input({ fetchImplementation }),
  );

  assert.deepEqual(result, {
    changed: true,
    firebaseAccount: "created",
    openJobUser: "created",
    openJobUserId: OPENJOB_USER_ID,
    username: "claimed",
    verified: true,
  });
  const adminCreate = requests.find(({ url }) =>
    url.includes(`/tenants/${TENANT_ID}/accounts?key=`),
  );
  assert.deepEqual(adminCreate.body, {
    disabled: false,
    email: EMAIL,
    emailVerified: false,
    localId: FIREBASE_UID,
    password: PASSWORD,
  });
  assert.match(
    adminCreate.init.headers.authorization,
    /^Bearer /u,
  );
  assert.equal(
    adminCreate.init.headers["x-goog-user-project"],
    PROJECT_ID,
  );
  const signIn = requests.find(({ url }) =>
    url.includes("accounts:signInWithPassword"),
  );
  assert.deepEqual(signIn.body, {
    email: EMAIL,
    password: PASSWORD,
    returnSecureToken: true,
    tenantId: TENANT_ID,
  });
  assert.equal(
    requests.some(({ url }) => url.includes("accounts:signUp")),
    false,
  );
  assert.deepEqual(
    requests.find(
      ({ init, url }) =>
        url === `${API_BASE_URL}/me` && init.method === "POST",
    ).body,
    { confirmation: "create" },
  );
  assert.deepEqual(
    requests.find(({ url }) => url === `${API_BASE_URL}/me/username`).body,
    { username: "qa-two" },
  );
});

test("an exact existing account and OpenJob User provision idempotently", async () => {
  const requests = [];
  const fetchImplementation = async (url, init = {}) => {
    const value = String(url);
    const body = requestBody(init);
    requests.push({ body, init, url: value });
    if (value.endsWith("/accounts:lookup")) {
      return json({
        users: [
          {
            disabled: false,
            email: EMAIL,
            localId: FIREBASE_UID,
            providerUserInfo: [
              {
                federatedId: EMAIL,
                providerId: "password",
              },
            ],
          },
        ],
      });
    }
    if (value.includes("/v1/accounts:signInWithPassword?key=")) {
      return json({
        email: EMAIL,
        idToken: "qa-id-token",
        localId: FIREBASE_UID,
      });
    }
    if (value === `${API_BASE_URL}/me` && init.method === "GET") {
      return json({
        data: {
          groups: [],
          userId: OPENJOB_USER_ID,
          username: "qa-two",
          usernameRequired: false,
        },
      });
    }
    throw new Error("Unexpected request.");
  };

  const result = await provisionQaPasswordUser(
    input({
      expectedOpenJobUserId: OPENJOB_USER_ID,
      fetchImplementation,
    }),
  );

  assert.deepEqual(result, {
    changed: false,
    firebaseAccount: "existing",
    openJobUser: "existing",
    openJobUserId: OPENJOB_USER_ID,
    username: "verified",
    verified: true,
  });
  assert.equal(
    requests.some(
      ({ init, url }) =>
        init.method !== "GET" &&
        !url.endsWith("/accounts:lookup") &&
        !url.includes("accounts:signInWithPassword"),
    ),
    false,
  );
});

test("known OpenJob identity drift blocks creation before an ordinary API write", async () => {
  const requests = [];
  const fetchImplementation = async (url, init = {}) => {
    const value = String(url);
    requests.push({ init, url: value });
    if (value.endsWith("/accounts:lookup")) {
      return json({
        users: [
          {
            disabled: false,
            email: EMAIL,
            localId: FIREBASE_UID,
          },
        ],
      });
    }
    if (value.includes("/v1/accounts:signInWithPassword?key=")) {
      return json({
        idToken: "qa-id-token",
        localId: FIREBASE_UID,
      });
    }
    if (value === `${API_BASE_URL}/me` && init.method === "GET") {
      return json(
        {
          error: {
            code: "sign_in_method_unrecognized",
            message: "Unknown.",
            requestId: "request-safe",
          },
        },
        { status: 409 },
      );
    }
    throw new Error("Unexpected request.");
  };

  await assert.rejects(
    provisionQaPasswordUser(
      input({
        expectedOpenJobUserId: OPENJOB_USER_ID,
        fetchImplementation,
      }),
    ),
    /expected OpenJob User is not recognized/u,
  );
  assert.equal(
    requests.some(
      ({ init, url }) =>
        url.startsWith(API_BASE_URL) && init.method !== "GET",
    ),
    false,
  );
});

test("CLI output and failures redact credentials, OAuth material, and UserRecords", async () => {
  const output = [];
  const remoteRecord = {
    email: EMAIL,
    localId: FIREBASE_UID,
    passwordHash: "sensitive-password-hash",
  };
  const accessToken = "owner-access-token-sensitive";
  let failure;
  try {
    await runQaPasswordUserProvisionCli({
      env: {
        OPENJOB_QA_TWO_EMAIL: EMAIL,
        OPENJOB_QA_TWO_FIREBASE_UID: FIREBASE_UID,
        OPENJOB_QA_TWO_PASSWORD: PASSWORD,
      },
      fetchImplementation: async () =>
        json(
          {
            error: {
              message: JSON.stringify({
                accessToken,
                password: PASSWORD,
                user: remoteRecord,
              }),
            },
          },
          { status: 500 },
        ),
      getAccessToken: async () => accessToken,
      stdout: { write(chunk) { output.push(chunk); } },
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof Error);
  const visible = `${failure.message}\n${output.join("")}`;
  for (const secret of [
    EMAIL,
    PASSWORD,
    FIREBASE_UID,
    accessToken,
    remoteRecord.passwordHash,
  ]) {
    assert.equal(visible.includes(secret), false);
  }
  assert.match(failure.message, /Identity Platform account lookup failed/u);
  assert.equal(output.length, 0);
});

test("gcloud never inherits 1Password-injected QA bindings", async () => {
  const env = {
    HOME: "/test/home",
    OPENJOB_QA_TWO_EMAIL: EMAIL,
    OPENJOB_QA_TWO_FIREBASE_UID: FIREBASE_UID,
    OPENJOB_QA_TWO_PASSWORD: PASSWORD,
    OPENJOB_QA_TWO_USER_ID: OPENJOB_USER_ID,
    PATH: "/test/bin",
  };
  let invocation;

  assert.equal(
    await getGoogleAccessToken({
      env,
      execFileImplementation: async (...args) => {
        invocation = args;
        return { stdout: "owner-access-token\n" };
      },
    }),
    "owner-access-token",
  );
  assert.deepEqual(invocation?.slice(0, 2), [
    "gcloud",
    ["auth", "print-access-token"],
  ]);
  assert.deepEqual(invocation?.[2]?.env, {
    HOME: "/test/home",
    PATH: "/test/bin",
  });
});

test("the CLI requires randomized invalid-domain credentials and a strong password", async () => {
  for (const [name, value, message] of [
    [
      "OPENJOB_QA_TWO_EMAIL",
      "qa-two@example.com",
      /randomized lowercase \.invalid/u,
    ],
    ["OPENJOB_QA_TWO_PASSWORD", "password123", /high-entropy/u],
  ]) {
    await assert.rejects(
      runQaPasswordUserProvisionCli({
        env: {
          OPENJOB_QA_TWO_EMAIL: EMAIL,
          OPENJOB_QA_TWO_FIREBASE_UID: FIREBASE_UID,
          OPENJOB_QA_TWO_PASSWORD: PASSWORD,
          [name]: value,
        },
        getAccessToken: async () => {
          throw new Error("must not authenticate");
        },
        stdout: { write() {} },
      }),
      message,
    );
  }
});

test("the package exposes the canonical op-run provisioning command", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["qa:user:provision"],
    "node scripts/provision-qa-password-user.mjs",
  );

  let output = "";
  assert.equal(
    await runQaPasswordUserProvisionCli({
      argv: ["--help"],
      env: {},
      stdout: { write(chunk) { output += chunk; } },
    }),
    0,
  );
  assert.match(output, /op run -- npm run qa:user:provision/u);
  assert.doesNotMatch(output, /@preview|Bearer|owner-access-token/u);
});
