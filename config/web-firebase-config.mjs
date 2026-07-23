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
