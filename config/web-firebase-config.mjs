import identities from "./native-identities.json" with { type: "json" };

export function webFirebaseConfigFor(targetEnvironment) {
  const environment =
    targetEnvironment === "preview" ? "preview" : "production";
  const firebase = identities.environments[environment].firebase;

  return {
    apiKey: firebase.apiKey,
    appId: firebase.webAppId,
    authDomain: firebase.authDomain,
    projectId: firebase.projectId,
  };
}

export function qaPasswordTenantIdFor(targetEnvironment) {
  if (targetEnvironment !== "preview") return null;
  const tenantId =
    identities.environments.preview.firebase.qaPasswordTenantId;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("Preview QA password tenant configuration is missing.");
  }
  return tenantId;
}
