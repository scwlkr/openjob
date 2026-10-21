import { createOwnedWorkspaceStore } from '../db/owned-workspaces.ts';
import { createPersonalWorkspaceContextStore } from '../db/personal-workspace-context.ts';
import type { FirebaseConfig } from '../db/firestore-rest.ts';
import { createWorkspaceContextStore } from './workspace-context-store.ts';
import { createWorkspacePilotApplication, type WorkspacePilotAdmission } from './workspace-pilot-application.ts';

type Options = Omit<Parameters<typeof createWorkspacePilotApplication>[0], 'store' | 'admission'> & {
  config: FirebaseConfig;
  personal: Parameters<typeof createWorkspaceContextStore>[0]['personal'];
  admission?: WorkspacePilotAdmission;
  transport?: typeof fetch;
};
/** Both normal runtimes call this without admission. Later owner-assisted setup must select it explicitly. */
export function createWorkspacePilotRuntime({ config, personal, users, verifyIdToken, admission, fixtureOperations, fixtureCalendar, transport = fetch }: Options) {
  const store = createWorkspaceContextStore({ owned: createOwnedWorkspaceStore(config, transport), personal, contexts: createPersonalWorkspaceContextStore(config, transport) });
  return createWorkspacePilotApplication({ store, users, verifyIdToken, admission, fixtureOperations, fixtureCalendar });
}
