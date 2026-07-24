export type QaPasswordIdentityConfig = {
  tenantId: string;
  uid: string;
};

export type QaPasswordRuntimeBindings = {
  OPENJOB_QA_PASSWORD_TENANT_ID?: string;
  OPENJOB_QA_PASSWORD_UID?: string;
  OPENJOB_RUNTIME_TIER?: string;
};

const TENANT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]{3,63}$/u;

export function qaPasswordIdentityConfig(
  bindings: QaPasswordRuntimeBindings,
  projectId: string,
): QaPasswordIdentityConfig | undefined {
  const tenantId = bindings.OPENJOB_QA_PASSWORD_TENANT_ID;
  const uid = bindings.OPENJOB_QA_PASSWORD_UID;
  const tier = bindings.OPENJOB_RUNTIME_TIER;
  const hasQaBinding = Boolean(tenantId || uid);

  if (tier === "preview") {
    if (
      projectId !== "openjob-nonprod" ||
      !tenantId ||
      !TENANT_ID_PATTERN.test(tenantId) ||
      !uid ||
      uid.length > 128
    ) {
      throw new Error(
        "Preview QA password identity configuration is incomplete.",
      );
    }
    return { tenantId, uid };
  }

  if (hasQaBinding) {
    throw new Error(
      "QA password identity configuration is forbidden outside Preview.",
    );
  }

  return undefined;
}
