import { createConnectionsApi } from './connections/api.ts';
import { createV1PersonalWorkspaceApi } from './v1-personal-workspace.ts';
import { createV1PersonalAgentGrantsApi } from './v1-personal-agent-grants.ts';
import { createV1ProviderPreviewApi } from './v1-provider-preview.ts';

type Options = Parameters<typeof createV1PersonalWorkspaceApi>[0]
  & Parameters<typeof createV1PersonalAgentGrantsApi>[0]
  & Parameters<typeof createV1ProviderPreviewApi>[0]
  & Parameters<typeof createConnectionsApi>[0];

// Platform bindings belong to composition roots, not the shared application.
export function createPersonalApplication(options: Options) {
  return {
    connectionsApi: createConnectionsApi(options),
    personalWorkspaceApi: createV1PersonalWorkspaceApi(options),
    personalAgentGrantsApi: createV1PersonalAgentGrantsApi(options),
    providerPreviewApi: createV1ProviderPreviewApi(options),
  };
}
