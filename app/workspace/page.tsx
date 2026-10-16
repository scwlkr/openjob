import WorkspaceApp from "./workspace-app";
import PersonalWorkspaceApp from "./personal-workspace-app";

declare const __OPENJOB_WORKSPACE_FIXTURE__: boolean;

export default function WorkspacePage() {
  return __OPENJOB_WORKSPACE_FIXTURE__ ? <WorkspaceApp /> : <PersonalWorkspaceApp />;
}
