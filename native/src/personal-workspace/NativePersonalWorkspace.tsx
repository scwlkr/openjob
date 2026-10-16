import { Block, Copy, Action } from './controls';
import type { NativePersonalWorkspaceController } from '../personal-workspace-contracts';
import { ReadyWorkspace } from './OnlineWorkspace';
import { OfflineWorkspace } from './OfflineWorkspace';

export type PersonalWorkspaceProps = { controller: NativePersonalWorkspaceController; ownerUserId: string; sessionReady: boolean; onRestoreSession: () => void; onSessionRevoked: () => void };
export function NativePersonalWorkspace(props: PersonalWorkspaceProps) {
  if (props.controller.offline) return <OfflineWorkspace key={props.ownerUserId} {...props} offline={props.controller.offline} />;
  if (!props.sessionReady) return <Block><Copy heading>Restore your personal workspace session</Copy><Copy>Online access requires a confirmed session. No personal data is cached on this device.</Copy><Action label="Restore session" onPress={props.onRestoreSession} /></Block>;
  return <ReadyWorkspace key={props.ownerUserId} {...props} />;
}
export default NativePersonalWorkspace;
