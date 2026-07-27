import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  createReleasePrivacyOutputs,
  releasePrivacyFingerprint,
  validateNativeProcessorDependencies,
  validateReleasePrivacyInventory,
  verifyReleasePrivacyOutputs,
} from "../scripts/release-privacy.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const inventoryUrl = new URL(
  "../config/release-privacy-inventory.json",
  import.meta.url,
);
const schemaUrl = new URL(
  "../config/release-privacy-inventory.schema.json",
  import.meta.url,
);
const nativePackageUrl = new URL("../native/package.json", import.meta.url);

async function readContract() {
  const [inventory, schema] = await Promise.all([
    readFile(inventoryUrl, "utf8").then(JSON.parse),
    readFile(schemaUrl, "utf8").then(JSON.parse),
  ]);
  return { inventory, schema };
}

function expectInvalid(inventory, schema, pattern) {
  assert.throws(
    () => validateReleasePrivacyInventory(inventory, schema),
    pattern,
  );
}

test("release privacy inventory validates and generates deterministic round-trip projections", async () => {
  const { inventory, schema } = await readContract();
  validateReleasePrivacyInventory(inventory, schema);

  const first = createReleasePrivacyOutputs(inventory, schema);
  const roundTripped = createReleasePrivacyOutputs(
    JSON.parse(JSON.stringify(inventory)),
    schema,
  );
  assert.deepEqual(roundTripped, first);

  const fingerprint = releasePrivacyFingerprint(inventory);
  assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/u);
  for (const [path, contents] of first) {
    assert.match(contents, new RegExp(fingerprint, "u"), path);
    assert.match(contents, /1\.0\.0/u, path);
  }

  const native = JSON.parse(
    first.get("config/generated/native-privacy.json"),
  );
  const play = JSON.parse(
    first.get("config/generated/play-data-safety.json"),
  );
  assert.equal(native.metadata.inventoryFingerprint, fingerprint);
  assert.equal(play.metadata.inventoryFingerprint, fingerprint);
  assert.equal(native.metadata.inventorySchemaVersion, inventory.schemaVersion);
  assert.equal(play.metadata.inventorySchemaVersion, inventory.schemaVersion);
});

test("checked-in release privacy projections are current and manual drift is rejected", async () => {
  const canonical = await verifyReleasePrivacyOutputs(repositoryRoot);
  assert.deepEqual(canonical.stalePaths, []);

  const { inventory, schema } = await readContract();
  const nativePackage = await readFile(nativePackageUrl, "utf8");
  const outputs = createReleasePrivacyOutputs(inventory, schema);
  const root = await mkdtemp(join(tmpdir(), "openjob-release-privacy-"));
  try {
    await Promise.all(
      [...outputs].map(async ([path, contents]) => {
        const target = join(root, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents);
      }),
    );
    await Promise.all([
      mkdir(join(root, "config"), { recursive: true }),
      mkdir(join(root, "native"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(root, "config", "release-privacy-inventory.json"),
        `${JSON.stringify(inventory, null, 2)}\n`,
      ),
      writeFile(
        join(root, "config", "release-privacy-inventory.schema.json"),
        `${JSON.stringify(schema, null, 2)}\n`,
      ),
      writeFile(join(root, "native", "package.json"), nativePackage),
    ]);

    assert.deepEqual((await verifyReleasePrivacyOutputs(root)).stalePaths, []);
    await writeFile(
      join(root, "config", "generated", "play-data-safety.json"),
      "{}\n",
    );
    assert.deepEqual((await verifyReleasePrivacyOutputs(root)).stalePaths, [
      "config/generated/play-data-safety.json",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("one inventory row propagates to every affected projection with a new fingerprint", async () => {
  const { inventory, schema } = await readContract();
  const before = createReleasePrivacyOutputs(inventory, schema);
  const changed = structuredClone(inventory);
  changed.dataPractices.push({
    id: "fixture-support-interaction",
    authority: "openjob",
    displayName: "Fixture Support Interaction",
    collection: "required",
    collectionCondition: "authenticated-app-functionality",
    linked: true,
    tracking: false,
    shared: false,
    sold: false,
    encryptedInTransit: true,
    processorIds: ["openjob-api"],
    permissionIds: [],
    apple: {
      collected: true,
      dataType: "NSPrivacyCollectedDataTypeCustomerSupport",
      purposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
    },
    play: {
      collected: true,
      dataType: "Personal info > Other info",
      purposes: ["App functionality"],
    },
  });

  const after = createReleasePrivacyOutputs(changed, schema);
  for (const path of [
    "config/generated/native-privacy.json",
    "config/generated/play-data-safety.json",
    "docs/generated/release-privacy.md",
  ]) {
    assert.notEqual(after.get(path), before.get(path), path);
    assert.match(after.get(path), /fixture-support-interaction/u, path);
    assert.match(
      after.get(path),
      new RegExp(releasePrivacyFingerprint(changed), "u"),
      path,
    );
  }
});

test("projections keep OpenJob behavior, third-party evidence, and optional diagnostics separate", async () => {
  const { inventory, schema } = await readContract();
  const outputs = createReleasePrivacyOutputs(inventory, schema);
  const native = JSON.parse(
    outputs.get("config/generated/native-privacy.json"),
  );
  const play = JSON.parse(
    outputs.get("config/generated/play-data-safety.json"),
  );

  const crash = play.dataPractices.find(({ id }) => id === "crash-data");
  assert.equal(crash.collection, "optional");
  assert.equal(crash.collectionCondition, "share-diagnostics-enabled");
  assert.deepEqual(crash.processorIds, ["sentry"]);
  assert.equal(crash.linked, false);
  assert.equal(crash.shared, false);

  const content = play.dataPractices.find(
    ({ id }) => id === "downloaded-task-group-content",
  );
  assert.equal(content.collection, "not-collected");
  assert.equal(content.collectionCondition, "downloaded-only");

  assert.ok(
    play.thirdPartyEvidence.some(
      ({ id }) => id === "google-signin-apple-sdk-manifest",
    ),
  );
  assert.equal(
    native.applePrivacyManifest.NSPrivacyCollectedDataTypes.some(
      ({ NSPrivacyCollectedDataType }) =>
        NSPrivacyCollectedDataType === "NSPrivacyCollectedDataTypePhoneNumber",
    ),
    false,
  );
  assert.equal(play.evidencePolicy.canRewriteInventory, false);
  assert.equal(play.evidencePolicy.canAddDiscrepancy, true);
});

test("native processor dependencies must be declared without becoming inventory authority", async () => {
  const [{ inventory }, nativePackage] = await Promise.all([
    readContract(),
    readFile(nativePackageUrl, "utf8").then(JSON.parse),
  ]);
  validateNativeProcessorDependencies(inventory, nativePackage);

  const withUndeclaredProcessor = structuredClone(nativePackage);
  withUndeclaredProcessor.dependencies["posthog-react-native"] = "1.0.0";
  assert.throws(
    () =>
      validateNativeProcessorDependencies(
        inventory,
        withUndeclaredProcessor,
      ),
    /undeclared processor dependency.*posthog/iu,
  );

  const missingDeclaration = structuredClone(inventory);
  missingDeclaration.processors.find(({ id }) => id === "sentry")
    .nativeDependencyPackages = [];
  assert.throws(
    () => validateNativeProcessorDependencies(missingDeclaration, nativePackage),
    /undeclared processor dependency.*sentry/iu,
  );
});

test("release privacy validation fails closed on omissions and contradictions", async (context) => {
  const { inventory, schema } = await readContract();
  const cases = [
    ["missing platform mapping", (copy) => delete copy.dataPractices[0].apple, /apple/iu],
    [
      "contradictory collection flags",
      (copy) => {
        copy.dataPractices[0].apple.collected = false;
      },
      /contradict/iu,
    ],
    [
      "unsupported purpose",
      (copy) => {
        copy.dataPractices[0].play.purposes = ["Advertising"];
      },
      /purpose|enum/iu,
    ],
    [
      "absent required URL",
      (copy) => delete copy.publicUrls.accountDeletion.url,
      /url/iu,
    ],
    [
      "undeclared processor",
      (copy) => copy.dataPractices[0].processorIds.push("missing-processor"),
      /processor/iu,
    ],
    [
      "undeclared permission",
      (copy) => copy.dataPractices[0].permissionIds.push("missing-permission"),
      /permission/iu,
    ],
    [
      "invalid diagnostics optionality",
      (copy) => {
        copy.dataPractices.find(({ id }) => id === "crash-data").collection =
          "required";
      },
      /optionality|condition/iu,
    ],
    [
      "evidence rewriting authority",
      (copy) => {
        copy.evidencePolicy.canRewriteInventory = true;
      },
      /rewrite|constant/iu,
    ],
  ];

  for (const [name, mutate, pattern] of cases) {
    await context.test(name, () => {
      const copy = structuredClone(inventory);
      mutate(copy);
      expectInvalid(copy, schema, pattern);
    });
  }
});

test("inventory and projections exclude secrets, personal examples, Task content, and Group content", async () => {
  const { inventory, schema } = await readContract();
  const withSecret = structuredClone(inventory);
  withSecret.publicUrls.support.url =
    "https://openjob.dev/support?token=fixture-private-material";
  expectInvalid(withSecret, schema, /secret|query|url/iu);

  const withPersonalExample = structuredClone(inventory);
  withPersonalExample.dataPractices[0].sampleValue = "person@example.test";
  expectInvalid(withPersonalExample, schema, /sampleValue|additional/iu);

  const serialized = [...createReleasePrivacyOutputs(inventory, schema).values()].join(
    "\n",
  );
  for (const prohibited of inventory.evidencePolicy.prohibitedContent) {
    assert.match(serialized, new RegExp(prohibited.displayName, "iu"));
  }
  assert.doesNotMatch(serialized, /-----BEGIN .*PRIVATE KEY-----|\bya29\.|\bGOCSPX-/u);
});

test("native config and documentation consume generated inventory projections", async () => {
  const [appConfig, nativeReadme, packageMetadata] = await Promise.all([
    readFile(new URL("../native/app.config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../native/README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.match(appConfig, /generated\/native-privacy\.json/u);
  assert.match(appConfig, /inventoryFingerprint/u);
  assert.doesNotMatch(appConfig, /const appleAppPrivacy/u);
  assert.doesNotMatch(appConfig, /const androidBlockedPermissions/u);
  assert.match(nativeReadme, /docs\/generated\/release-privacy\.md/u);
  assert.doesNotMatch(nativeReadme, /\| Apple data type \|/u);
  assert.doesNotMatch(nativeReadme, /\| Play data type \|/u);
  assert.equal(
    packageMetadata.scripts["privacy:generate"],
    "node scripts/release-privacy.mjs generate",
  );
  assert.equal(
    packageMetadata.scripts["privacy:check"],
    "node scripts/release-privacy.mjs check",
  );
});
