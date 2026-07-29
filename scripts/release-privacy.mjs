import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv from "ajv";
import addFormats from "ajv-formats";

const INVENTORY_PATH = "config/release-privacy-inventory.json";
const SCHEMA_PATH = "config/release-privacy-inventory.schema.json";
const NATIVE_OUTPUT_PATH = "config/generated/native-privacy.json";
const APPLE_OUTPUT_PATH = "config/generated/apple-app-privacy.json";
const PLAY_OUTPUT_PATH = "config/generated/play-data-safety.json";
const DOCUMENT_OUTPUT_PATH = "docs/generated/release-privacy.md";
const OUTPUT_PATHS = [
  NATIVE_OUTPUT_PATH,
  APPLE_OUTPUT_PATH,
  PLAY_OUTPUT_PATH,
  DOCUMENT_OUTPUT_PATH,
];
const REQUIRED_EVIDENCE_INPUTS = [
  {
    id: "exact-dependency-inventories",
    sourceType: "exact-dependency-inventory",
    candidateScoped: true,
    ownerIssue: 41,
  },
  {
    id: "bundled-sdk-manifests",
    sourceType: "sdk-manifest",
    candidateScoped: true,
    ownerIssue: 41,
  },
  {
    id: "play-sdk-index",
    sourceType: "sdk-index",
    candidateScoped: true,
    ownerIssue: 41,
  },
  {
    id: "simulator-emulator-provider-api-sentry-traffic",
    sourceType: "captured-traffic",
    candidateScoped: false,
    ownerIssue: 40,
  },
  {
    id: "exact-candidate-provider-api-sentry-traffic",
    sourceType: "captured-traffic",
    candidateScoped: true,
    ownerIssue: 41,
  },
];
const REQUIRED_CHECKLIST_ITEMS = [
  {
    id: "match-generated-projections",
    platforms: ["apple", "play"],
    ownerIssue: 40,
    stage: "pre-release-preparation",
  },
  {
    id: "verify-public-urls",
    platforms: ["apple", "play"],
    ownerIssue: 40,
    stage: "pre-release-preparation",
  },
  {
    id: "verify-account-deletion",
    platforms: ["apple", "play"],
    ownerIssue: 40,
    stage: "pre-release-preparation",
  },
  {
    id: "reconcile-virtual-traffic",
    platforms: ["apple", "play"],
    ownerIssue: 40,
    stage: "pre-release-preparation",
  },
  {
    id: "prepare-declaration-answers",
    platforms: ["apple", "play"],
    ownerIssue: 40,
    stage: "pre-release-preparation",
  },
  {
    id: "reconcile-candidate-evidence",
    platforms: ["apple", "play"],
    ownerIssue: 41,
    stage: "release-proof",
  },
  {
    id: "save-without-premature-claims",
    platforms: ["apple", "play"],
    ownerIssue: 41,
    stage: "release-proof",
  },
];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function duplicateIds(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const { id } of values) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function assertUniqueIds(label, values) {
  const duplicates = duplicateIds(values);
  if (duplicates.length > 0) {
    throw new Error(
      `Release Privacy Inventory has duplicate ${label} IDs: ${duplicates.join(", ")}.`,
    );
  }
}

function assertRequiredContracts(label, values, requiredContracts) {
  const valuesById = new Map(values.map((value) => [value.id, value]));
  for (const required of requiredContracts) {
    const actual = valuesById.get(required.id);
    if (!actual) {
      throw new Error(
        `Release Privacy Inventory is missing required ${label} ${required.id}.`,
      );
    }
    for (const [field, expected] of Object.entries(required)) {
      const matches = Array.isArray(expected)
        ? Array.isArray(actual[field]) &&
          actual[field].length === expected.length &&
          expected.every((value) => actual[field].includes(value))
        : actual[field] === expected;
      if (field !== "id" && !matches) {
        throw new Error(
          `Release Privacy Inventory ${label} ${required.id} has invalid ${field}; expected ${expected}.`,
        );
      }
    }
  }
}

function assertReferences(label, references, declared) {
  for (const reference of references) {
    if (!declared.has(reference)) {
      throw new Error(
        `Release Privacy Inventory ${label} references undeclared ${reference}.`,
      );
    }
  }
}

function assertSafeUrls(publicUrls) {
  for (const [id, entry] of Object.entries(publicUrls)) {
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      throw new Error(`Release Privacy Inventory public URL ${id} is invalid.`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        `Release Privacy Inventory public URL ${id} must be a secret-free HTTPS URL without credentials, query, or fragment.`,
      );
    }
  }
}

function assertNoSensitiveExamples(value, path = "inventory") {
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      /-----BEGIN .*PRIVATE KEY-----|\b(?:GOCSPX-|ya29\.|expo_)[A-Za-z0-9_-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./u.test(
        value,
      )
    ) {
      throw new Error(
        `Release Privacy Inventory contains secret-like material at ${path}.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSensitiveExamples(entry, `${path}[${index}]`),
    );
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      /(?:secret|password|sampleValue|personalValue|taskText|groupName|credentialValue)/u.test(
        key,
      )
    ) {
      throw new Error(
        `Release Privacy Inventory cannot contain secret or personal example field ${path}.${key}.`,
      );
    }
    assertNoSensitiveExamples(entry, `${path}.${key}`);
  }
}

function assertSemanticContract(inventory) {
  assertUniqueIds("processor", inventory.processors);
  assertUniqueIds("permission", inventory.permissions);
  assertUniqueIds("data-practice", inventory.dataPractices);
  assertUniqueIds("third-party evidence", inventory.thirdPartyEvidence);
  assertUniqueIds("evidence input", inventory.evidencePolicy.inputs);
  assertUniqueIds(
    "prohibited-content",
    inventory.evidencePolicy.prohibitedContent,
  );
  assertUniqueIds("submission-checklist", inventory.submissionChecklist);
  assertRequiredContracts(
    "evidence input",
    inventory.evidencePolicy.inputs,
    REQUIRED_EVIDENCE_INPUTS,
  );
  assertRequiredContracts(
    "checklist item",
    inventory.submissionChecklist,
    REQUIRED_CHECKLIST_ITEMS,
  );

  const processors = new Map(
    inventory.processors.map((processor) => [processor.id, processor]),
  );
  const processorIds = new Set(processors.keys());
  const permissionIds = new Set(
    inventory.permissions.map((permission) => permission.id),
  );

  for (const permission of inventory.permissions) {
    assertReferences(
      `permission ${permission.id} processorIds`,
      permission.processorIds,
      processorIds,
    );
    const { kind } = permission.nativeConfiguration;
    const mustBeBlocked =
      kind === "android-blocked-permission" ||
      (kind === "expo-plugin-boolean" &&
        permission.nativeConfiguration.value === false);
    if (
      (mustBeBlocked && permission.disposition !== "blocked") ||
      (!mustBeBlocked && permission.disposition !== "required")
    ) {
      throw new Error(
        `Release Privacy Inventory permission ${permission.id} has a contradictory disposition.`,
      );
    }
  }

  for (const practice of inventory.dataPractices) {
    assertReferences(
      `data practice ${practice.id} processorIds`,
      practice.processorIds,
      processorIds,
    );
    assertReferences(
      `data practice ${practice.id} permissionIds`,
      practice.permissionIds,
      permissionIds,
    );

    const notCollected = practice.collection === "not-collected";
    if (
      practice.apple.collected === notCollected ||
      practice.play.collected === notCollected
    ) {
      throw new Error(
        `Release Privacy Inventory data practice ${practice.id} has contradictory collection flags.`,
      );
    }
    if (notCollected) {
      if (
        practice.apple.dataType ||
        practice.apple.purposes.length > 0 ||
        practice.play.purposes.length > 0 ||
        practice.processorIds.length > 0 ||
        practice.linked ||
        practice.tracking ||
        practice.shared ||
        practice.sold
      ) {
        throw new Error(
          `Release Privacy Inventory data practice ${practice.id} contradicts not-collected meaning.`,
        );
      }
    } else if (
      !practice.apple.dataType ||
      practice.apple.purposes.length === 0 ||
      practice.play.purposes.length === 0 ||
      practice.processorIds.length === 0
    ) {
      throw new Error(
        `Release Privacy Inventory data practice ${practice.id} is missing a platform mapping or processor.`,
      );
    }
    if (
      (practice.collectionCondition === "share-diagnostics-enabled") !==
      (practice.collection === "optional")
    ) {
      throw new Error(
        `Release Privacy Inventory data practice ${practice.id} has invalid optionality or collection condition.`,
      );
    }
    if (
      practice.collectionCondition === "share-diagnostics-enabled" &&
      !practice.processorIds.includes("sentry")
    ) {
      throw new Error(
        `Release Privacy Inventory optional diagnostics ${practice.id} must declare Sentry.`,
      );
    }
    if (
      practice.collectionCondition === "downloaded-only" &&
      practice.collection !== "not-collected"
    ) {
      throw new Error(
        `Release Privacy Inventory downloaded-only practice ${practice.id} must be not-collected.`,
      );
    }
    if (practice.encryptedInTransit !== inventory.security.encryptedInTransit) {
      throw new Error(
        `Release Privacy Inventory data practice ${practice.id} contradicts the security declaration.`,
      );
    }
  }

  for (const evidence of inventory.thirdPartyEvidence) {
    assertReferences(
      `third-party evidence ${evidence.id} processorId`,
      [evidence.processorId],
      processorIds,
    );
    if (processors.get(evidence.processorId).authority !== "third-party") {
      throw new Error(
        `Release Privacy Inventory evidence ${evidence.id} must reference a third-party processor.`,
      );
    }
  }

  for (const input of inventory.evidencePolicy.inputs) {
    if (input.candidateScoped !== (input.ownerIssue === 41)) {
      throw new Error(
        `Release Privacy Inventory evidence input ${input.id} has a contradictory issue scope.`,
      );
    }
  }
  for (const item of inventory.submissionChecklist) {
    const expectedStage =
      item.ownerIssue === 40 ? "pre-release-preparation" : "release-proof";
    if (item.stage !== expectedStage) {
      throw new Error(
        `Release Privacy Inventory checklist item ${item.id} has a contradictory issue stage.`,
      );
    }
  }

  const deletionUrl = inventory.publicUrls[inventory.accountDeletion.publicUrlId];
  if (!deletionUrl) {
    throw new Error(
      "Release Privacy Inventory account deletion references an absent required URL.",
    );
  }
  if (
    inventory.accountDeletion.status === "implemented" &&
    (!inventory.accountDeletion.inAppAvailable ||
      !inventory.accountDeletion.publicRequestAvailable ||
      deletionUrl.status !== "live")
  ) {
    throw new Error(
      "Release Privacy Inventory implemented account deletion requires live in-app and public paths.",
    );
  }
  if (inventory.evidencePolicy.canRewriteInventory) {
    throw new Error(
      "Release Privacy Inventory evidence cannot rewrite the authoritative inventory.",
    );
  }
  assertSafeUrls(inventory.publicUrls);
  assertNoSensitiveExamples(inventory);
}

export function validateReleasePrivacyInventory(inventory, schema) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(inventory)) {
    const details = validate.errors
      .map(
        ({ instancePath, keyword, message, params }) =>
          `${instancePath || "/"} ${keyword} ${message} ${JSON.stringify(params)}`,
      )
      .join("; ");
    throw new Error(
      `Release Privacy Inventory schema validation failed: ${details}`,
    );
  }
  assertSemanticContract(inventory);
}

export function validateNativeProcessorDependencies(inventory, nativePackage) {
  const declaredPackages = new Map();
  for (const processor of inventory.processors) {
    for (const packageName of processor.nativeDependencyPackages) {
      const existing = declaredPackages.get(packageName);
      if (existing) {
        throw new Error(
          `Release Privacy Inventory processor dependency ${packageName} is declared by both ${existing} and ${processor.id}.`,
        );
      }
      declaredPackages.set(packageName, processor.id);
    }
  }

  const dependencies = new Set(Object.keys(nativePackage.dependencies ?? {}));
  for (const [packageName, processorId] of declaredPackages) {
    if (!dependencies.has(packageName)) {
      throw new Error(
        `Release Privacy Inventory processor ${processorId} declares missing native dependency ${packageName}.`,
      );
    }
  }
  for (const packageName of dependencies) {
    if (
      /(?:sentry|crashlytics|posthog|analytics|segment|amplitude|mixpanel|google-signin|apple-authentication)/iu.test(
        packageName,
      ) &&
      !declaredPackages.has(packageName)
    ) {
      throw new Error(
        `Native package contains undeclared processor dependency ${packageName}; add its processor mapping to the Release Privacy Inventory.`,
      );
    }
  }
}

export function releasePrivacyFingerprint(inventory) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(inventory)))
    .digest("hex")}`;
}

function projectionMetadata(inventory) {
  return {
    generatedFrom: INVENTORY_PATH,
    inventoryFingerprint: releasePrivacyFingerprint(inventory),
    inventorySchemaVersion: inventory.schemaVersion,
    inventoryVersion: inventory.inventoryVersion,
  };
}

function createNativeProjection(inventory) {
  const entitlements = {};
  const androidPermissions = [];
  const androidBlockedPermissions = [];
  let iosUsesAppleSignIn = false;
  let secureStoreFaceIdPermission = false;

  for (const permission of inventory.permissions) {
    const native = permission.nativeConfiguration;
    if (native.kind === "ios-entitlement") {
      entitlements[native.key] = native.value;
    } else if (native.kind === "expo-boolean") {
      if (native.key !== "usesAppleSignIn") {
        throw new Error(
          `Unsupported Release Privacy Inventory Expo flag ${native.key}.`,
        );
      }
      iosUsesAppleSignIn = native.value;
    } else if (native.kind === "expo-plugin-boolean") {
      if (
        native.plugin !== "expo-secure-store" ||
        native.key !== "faceIDPermission"
      ) {
        throw new Error(
          `Unsupported Release Privacy Inventory plugin flag ${native.plugin}.${native.key}.`,
        );
      }
      secureStoreFaceIdPermission = native.value;
    } else if (native.kind === "android-required-permission") {
      androidPermissions.push(native.value);
    } else if (native.kind === "android-blocked-permission") {
      androidBlockedPermissions.push(native.value);
    }
  }

  const appleRows = inventory.dataPractices.filter(
    ({ authority, apple }) => authority === "openjob" && apple.collected,
  );
  return {
    metadata: projectionMetadata(inventory),
    dataPracticeIds: appleRows.map(({ id }) => id),
    applePrivacyManifest: {
      NSPrivacyCollectedDataTypes: appleRows.map((practice) => ({
        NSPrivacyCollectedDataType: practice.apple.dataType,
        NSPrivacyCollectedDataTypeLinked: practice.linked,
        NSPrivacyCollectedDataTypePurposes: practice.apple.purposes,
        NSPrivacyCollectedDataTypeTracking: practice.tracking,
      })),
      NSPrivacyTracking: appleRows.some(({ tracking }) => tracking),
      NSPrivacyTrackingDomains: [],
    },
    nativeConfiguration: {
      android: {
        blockedPermissions: androidBlockedPermissions,
        permissions: androidPermissions,
      },
      ios: {
        entitlements,
        usesAppleSignIn: iosUsesAppleSignIn,
      },
      plugins: {
        "expo-secure-store": {
          faceIDPermission: secureStoreFaceIdPermission,
        },
      },
    },
    permissions: inventory.permissions,
  };
}

function inventoryPrerequisitesReady(inventory) {
  return (
    inventory.accountDeletion.status === "implemented" &&
    inventory.accountDeletion.inAppAvailable &&
    inventory.accountDeletion.publicRequestAvailable &&
    Object.values(inventory.publicUrls).every(({ status }) => status === "live")
  );
}

function createAppleProjection(inventory) {
  const deletionUrl = inventory.publicUrls[inventory.accountDeletion.publicUrlId];
  return {
    metadata: projectionMetadata(inventory),
    inventoryPrerequisitesReady: inventoryPrerequisitesReady(inventory),
    declarationState: "generated-draft",
    submissionState: "deferred-to-issue-41",
    security: inventory.security,
    publicUrls: inventory.publicUrls,
    accountDeletion: {
      ...inventory.accountDeletion,
      url: deletionUrl.url,
      urlStatus: deletionUrl.status,
    },
    dataPractices: inventory.dataPractices.map((practice) => ({
      id: practice.id,
      displayName: practice.displayName,
      authority: practice.authority,
      dataType: practice.apple.dataType ?? null,
      collection: practice.collection,
      collected: practice.apple.collected,
      collectionCondition: practice.collectionCondition,
      linked: practice.linked,
      tracking: practice.tracking,
      shared: practice.shared,
      sold: practice.sold,
      encryptedInTransit: practice.encryptedInTransit,
      purposes: practice.apple.purposes,
      processorIds: practice.processorIds,
      permissionIds: practice.permissionIds,
    })),
    processors: inventory.processors,
    permissions: inventory.permissions,
    thirdPartyEvidence: inventory.thirdPartyEvidence,
    evidencePolicy: inventory.evidencePolicy,
    submissionChecklist: inventory.submissionChecklist,
  };
}

function createPlayProjection(inventory) {
  const deletionUrl = inventory.publicUrls[inventory.accountDeletion.publicUrlId];
  return {
    metadata: projectionMetadata(inventory),
    inventoryPrerequisitesReady: inventoryPrerequisitesReady(inventory),
    declarationState: "generated-draft",
    submissionState: "deferred-to-issue-41",
    security: inventory.security,
    publicUrls: inventory.publicUrls,
    accountDeletion: {
      ...inventory.accountDeletion,
      url: deletionUrl.url,
      urlStatus: deletionUrl.status,
    },
    dataPractices: inventory.dataPractices.map((practice) => ({
      id: practice.id,
      displayName: practice.displayName,
      authority: practice.authority,
      dataType: practice.play.dataType,
      collection: practice.collection,
      collected: practice.play.collected,
      collectionCondition: practice.collectionCondition,
      shared: practice.shared,
      sold: practice.sold,
      linked: practice.linked,
      tracking: practice.tracking,
      encryptedInTransit: practice.encryptedInTransit,
      purposes: practice.play.purposes,
      processorIds: practice.processorIds,
      permissionIds: practice.permissionIds,
    })),
    processors: inventory.processors,
    permissions: inventory.permissions,
    thirdPartyEvidence: inventory.thirdPartyEvidence,
    evidencePolicy: inventory.evidencePolicy,
    submissionChecklist: inventory.submissionChecklist,
  };
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function renderReleasePrivacyDocument(inventory) {
  const metadata = projectionMetadata(inventory);
  const play = createPlayProjection(inventory);
  const lines = [
    "<!-- This file is generated. Edit config/release-privacy-inventory.json, then run npm run privacy:generate. -->",
    "",
    "# Release Privacy and Store Preparation",
    "",
    `- Inventory schema version: \`${metadata.inventorySchemaVersion}\``,
    `- Inventory version: \`${metadata.inventoryVersion}\``,
    `- Inventory fingerprint: \`${metadata.inventoryFingerprint}\``,
    `- Generated from: \`${metadata.generatedFrom}\``,
    "",
    play.inventoryPrerequisitesReady
      ? "Preparation status: **generated Apple and Play drafts are ready for #40 virtual-runtime reconciliation**. Saving or submitting store forms remains deferred to #41 exact-candidate Release Proof."
      : "Preparation status: **not ready for store submission**. Planned URLs and issue #42 account deletion must be completed and then reconciled against one immutable candidate.",
    "",
    "This document projects OpenJob-owned behavior separately from third-party declarations. SDK or operating-system claims are evidence, not OpenJob product behavior.",
    "",
    "## OpenJob-owned data practices",
    "",
    "| ID | Data | Collection | Condition | Linked | Tracking | Shared | Security | Apple mapping | Apple purposes | Play mapping | Play purposes | Processors |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const practice of inventory.dataPractices) {
    lines.push(
      `| ${[
        `\`${practice.id}\``,
        practice.displayName,
        practice.collection,
        practice.collectionCondition,
        yesNo(practice.linked),
        yesNo(practice.tracking),
        yesNo(practice.shared),
        practice.encryptedInTransit ? "Encrypted in transit" : "Not encrypted",
        practice.apple.collected ? practice.apple.dataType : "Not collected",
        practice.apple.purposes.join(", ") || "None",
        practice.play.collected ? practice.play.dataType : `${practice.play.dataType} — not collected`,
        practice.play.purposes.join(", ") || "None",
        practice.processorIds.map((id) => `\`${id}\``).join(", ") || "None",
      ]
        .map(markdownCell)
        .join(" | ")} |`,
    );
  }

  lines.push(
    "",
    "Required account and app-functionality rows are independent of Share diagnostics. Crash, performance, and other diagnostic rows are optional and apply only while Share diagnostics is enabled. Downloaded Task or Group content remains on-device in the read-only native experience and is not collected.",
    "",
    "## Processors",
    "",
    "| ID | Processor | Authority | Owner | Role | Native dependencies | Candidate reconciliation |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const processor of inventory.processors) {
    lines.push(
      `| ${[
        `\`${processor.id}\``,
        processor.displayName,
        processor.authority,
        processor.owner,
        processor.role,
        processor.nativeDependencyPackages
          .map((packageName) => `\`${packageName}\``)
          .join(", ") || "None",
        yesNo(processor.candidateReconciliationRequired),
      ]
        .map(markdownCell)
        .join(" | ")} |`,
    );
  }

  lines.push(
    "",
    "## Permissions and native configuration",
    "",
    "| ID | Permission or capability | Platform | Disposition | Configuration | Processors |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const permission of inventory.permissions) {
    const native = permission.nativeConfiguration;
    const configuration =
      native.kind === "ios-entitlement"
        ? `${native.kind}: ${native.key}=${native.value.join(",")}`
        : native.kind === "expo-boolean" || native.kind === "expo-plugin-boolean"
          ? `${native.kind}: ${native.plugin ? `${native.plugin}.` : ""}${native.key}=${native.value}`
          : `${native.kind}: ${native.value}`;
    lines.push(
      `| ${[
        `\`${permission.id}\``,
        permission.displayName,
        permission.platform,
        permission.disposition,
        configuration,
        permission.processorIds.map((id) => `\`${id}\``).join(", ") || "None",
      ]
        .map(markdownCell)
        .join(" | ")} |`,
    );
  }

  lines.push(
    "",
    "## Required public URLs and account deletion",
    "",
    "| ID | Public resource | URL | Status | Required before submission |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const [id, entry] of Object.entries(inventory.publicUrls)) {
    lines.push(
      `| ${[
        `\`${id}\``,
        entry.displayName,
        entry.url,
        entry.status,
        yesNo(entry.requiredBeforeSubmission),
      ]
        .map(markdownCell)
        .join(" | ")} |`,
    );
  }
  lines.push(
    "",
    `Store account deletion is required and currently \`${inventory.accountDeletion.status}\` on issue #${inventory.accountDeletion.implementationIssue}. In-app path available: ${yesNo(inventory.accountDeletion.inAppAvailable)}. Public request path available: ${yesNo(inventory.accountDeletion.publicRequestAvailable)}. Do not save or submit a completed deletion claim until both paths and the public URL are live and proven.`,
    "",
    `Implemented deletion policy: access ends ${inventory.accountDeletion.accessEnds}; retries are bounded to ${inventory.accountDeletion.maximumRetryDays} days in a ${inventory.accountDeletion.pendingState}; retention after completion is ${inventory.accountDeletion.retentionAfterCompletion}. Sole-Member Groups ${inventory.accountDeletion.soleMemberGroup}; shared membership is ${inventory.accountDeletion.sharedGroupMembership}; final Admin replacement uses ${inventory.accountDeletion.finalAdminReplacement}. Creator Tasks ${inventory.accountDeletion.creatorTasks}; open assignments become ${inventory.accountDeletion.openAssignedTasks}; completed assignments use a ${inventory.accountDeletion.doneAssignedTasks}. Linked providers ${inventory.accountDeletion.linkedProviderCleanup}.`,
    "",
    "## Third-party declaration evidence",
    "",
    "These rows remain separate from the OpenJob-owned Apple manifest and Play answers:",
    "",
    "| ID | Evidence | Processor | Platform | Source | Claims | OpenJob behavior |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const evidence of inventory.thirdPartyEvidence) {
    lines.push(
      `| ${[
        `\`${evidence.id}\``,
        evidence.displayName,
        `\`${evidence.processorId}\``,
        evidence.platform,
        evidence.sourceType,
        evidence.claims.join("; "),
        yesNo(evidence.representsOpenJobBehavior),
      ]
        .map(markdownCell)
        .join(" | ")} |`,
    );
  }

  lines.push(
    "",
    "## Submission checklist",
    "",
  );
  for (const item of inventory.submissionChecklist) {
    lines.push(
      `- [ ] \`${item.id}\` (#${item.ownerIssue} ${item.stage}; ${item.platforms.join(" + ")}): ${item.description} Block when: ${item.blockingCondition}`,
    );
  }

  lines.push(
    "",
    "## Candidate reconciliation boundary",
    "",
    "#40 reconciles iOS Simulator and Android Emulator provider/API/Sentry traffic and prepares generated declaration answers. #41 alone reconciles exact Candidate Artifact dependencies, bundled SDK manifests, Play SDK Index entries, final candidate traffic, and authenticated store state. Evidence can add a discrepancy but cannot silently rewrite this inventory.",
    "",
    `Evidence and generated reports must exclude ${inventory.evidencePolicy.prohibitedContent
      .map(({ displayName }) => displayName)
      .join(", ")}.`,
    "",
  );
  return lines.join("\n");
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createReleasePrivacyOutputs(inventory, schema) {
  validateReleasePrivacyInventory(inventory, schema);
  return new Map([
    [NATIVE_OUTPUT_PATH, serializeJson(createNativeProjection(inventory))],
    [APPLE_OUTPUT_PATH, serializeJson(createAppleProjection(inventory))],
    [PLAY_OUTPUT_PATH, serializeJson(createPlayProjection(inventory))],
    [DOCUMENT_OUTPUT_PATH, renderReleasePrivacyDocument(inventory)],
  ]);
}

function normalizeRoot(root) {
  return root instanceof URL ? fileURLToPath(root) : resolve(root);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadReleasePrivacyContract(root) {
  const normalizedRoot = normalizeRoot(root);
  const [inventory, schema, nativePackage] = await Promise.all([
    readJson(resolve(normalizedRoot, INVENTORY_PATH)),
    readJson(resolve(normalizedRoot, SCHEMA_PATH)),
    readJson(resolve(normalizedRoot, "native/package.json")),
  ]);
  validateNativeProcessorDependencies(inventory, nativePackage);
  return { inventory, normalizedRoot, schema };
}

export async function verifyReleasePrivacyOutputs(root = repositoryRoot) {
  const { inventory, normalizedRoot, schema } =
    await loadReleasePrivacyContract(root);
  const expected = createReleasePrivacyOutputs(inventory, schema);
  const stalePaths = [];
  for (const [path, contents] of expected) {
    let actual;
    try {
      actual = await readFile(resolve(normalizedRoot, path), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (actual !== contents) stalePaths.push(path);
  }
  return {
    fingerprint: releasePrivacyFingerprint(inventory),
    inventory,
    schema,
    stalePaths,
  };
}

async function generate(root = repositoryRoot) {
  const { inventory, normalizedRoot, schema } =
    await loadReleasePrivacyContract(root);
  const outputs = createReleasePrivacyOutputs(inventory, schema);
  for (const [path, contents] of outputs) {
    const target = resolve(normalizedRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return releasePrivacyFingerprint(inventory);
}

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (!command || extra.length > 0 || !["generate", "check"].includes(command)) {
    throw new Error("Usage: node scripts/release-privacy.mjs <generate|check>");
  }
  if (command === "generate") {
    const fingerprint = await generate();
    process.stdout.write(
      `Generated ${OUTPUT_PATHS.length} Release Privacy projections (${fingerprint}).\n`,
    );
    return;
  }

  const result = await verifyReleasePrivacyOutputs();
  if (result.stalePaths.length > 0) {
    throw new Error(
      `Release Privacy projections are stale or manually diverged: ${result.stalePaths.join(", ")}. Run npm run privacy:generate.`,
    );
  }
  process.stdout.write(
    `Release Privacy Inventory and ${OUTPUT_PATHS.length} projections verified (${result.fingerprint}).\n`,
  );
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedUrl === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
