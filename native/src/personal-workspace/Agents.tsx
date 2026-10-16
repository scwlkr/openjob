import { useState } from 'react';
import type { PersonalAgentGrant } from '../personal-workspace-contracts';
import { Action, Block, Confirm, Copy } from './controls';
export function Agents({ grants, checkedAt, busy, revoke }: { grants: PersonalAgentGrant[]; checkedAt: number; busy: boolean; revoke: (id: string) => Promise<boolean> }) {
  const [pending, setPending] = useState('');
  return <><Copy heading>Personal agent access</Copy><Copy>Access shown at the last workspace refresh. Refresh to check current expiry and revocation.</Copy><Copy>Issue credentials with the authenticated CLI. This screen never shows credentials. Mail capabilities apply only to named invented examples; actual provider sending is unavailable.</Copy>
    {grants.map(grant => { const active = !grant.revoked && Date.parse(grant.expiresAt) > checkedAt; return <Block key={grant.id}><Copy heading>{grant.name}</Copy><Copy>Agent {grant.id}{'\n'}{grant.revoked ? 'Revoked' : active ? 'Active; expires ' + grant.expiresAt : 'Expired; ended ' + grant.expiresAt}{'\n'}Effective scopes: {active ? grant.scopes.join(', ') : 'None'}{'\n'}Effective resources: {active ? grant.resourceIds.join(', ') : 'None'}</Copy><Action label={`Revoke ${grant.name}`} disabled={busy || grant.revoked} onPress={() => setPending(grant.id)} />
      {pending === grant.id && <Confirm message="Revoke future API access? Existing task, calendar and simulated Mail changes remain." label="Confirm revoke agent" busy={busy} onCancel={() => setPending('')} onConfirm={async () => { if (await revoke(grant.id)) setPending(''); }} />}
    </Block>; })}{!grants.length && <Copy>No personal agent grants.</Copy>}
  </>;
}
