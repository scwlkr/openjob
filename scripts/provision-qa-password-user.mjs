import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const fixture = JSON.parse(
  await readFile(new URL("../config/qa-fixture.json", import.meta.url), "utf8"),
);
const identities = JSON.parse(
  await readFile(
    new URL("../config/native-identities.json", import.meta.url),
    "utf8",
  ),
);

const previewIdentity = identities.environments.preview;
const previewFixture = fixture.environments.preview;
const qaTwoAuthentication = fixture.users.qaTwo.authentication;

const CANONICAL_TARGET = Object.freeze({
  apiBaseUrl: previewIdentity.api.baseUrl,
  apiKey: previewIdentity.firebase.apiKey,
  projectId: previewFixture.firebaseProjectId,
  tenantId: qaTwoAuthentication.tenantId,
});
const QA_USERNAME = fixture.users.qaTwo.username;

const CLI_USAGE = `Usage:
  op run -- npm run qa:user:provision

Required 1Password-backed environment bindings:
  OPENJOB_QA_TWO_EMAIL
  OPENJOB_QA_TWO_PASSWORD
  OPENJOB_QA_TWO_FIREBASE_UID

Optional stable identity assertion:
  OPENJOB_QA_TWO_USER_ID

The target is fixed to the canonical OpenJob Preview tenant. No credential
values are printed.
`;

function safeError(message) {
  return new Error(message);
}

function exactCanonicalTarget(target) {
  return (
    target?.apiBaseUrl === CANONICAL_TARGET.apiBaseUrl &&
    target?.apiKey === CANONICAL_TARGET.apiKey &&
    target?.projectId === CANONICAL_TARGET.projectId &&
    target?.tenantId === CANONICAL_TARGET.tenantId
  );
}

function assertCanonicalConfiguration() {
  if (
    previewIdentity.tier !== "nonproduction" ||
    previewFixture.firebaseProjectId !== previewIdentity.firebase.projectId ||
    qaTwoAuthentication.kind !== "internal-qa-password" ||
    QA_USERNAME !== "qa-two" ||
    !CANONICAL_TARGET.apiBaseUrl.startsWith(
      "https://openjob-preview.",
    ) ||
    !CANONICAL_TARGET.apiBaseUrl.endsWith("/api/v1")
  ) {
    throw safeError("The repository Preview QA target is inconsistent.");
  }
}

function assertRandomizedInvalidEmail(email) {
  if (typeof email !== "string" || email !== email.toLowerCase()) {
    throw safeError(
      "OPENJOB_QA_TWO_EMAIL must be a randomized lowercase .invalid address.",
    );
  }
  const match =
    /^qa-two[+-]([a-z0-9]{16,64})@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*invalid$/u
      .exec(email);
  if (
    !match ||
    email.length > 254 ||
    new Set(match[1]).size < 10
  ) {
    throw safeError(
      "OPENJOB_QA_TWO_EMAIL must be a randomized lowercase .invalid address.",
    );
  }
}

function assertHighEntropyPassword(password) {
  const hasRequiredClasses =
    /[a-z]/u.test(password ?? "") &&
    /[A-Z]/u.test(password ?? "") &&
    /[0-9]/u.test(password ?? "") &&
    /[^A-Za-z0-9]/u.test(password ?? "");
  if (
    typeof password !== "string" ||
    password.length < 24 ||
    password.length > 128 ||
    new Set(password).size < 16 ||
    !hasRequiredClasses
  ) {
    throw safeError(
      "OPENJOB_QA_TWO_PASSWORD must be a high-entropy 24-128 character password.",
    );
  }
}

function assertFirebaseUid(firebaseUid) {
  if (
    typeof firebaseUid !== "string" ||
    firebaseUid.length < 4 ||
    firebaseUid.length > 128 ||
    !/^[A-Za-z0-9_-]+$/u.test(firebaseUid)
  ) {
    throw safeError(
      "OPENJOB_QA_TWO_FIREBASE_UID must be an explicit stable Firebase UID.",
    );
  }
}

function assertExpectedOpenJobUserId(userId) {
  if (
    userId !== undefined &&
    (
      typeof userId !== "string" ||
      !/^user_[A-Za-z0-9_-]+$/u.test(userId)
    )
  ) {
    throw safeError(
      "OPENJOB_QA_TWO_USER_ID must be an explicit stable OpenJob User ID.",
    );
  }
}

function requiredBinding(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw safeError(`The ${name} binding is unavailable.`);
  }
  return value;
}

async function responsePayload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function requestJson(
  fetchImplementation,
  url,
  init,
  failureMessage,
) {
  let response;
  try {
    response = await fetchImplementation(url, init);
  } catch {
    throw safeError(failureMessage);
  }
  const payload = await responsePayload(response);
  if (!response.ok) throw safeError(failureMessage);
  return payload;
}

function identityToolkitBase(target) {
  const project = encodeURIComponent(target.projectId);
  const tenant = encodeURIComponent(target.tenantId);
  return `https://identitytoolkit.googleapis.com/v1/projects/${project}/tenants/${tenant}`;
}

async function adminLookup({
  accessToken,
  fetchImplementation,
  lookup,
  target,
}) {
  const url = `${identityToolkitBase(target)}/accounts:lookup`;
  let response;
  try {
    response = await fetchImplementation(url, {
      body: JSON.stringify(lookup),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-goog-user-project": target.projectId,
      },
      method: "POST",
    });
  } catch {
    throw safeError("Identity Platform account lookup failed.");
  }
  const payload = await responsePayload(response);
  const remoteCode = payload?.error?.message;
  if (
    !response.ok &&
    ["EMAIL_NOT_FOUND", "USER_NOT_FOUND"].includes(remoteCode)
  ) {
    return null;
  }
  if (!response.ok) {
    throw safeError("Identity Platform account lookup failed.");
  }
  const users = payload?.users ?? [];
  if (!Array.isArray(users) || users.length > 1) {
    throw safeError(
      "The existing tenant account does not match the QA identity.",
    );
  }
  return users[0] ?? null;
}

function exactAccount(record, email, firebaseUid) {
  const hasProviderIdentity =
    record?.providerUserInfo !== undefined &&
    (
      !Array.isArray(record.providerUserInfo) ||
      record.providerUserInfo.length > 0
    );
  return Boolean(
    record &&
      record.disabled !== true &&
      record.emailVerified !== true &&
      !hasProviderIdentity &&
      record.localId === firebaseUid &&
      typeof record.email === "string" &&
      record.email.toLowerCase() === email,
  );
}

async function resolveTenantAccount({
  accessToken,
  email,
  fetchImplementation,
  firebaseUid,
  password,
  target,
}) {
  const [byUid, byEmail] = await Promise.all([
    adminLookup({
      accessToken,
      fetchImplementation,
      lookup: { localId: [firebaseUid] },
      target,
    }),
    adminLookup({
      accessToken,
      fetchImplementation,
      lookup: { email: [email] },
      target,
    }),
  ]);

  if (byUid || byEmail) {
    if (
      !exactAccount(byUid, email, firebaseUid) ||
      !exactAccount(byEmail, email, firebaseUid)
    ) {
      throw safeError(
        "The existing tenant account does not match the QA identity.",
      );
    }
    return { created: false };
  }

  const project = encodeURIComponent(target.projectId);
  const tenant = encodeURIComponent(target.tenantId);
  const apiKey = encodeURIComponent(target.apiKey);
  const payload = await requestJson(
    fetchImplementation,
    `https://identitytoolkit.googleapis.com/v1/projects/${project}/tenants/${tenant}/accounts?key=${apiKey}`,
    {
      body: JSON.stringify({
        disabled: false,
        email,
        emailVerified: false,
        localId: firebaseUid,
        password,
      }),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-goog-user-project": target.projectId,
      },
      method: "POST",
    },
    "Identity Platform account creation failed.",
  );
  if (!exactAccount(payload, email, firebaseUid)) {
    throw safeError("Identity Platform did not create the exact QA identity.");
  }
  return { created: true };
}

async function signInWithPassword({
  email,
  fetchImplementation,
  firebaseUid,
  password,
  target,
}) {
  const apiKey = encodeURIComponent(target.apiKey);
  const payload = await requestJson(
    fetchImplementation,
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
        tenantId: target.tenantId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    "QA password sign-in failed.",
  );
  if (
    payload?.localId !== firebaseUid ||
    typeof payload?.idToken !== "string" ||
    payload.idToken.length === 0
  ) {
    throw safeError("QA password sign-in returned an unexpected identity.");
  }
  return payload.idToken;
}

async function openJobRequest({
  body,
  fetchImplementation,
  idToken,
  method,
  path,
  target,
}) {
  let response;
  try {
    response = await fetchImplementation(`${target.apiBaseUrl}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        authorization: `Bearer ${idToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method,
    });
  } catch {
    throw safeError("OpenJob Preview identity request failed.");
  }
  return {
    ok: response.ok,
    payload: await responsePayload(response),
    status: response.status,
  };
}

function readOpenJobUser(payload) {
  const user = payload?.data;
  if (
    !user ||
    typeof user.userId !== "string" ||
    !/^user_[A-Za-z0-9_-]+$/u.test(user.userId) ||
    !(user.username === null || typeof user.username === "string")
  ) {
    throw safeError("OpenJob Preview returned an invalid User response.");
  }
  return {
    userId: user.userId,
    username: user.username,
  };
}

function assertExpectedIdentity(user, expectedOpenJobUserId) {
  if (
    expectedOpenJobUserId !== undefined &&
    user.userId !== expectedOpenJobUserId
  ) {
    throw safeError("The OpenJob User identity does not match the expected User.");
  }
}

async function onboardOpenJobUser({
  expectedOpenJobUserId,
  fetchImplementation,
  idToken,
  target,
}) {
  const initial = await openJobRequest({
    fetchImplementation,
    idToken,
    method: "GET",
    path: "/me",
    target,
  });
  let user;
  let userCreated = false;

  if (initial.ok) {
    user = readOpenJobUser(initial.payload);
  } else {
    const errorCode = initial.payload?.error?.code;
    if (errorCode !== "sign_in_method_unrecognized") {
      throw safeError("OpenJob Preview rejected the QA identity.");
    }
    if (expectedOpenJobUserId !== undefined) {
      throw safeError(
        "The expected OpenJob User is not recognized by the QA identity.",
      );
    }
    const created = await openJobRequest({
      body: { confirmation: "create" },
      fetchImplementation,
      idToken,
      method: "POST",
      path: "/me",
      target,
    });
    if (!created.ok) {
      throw safeError("OpenJob Preview User creation failed.");
    }
    user = readOpenJobUser(created.payload);
    userCreated = true;
  }

  assertExpectedIdentity(user, expectedOpenJobUserId);
  let usernameClaimed = false;
  if (user.username === null) {
    const claimed = await openJobRequest({
      body: { username: QA_USERNAME },
      fetchImplementation,
      idToken,
      method: "PUT",
      path: "/me/username",
      target,
    });
    if (!claimed.ok) {
      throw safeError("The canonical QA Username could not be claimed.");
    }
    const claimedUser = readOpenJobUser(claimed.payload);
    if (
      claimedUser.userId !== user.userId ||
      claimedUser.username !== QA_USERNAME
    ) {
      throw safeError("OpenJob Preview returned an inconsistent QA User.");
    }
    user = claimedUser;
    usernameClaimed = true;
  } else if (user.username !== QA_USERNAME) {
    throw safeError(
      "The existing OpenJob User does not own the canonical QA Username.",
    );
  }

  const verified = await openJobRequest({
    fetchImplementation,
    idToken,
    method: "GET",
    path: "/me",
    target,
  });
  if (!verified.ok) {
    throw safeError("OpenJob Preview QA identity verification failed.");
  }
  const verifiedUser = readOpenJobUser(verified.payload);
  if (
    verifiedUser.userId !== user.userId ||
    verifiedUser.username !== QA_USERNAME
  ) {
    throw safeError("OpenJob Preview QA identity is not stable.");
  }
  assertExpectedIdentity(verifiedUser, expectedOpenJobUserId);

  return {
    userCreated,
    userId: verifiedUser.userId,
    usernameClaimed,
  };
}

const QA_SECRET_BINDINGS = Object.freeze([
  "OPENJOB_QA_TWO_EMAIL",
  "OPENJOB_QA_TWO_FIREBASE_UID",
  "OPENJOB_QA_TWO_PASSWORD",
  "OPENJOB_QA_TWO_USER_ID",
]);

function withoutQaSecrets(env) {
  const childEnvironment = { ...env };
  for (const name of QA_SECRET_BINDINGS) delete childEnvironment[name];
  return childEnvironment;
}

export async function getGoogleAccessToken({
  env = process.env,
  execFileImplementation = execFileAsync,
} = {}) {
  let stdout;
  try {
    ({ stdout } = await execFileImplementation(
      "gcloud",
      ["auth", "print-access-token"],
      {
        encoding: "utf8",
        env: withoutQaSecrets(env),
        maxBuffer: 64 * 1024,
      },
    ));
  } catch {
    throw safeError("gcloud could not provide an owner access token.");
  }
  const token = stdout.trim();
  if (!token) {
    throw safeError("gcloud could not provide an owner access token.");
  }
  return token;
}

export async function provisionQaPasswordUser({
  email,
  expectedOpenJobUserId,
  fetchImplementation = fetch,
  firebaseUid,
  getAccessToken = getGoogleAccessToken,
  password,
  target = CANONICAL_TARGET,
}) {
  assertCanonicalConfiguration();
  if (!exactCanonicalTarget(target)) {
    throw safeError(
      "The requested target does not match the canonical Preview QA target.",
    );
  }
  assertRandomizedInvalidEmail(email);
  assertHighEntropyPassword(password);
  assertFirebaseUid(firebaseUid);
  assertExpectedOpenJobUserId(expectedOpenJobUserId);

  let accessToken;
  try {
    accessToken = (await getAccessToken()).trim();
  } catch {
    throw safeError("gcloud could not provide an owner access token.");
  }
  if (!accessToken) {
    throw safeError("gcloud could not provide an owner access token.");
  }

  const firebaseAccount = await resolveTenantAccount({
    accessToken,
    email,
    fetchImplementation,
    firebaseUid,
    password,
    target,
  });
  const idToken = await signInWithPassword({
    email,
    fetchImplementation,
    firebaseUid,
    password,
    target,
  });
  const openJob = await onboardOpenJobUser({
    expectedOpenJobUserId,
    fetchImplementation,
    idToken,
    target,
  });

  return {
    changed:
      firebaseAccount.created ||
      openJob.userCreated ||
      openJob.usernameClaimed,
    firebaseAccount: firebaseAccount.created ? "created" : "existing",
    openJobUser: openJob.userCreated ? "created" : "existing",
    openJobUserId: openJob.userId,
    username: openJob.usernameClaimed ? "claimed" : "verified",
    verified: true,
  };
}

export async function runQaPasswordUserProvisionCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImplementation = fetch,
  getAccessToken = getGoogleAccessToken,
  stdout = process.stdout,
} = {}) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    stdout.write(CLI_USAGE);
    return 0;
  }
  if (argv.length !== 0) {
    throw safeError("The QA User provisioning command accepts no arguments.");
  }

  const result = await provisionQaPasswordUser({
    email: requiredBinding(env, "OPENJOB_QA_TWO_EMAIL"),
    expectedOpenJobUserId: env.OPENJOB_QA_TWO_USER_ID || undefined,
    fetchImplementation,
    firebaseUid: requiredBinding(env, "OPENJOB_QA_TWO_FIREBASE_UID"),
    getAccessToken,
    password: requiredBinding(env, "OPENJOB_QA_TWO_PASSWORD"),
  });
  stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await runQaPasswordUserProvisionCli();
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown QA User provisioning failure.";
    process.stderr.write(`QA User provisioning blocked: ${message}\n`);
    process.exitCode = 1;
  }
}
