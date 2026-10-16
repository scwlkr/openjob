import type { PropsWithChildren } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useOpenJobTheme } from '../theme';

export function Copy({ children, heading = false }: PropsWithChildren<{ heading?: boolean }>) {
  const { palette } = useOpenJobTheme();
  return <Text accessibilityRole={heading ? 'header' : undefined} style={{ color: palette.ink, fontFamily: heading ? 'Inter_700Bold' : 'Inter_400Regular', fontSize: heading ? 20 : 15, lineHeight: heading ? 28 : 23 }}>{children}</Text>;
}
export function Block({ children }: PropsWithChildren) {
  const { palette } = useOpenJobTheme();
  return <View style={{ padding: 16, gap: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card, borderRadius: 14, marginVertical: 8 }}>{children}</View>;
}
export function Row({ children }: PropsWithChildren) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>{children}</View>; }
export function Action({ label, onPress, disabled = false, selected = false }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  const { palette } = useOpenJobTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={() => { onPress(); }} style={{ minHeight: 48, minWidth: 48, padding: 12, justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: palette.controlLine, backgroundColor: selected ? palette.selected : palette.paper, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: selected ? palette.selectedText : palette.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>{label}</Text></Pressable>;
}
export function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const { palette } = useOpenJobTheme();
  return <View style={{ gap: 6 }}><Copy>{label}</Copy><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} autoCapitalize="none" autoCorrect={false} style={{ minHeight: multiline ? 100 : 48, padding: 12, borderWidth: 1, borderRadius: 6, borderColor: palette.controlLine, color: palette.ink, backgroundColor: palette.paper, fontFamily: 'Inter_400Regular', textAlignVertical: 'top' }} /></View>;
}
export function Confirm({ message, label, onConfirm, onCancel, busy }: { message: string; label: string; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  return <Block><Copy>{message}</Copy><Row><Action label={label} disabled={busy} onPress={onConfirm} /><Action label="Cancel confirmation" disabled={busy} onPress={onCancel} /></Row></Block>;
}
export const nowSlot = () => { const day = new Date().toISOString().slice(0, 10); return { start: `${day}T14:00:00.000Z`, end: `${day}T14:30:00.000Z` }; };
function utcInstant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return NaN;
  const instant = Date.parse(value);
  // Parsing can normalize impossible days and 24:00 into another date.
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 19) === value.slice(0, 19) ? instant : NaN;
}
export function validSlot(start: string, end: string) {
  const startInstant = utcInstant(start);
  const endInstant = utcInstant(end);
  return Number.isFinite(startInstant) && Number.isFinite(endInstant) && startInstant < endInstant;
}
