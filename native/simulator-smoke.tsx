/** Explicit simulator-only fixture entry. Normal index.ts and authentication are unchanged. */
import { registerRootComponent } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NativePersonalWorkspace } from './src/personal-workspace/NativePersonalWorkspace';
import { createNativePersonalWorkspaceApi } from './src/personal-workspace-api';
import type { NativePersonalWorkspaceController } from './src/personal-workspace-contracts';
import { OpenJobThemeProvider } from './src/theme';
import { Copy } from './src/personal-workspace/controls';

const origin = 'http://127.0.0.1:5213';
export function simulatorFixtureAllowed(isDevice: boolean, bundleId?: string) {
  return !isDevice && bundleId === 'dev.openjob.app.dev';
}
function Fixture() {
  const [fonts, fontError] = useFonts({
    Inter_400Regular: require('./assets/fonts/Inter-Regular.ttf'),
    Inter_600SemiBold: require('./assets/fonts/Inter-SemiBold.ttf'),
    Inter_700Bold: require('./assets/fonts/Inter-Bold.ttf'),
  });
  const [session, setSession] = useState<{ owner: string; controller: NativePersonalWorkspaceController }>();
  const permitted = simulatorFixtureAllowed(Device.isDevice, Constants.expoConfig?.ios?.bundleIdentifier);
  const [error, setError] = useState(permitted ? '' : 'Fixture unavailable outside the development simulator identity.');
  useEffect(() => {
    let active = true;
    if (!permitted) return;
    void (async () => {
      try {
        const response = await fetch(`${origin}/__test/session/alex`);
        if (!response.ok) throw new Error('Unavailable');
        const value = await response.json() as { userId?: unknown; token?: unknown };
        if (typeof value.userId !== 'string' || typeof value.token !== 'string') throw new Error('Invalid fixture');
        const { userId, token } = value;
        const api = createNativePersonalWorkspaceApi({ apiBaseUrl: `${origin}/api/v1` });
        const check = (owner: string) => { if (owner !== userId) throw new Error('Wrong fixture owner'); };
        const controller: NativePersonalWorkspaceController = {
          readPersonalWorkspace: async owner => { check(owner); return api.readPersonalWorkspace(token, owner); },
          commandPersonalWorkspace: async (owner, input) => { check(owner); await api.commandPersonalWorkspace(token, input); },
          listPersonalAgents: async owner => { check(owner); return api.listPersonalAgents(token, owner); },
          revokePersonalAgent: async (owner, id) => { check(owner); await api.revokePersonalAgent(token, id); },
        };
        if (active) setSession({ owner: userId, controller });
      } catch { if (active) setError('Start the isolated --test-only API on loopback port 5213, then reopen this fixture app.'); }
    })();
    return () => { active = false; };
  }, [permitted]);
  return <OpenJobThemeProvider preference="light" setPreference={() => undefined}><SafeAreaProvider><SafeAreaView style={{ flex: 1 }}>
    <Copy heading>SIMULATOR FIXTURE</Copy><Copy>Invented data · local test API. No real sign-in, cloud writes, mailbox connection or delivery. This is not the normal authentication entry.</Copy>
    {error || fontError ? <Copy>{error || 'Local fonts could not load.'}</Copy> : !session || !fonts ? <Copy>Loading isolated fixture…</Copy> : <NativePersonalWorkspace controller={session.controller} ownerUserId={session.owner} sessionReady onRestoreSession={() => undefined} onSessionRevoked={() => { setSession(undefined); setError('Fixture access ended.'); }} />}
  </SafeAreaView></SafeAreaProvider></OpenJobThemeProvider>;
}
registerRootComponent(Fixture);
