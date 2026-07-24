import assert from "node:assert/strict";
import test from "node:test";
import { qaPasswordIdentityConfig } from "../server/qa-password-config.ts";

const exactBindings = {
  OPENJOB_QA_PASSWORD_TENANT_ID: "OpenJob-QA-Two-mvz9m",
  OPENJOB_QA_PASSWORD_UID: "firebase_qa_two",
  OPENJOB_RUNTIME_TIER: "preview",
};

test("Preview requires one exact nonproduction QA password identity", () => {
  assert.deepEqual(
    qaPasswordIdentityConfig(exactBindings, "openjob-nonprod"),
    {
      tenantId: "OpenJob-QA-Two-mvz9m",
      uid: "firebase_qa_two",
    },
  );

  for (const [bindings, projectId] of [
    [{ OPENJOB_RUNTIME_TIER: "preview" }, "openjob-nonprod"],
    [
      {
        OPENJOB_QA_PASSWORD_TENANT_ID: "OpenJob-QA-Two-mvz9m",
        OPENJOB_RUNTIME_TIER: "preview",
      },
      "openjob-nonprod",
    ],
    [exactBindings, "openjob-dev"],
  ]) {
    assert.throws(
      () => qaPasswordIdentityConfig(bindings, projectId),
      /Preview QA password identity configuration is incomplete/u,
    );
  }
});

test("QA password bindings are forbidden outside Preview", () => {
  assert.equal(
    qaPasswordIdentityConfig(
      { OPENJOB_RUNTIME_TIER: "production" },
      "openjob-dev",
    ),
    undefined,
  );
  assert.throws(
    () =>
      qaPasswordIdentityConfig(
        {
          ...exactBindings,
          OPENJOB_RUNTIME_TIER: "production",
        },
        "openjob-dev",
      ),
    /forbidden outside Preview/u,
  );
});
