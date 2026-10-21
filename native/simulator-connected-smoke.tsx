/** Opt-in development simulator fixture. Not imported by the normal app entry. */
import { registerRootComponent } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createNativeConnectedWorkspaceApi } from './src/connected-workspaces-api';
import type { NativeConnectedWorkspaceController } from './src/connected-workspaces-contracts';
import { ConnectedWorkspaces } from './src/connected-workspaces/ConnectedWorkspaces';
import { OpenJobThemeProvider } from './src/theme';
import { Copy } from './src/personal-workspace/controls';

const origin = Platform.OS === 'android' ? 'http://10.0.2.2:5213' : 'http://127.0.0.1:5213';
function Fixture() {
  const [fonts, fontError] = useFonts({ Inter_400Regular: require('./assets/fonts/Inter-Regular.ttf'), Inter_600SemiBold: require('./assets/fonts/Inter-SemiBold.ttf'), Inter_700Bold: require('./assets/fonts/Inter-Bold.ttf') });
  const [session, setSession] = useState<{ owner: string; controller: NativeConnectedWorkspaceController }>(), [error, setError] = useState('');
  const bundleId = Platform.OS === 'android' ? Constants.expoConfig?.android?.package : Constants.expoConfig?.ios?.bundleIdentifier;
  const permitted = !Device.isDevice && bundleId === 'dev.openjob.app.dev';
  useEffect(() => {
    let active = true;
    if (!permitted) return;
    void (async () => {
      try {
        const response = await fetch(origin + '/__fixture/session/alex'); if (!response.ok) throw new Error();
        const value = await response.json() as { userId: string; token: string };
        if (!/^user_[a-f0-9]{32}$/.test(value.userId) || typeof value.token !== 'string' || !value.token) throw new Error();
        const api = createNativeConnectedWorkspaceApi({ apiBaseUrl: origin + '/api/v1' });
        const guard = async <T,>(owner: string, action: () => Promise<T>): Promise<T> => {
          if (!active || owner !== value.userId) throw new Error('Fixture session ended');
          const result = await action();
          if (!active) throw new Error('Fixture session ended'); return result;
        };
        const guarded: NativeConnectedWorkspaceController = {
          list: owner => guard(owner, () => api.list(value.token, owner)), create: (owner, name) => guard(owner, () => api.create(value.token, owner, name)), personal: owner => guard(owner, () => api.personal(value.token, owner)),
          read: (owner, id) => guard(owner, () => api.read(value.token, owner, id)), command: (owner, id, input) => guard(owner, () => api.command(value.token, owner, id, input)), connections: owner => guard(owner, () => api.connections(value.token, owner)),
          mail: (owner, id, connection, query) => guard(owner, () => api.mail(value.token, owner, id, connection, query)), message: (owner, id, connection, message) => guard(owner, () => api.message(value.token, owner, id, connection, message)), createMailTask: (owner, id, connection, input) => guard(owner, () => api.createMailTask(value.token, owner, id, connection, input)),
          source: (owner, id, task) => guard(owner, () => api.source(value.token, owner, id, task)), reply: (owner, id, task) => guard(owner, () => api.reply(value.token, owner, id, task)), saveReply: (owner, id, task, input) => guard(owner, () => api.saveReply(value.token, owner, id, task, input)),
        };
        if (active) setSession({ owner: value.userId, controller: guarded });
      } catch { if (active) setError('Start dev:owned-workspaces -- --port 5213 --google-fixture with a dedicated state file, then reopen this fixture.'); }
    })();
    return () => { active = false; };
  }, [permitted]);
  return <OpenJobThemeProvider preference="light" setPreference={() => undefined}><SafeAreaProvider><SafeAreaView style={{ flex: 1 }}><Copy heading>CONNECTED SIMULATOR FIXTURE</Copy><Copy>Invented identity, credentials and Mail · local fake service · no provider effects. Separate from normal authentication.</Copy>
    {!permitted ? <Copy>Fixture unavailable outside a development simulator.</Copy> : error || fontError ? <Copy>{error || 'Local fonts unavailable.'}</Copy> : !session || !fonts ? <Copy>Loading isolated fixture…</Copy> : <ConnectedWorkspaces key={session.owner} controller={session.controller} owner={session.owner} active sessionReady onAccessEnded={failure => { if ([401, 410].includes((failure as { status?: number }).status ?? 0)) { setSession(undefined); setError('Fixture access ended.'); } }} />}
  </SafeAreaView></SafeAreaProvider></OpenJobThemeProvider>;
}
registerRootComponent(Fixture);
