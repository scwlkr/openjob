import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const identitiesUrl = new URL("../config/native-identities.json", import.meta.url);
const documentationUrl = new URL(
  "../docs/native-trust-and-distribution.md",
  import.meta.url,
);
const easUrl = new URL("../native/eas.json", import.meta.url);

async function readIdentities() {
  return JSON.parse(await readFile(identitiesUrl, "utf8"));
}

test("native environments expose stable OpenJob application identities", async () => {
  const identities = await readIdentities();

  assert.equal(identities.apple.teamId, "QP9SJRTA44");
  assert.deepEqual(Object.keys(identities.environments), [
    "development",
    "preview",
    "production",
  ]);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(identities.environments).map(([name, environment]) => [
        name,
        {
          androidApplicationId: environment.android.applicationId,
          firebaseProjectId: environment.firebase.projectId,
          iosBundleId: environment.ios.bundleId,
          tier: environment.tier,
        },
      ]),
    ),
    {
      development: {
        androidApplicationId: "dev.openjob.app.dev",
        firebaseProjectId: "openjob-nonprod",
        iosBundleId: "dev.openjob.app.dev",
        tier: "nonproduction",
      },
      preview: {
        androidApplicationId: "dev.openjob.app.preview",
        firebaseProjectId: "openjob-nonprod",
        iosBundleId: "dev.openjob.app.preview",
        tier: "nonproduction",
      },
      production: {
        androidApplicationId: "dev.openjob.app",
        firebaseProjectId: "openjob-dev",
        iosBundleId: "dev.openjob.app",
        tier: "production",
      },
    },
  );
});

test("provider callbacks and associated Google identifiers are explicit", async () => {
  const identities = await readIdentities();
  const expected = {
    development: {
      appScheme: "openjob-dev",
      firebaseHandlerUrl:
        "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
      googleReversedClientId:
        "com.googleusercontent.apps.550998178053-nek4ph7nn98c7f1r4vjo1jnvd11nvm4q",
      nativeCallbackUrl: "openjob-dev://auth/callback",
    },
    preview: {
      appScheme: "openjob-preview",
      firebaseHandlerUrl:
        "https://openjob-nonprod.firebaseapp.com/__/auth/handler",
      googleReversedClientId:
        "com.googleusercontent.apps.550998178053-5ruvfa2pemb5imm1ke195qrvftrsrm6j",
      nativeCallbackUrl: "openjob-preview://auth/callback",
    },
    production: {
      appScheme: "openjob",
      firebaseHandlerUrl:
        "https://openjob-dev.firebaseapp.com/__/auth/handler",
      googleReversedClientId:
        "com.googleusercontent.apps.1015996869029-tlko5334fhqiodcgebd5hncf41jh2f8m",
      nativeCallbackUrl: "openjob://auth/callback",
    },
  };

  for (const [name, environment] of Object.entries(identities.environments)) {
    assert.deepEqual(environment.auth, {
      appScheme: expected[name].appScheme,
      firebaseHandlerUrl: expected[name].firebaseHandlerUrl,
      nativeCallbackUrl: expected[name].nativeCallbackUrl,
    });
    assert.equal(
      environment.ios.googleReversedClientId,
      expected[name].googleReversedClientId,
    );
    assert.equal(
      environment.ios.googleRedirectUri,
      `${expected[name].googleReversedClientId}:/oauthredirect`,
    );
  }

  assert.equal(
    new Set(
      Object.values(identities.environments).map(
        (environment) => environment.auth.appScheme,
      ),
    ).size,
    3,
  );
});

test("EAS build profiles bind one isolated environment and update channel", async () => {
  const [identities, eas] = await Promise.all([
    readIdentities(),
    readFile(easUrl, "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(Object.keys(eas.build), [
    "development",
    "preview",
    "production",
  ]);
  const channelIds = {
    development: "019f8d18-f7da-7d12-81e5-fe25f5b6a8fa",
    preview: "019f8d18-fe02-75a8-83a5-19019cc78eef",
    production: "019f8d19-03b3-78b3-8919-62225bfb6cb1",
  };
  for (const name of Object.keys(eas.build)) {
    assert.equal(eas.build[name].environment, name);
    assert.equal(eas.build[name].channel, name);
    assert.deepEqual(identities.environments[name].eas, {
      buildProfile: name,
      channel: name,
      channelId: channelIds[name],
      environment: name,
    });
  }
  assert.equal(eas.build.development.developmentClient, true);
  assert.equal(eas.build.development.distribution, "internal");
  assert.equal(eas.build.preview.distribution, "store");
  assert.equal(eas.build.production.distribution, "store");
});

test("Android OAuth and signing identities cannot cross environments", async () => {
  const identities = await readIdentities();
  const expected = {
    development: {
      configurationId: "AVLdWoyXls",
      googleClientId:
        "550998178053-5681l7oet4q3rq0okoa2caqkv4bh324t.apps.googleusercontent.com",
      sha1Fingerprint:
        "A9:CF:1E:47:DD:97:32:80:5A:22:36:82:41:08:6F:66:DB:EA:B3:0C",
      sha256Fingerprint:
        "89:29:53:1E:B3:53:49:CD:80:E7:C1:8C:5C:CB:C1:DA:6C:91:26:AF:A9:9D:0E:01:6F:71:3F:E2:0A:F3:D1:08",
    },
    preview: {
      configurationId: "QHMuu9fTQ4",
      googleClientId:
        "550998178053-n1s9vp0cbmqubh5onint23j8415ivkoa.apps.googleusercontent.com",
      sha1Fingerprint:
        "0B:95:B5:5A:5D:6B:BD:66:3A:12:37:B8:4D:0A:94:72:0A:04:7B:6F",
      sha256Fingerprint:
        "53:EA:CB:C3:A2:CA:24:63:23:9D:34:26:7B:5F:C8:1A:FD:36:80:09:9F:11:45:ED:B9:45:00:12:86:D4:18:43",
    },
    production: {
      configurationId: "SkaVgGHtTd",
      googleClientId:
        "1015996869029-qr0bkpihst84f8coibaotbtpjngicmjq.apps.googleusercontent.com",
      sha1Fingerprint:
        "AA:AA:E2:14:C1:28:97:03:AC:29:7A:19:40:E0:53:6A:63:C8:0B:68",
      sha256Fingerprint:
        "08:57:9F:0C:20:A3:53:DC:D3:C3:88:22:47:41:1E:5F:21:46:7C:24:F2:8B:7D:8C:7B:BC:EA:D8:70:D1:8D:F4",
    },
  };

  for (const [name, environment] of Object.entries(identities.environments)) {
    assert.equal(environment.android.googleClientId, expected[name].googleClientId);
    assert.deepEqual(environment.android.signing, {
      configurationId: expected[name].configurationId,
      createdAt: "2026-07-22",
      owner: "OpenJob",
      provider: "eas-managed",
      recovery: "@openjob/openjob credentials",
      rotationReviewBy: "2027-07-22",
      sha1Fingerprint: expected[name].sha1Fingerprint,
      sha256Fingerprint: expected[name].sha256Fingerprint,
    });
  }

  assert.equal(
    new Set(
      Object.values(identities.environments).map(
        (environment) => environment.android.googleClientId,
      ),
    ).size,
    3,
  );
});

test("Expo config resolves the public identity for each build environment", async () => {
  const { default: createAppConfig } = await import(
    `../native/app.config.mjs?test=${Date.now()}`
  );
  const identities = await readIdentities();
  const previousEnvironment = process.env.OPENJOB_NATIVE_ENV;
  const previousAndroidConfig = process.env.GOOGLE_SERVICES_JSON;
  const previousIosConfig = process.env.GOOGLE_SERVICE_INFO_PLIST;

  try {
    process.env.GOOGLE_SERVICES_JSON = "/eas/google-services.json";
    process.env.GOOGLE_SERVICE_INFO_PLIST = "/eas/GoogleService-Info.plist";
    for (const name of Object.keys(identities.environments)) {
      process.env.OPENJOB_NATIVE_ENV = name;
      const config = createAppConfig({ config: {} });
      const identity = identities.environments[name];

      assert.equal(config.owner, identities.expo.account);
      assert.equal(config.scheme, identity.auth.appScheme);
      assert.equal(config.slug, identities.expo.slug);
      assert.equal(config.extra.eas.projectId, identities.expo.projectId);
      assert.equal(config.extra.openjobEnvironment, name);
      assert.equal(config.ios.bundleIdentifier, identity.ios.bundleId);
      assert.equal(
        config.ios.googleServicesFile,
        "/eas/GoogleService-Info.plist",
      );
      assert.equal(config.android.package, identity.android.applicationId);
      assert.equal(
        config.android.googleServicesFile,
        "/eas/google-services.json",
      );
      assert.deepEqual(config.runtimeVersion, { policy: "appVersion" });
      const trustTier =
        identity.tier === "production" ? "production" : "nonproduction";
      const updateTrust = identities.trust.updateSigning[trustTier];
      assert.equal(
        config.updates.codeSigningCertificate,
        `./trust/${trustTier}-update-certificate.crt`,
      );
      assert.deepEqual(config.updates.codeSigningMetadata, {
        alg: updateTrust.algorithm,
        keyid: updateTrust.keyId,
      });
    }
  } finally {
    if (previousEnvironment === undefined) delete process.env.OPENJOB_NATIVE_ENV;
    else process.env.OPENJOB_NATIVE_ENV = previousEnvironment;
    if (previousAndroidConfig === undefined) {
      delete process.env.GOOGLE_SERVICES_JSON;
    } else {
      process.env.GOOGLE_SERVICES_JSON = previousAndroidConfig;
    }
    if (previousIosConfig === undefined) {
      delete process.env.GOOGLE_SERVICE_INFO_PLIST;
    } else {
      process.env.GOOGLE_SERVICE_INFO_PLIST = previousIosConfig;
    }
  }
});

test("update trust exports only recoverable public certificate metadata", async () => {
  const identities = await readIdentities();
  const expected = {
    nonproduction: {
      account: "nonproduction-2026-07",
      certificatePath: "native/trust/nonproduction-update-certificate.crt",
      fingerprintSha256:
        "18:A7:6D:D4:9D:C6:D1:F2:9C:33:8E:2A:02:93:08:36:9C:84:CB:D8:55:5C:F1:71:51:69:AD:93:9D:62:64:CC",
      keyId: "openjob-nonproduction-2026-07",
    },
    production: {
      account: "production-2026-07",
      certificatePath: "native/trust/production-update-certificate.crt",
      fingerprintSha256:
        "BA:53:23:5B:A1:BE:61:72:FF:A6:85:BD:5B:84:8A:DB:5F:59:47:42:7E:73:57:C3:73:E0:1D:21:12:BF:C4:E9",
      keyId: "openjob-production-2026-07",
    },
  };

  for (const [tier, trust] of Object.entries(expected)) {
    const actual = identities.trust.updateSigning[tier];
    assert.equal(actual.algorithm, "rsa-v1_5-sha256");
    assert.equal(actual.certificatePath, trust.certificatePath);
    assert.equal(actual.fingerprintSha256, trust.fingerprintSha256);
    assert.equal(actual.keyId, trust.keyId);
    assert.deepEqual(actual.privateKeyStore, {
      account: trust.account,
      provider: "macos-keychain",
      service: "dev.openjob.eas-update-signing",
    });
    assert.equal(actual.rotateBy, "2027-06-22");

    const certificate = new X509Certificate(
      await readFile(new URL(`../${trust.certificatePath}`, import.meta.url)),
    );
    assert.equal(certificate.fingerprint256, trust.fingerprintSha256);
  }
});

test("native handoff documents every public identity and recovery boundary", async () => {
  const identities = await readIdentities();
  const documentation = await readFile(documentationUrl, "utf8");

  for (const environment of Object.values(identities.environments)) {
    assert.match(documentation, new RegExp(environment.firebase.projectId, "u"));
    assert.match(documentation, new RegExp(environment.ios.bundleId, "u"));
    assert.match(documentation, new RegExp(environment.android.applicationId, "u"));
    assert.match(documentation, new RegExp(environment.eas.channelId, "u"));
    assert.match(
      documentation,
      new RegExp(environment.auth.nativeCallbackUrl, "u"),
    );
    assert.match(
      documentation,
      new RegExp(environment.ios.googleReversedClientId, "u"),
    );
  }
  for (const trust of Object.values(identities.trust.updateSigning)) {
    assert.match(documentation, new RegExp(trust.keyId, "u"));
    assert.match(documentation, new RegExp(trust.rotateBy, "u"));
  }

  assert.match(documentation, /openjob-dev.*production/iu);
  assert.match(documentation, /TestFlight/u);
  assert.match(documentation, /Internal Testing/u);
  assert.match(documentation, /#36/u);
  assert.match(documentation, /#37/u);
  assert.match(documentation, /Bitwarden/u);
  assert.match(documentation, /recovery/iu);
  assert.doesNotMatch(documentation, /BEGIN (?:EC |RSA )?PRIVATE KEY/u);
});
