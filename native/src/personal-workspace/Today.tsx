import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { WorkspaceView } from '../personal-workspace-contracts';
import { personalToday } from '../../../shared/workspace-today';
import { Action, Block, Copy, Row } from './controls';

type Props = { view: WorkspaceView; busy: boolean; saved?: boolean; onTask: (id: string) => void; onEvent: (id: string) => void; onTasks: () => void; onCalendar: () => void; contextName?: string };
export function Today({ view, busy, saved = false, onTask, onEvent, onTasks, onCalendar, contextName = 'Personal' }: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  const today = personalToday(view, now);
  const when = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return <>
    <Copy heading>{contextName} Today</Copy>
    <Copy>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {Intl.DateTimeFormat().resolvedOptions().timeZone} (this device)</Copy>
    <Copy>{saved ? 'Saved Tasks and Calendar on this device, including pending changes. Reconnect and explicitly sync to share saved work.' : `${contextName} work from the last loaded online workspace. Refresh for saved changes.`} Calendar editors use UTC. Mail remains online-only.</Copy>
    <Block><Copy heading>Today’s plan</Copy>
      {!today.events.length && <Copy>No saved blocks today. Plan time in Calendar.</Copy>}
      {today.events.map(event => <Block key={event.id}><Copy heading>{event.title}</Copy><Copy>{when(event.start)} – {when(event.end)}{'\n'}{view.calendars.find(item => item.id === event.calendarId)?.name}</Copy><Action label={`Open block: ${event.title}`} disabled={busy} onPress={() => onEvent(event.id)} /></Block>)}
      <Action label="Plan time in Calendar" disabled={busy} onPress={onCalendar} />
    </Block>
    <Block><Copy heading>Planned today</Copy>
      {!today.planned.length && <Copy>No open tasks planned today.</Copy>}
      {today.planned.map(task => <Row key={task.id}><Action label={`Open task: ${task.title}`} disabled={busy} onPress={() => onTask(task.id)} /><Copy>{when(task.scheduledSlot!.start)}</Copy></Row>)}
      <Copy heading>Not yet planned</Copy>
      {!today.unplanned.length && <Copy>No unscheduled open tasks.</Copy>}
      {today.unplanned.map(task => <Action key={task.id} label={`Open task: ${task.title}`} disabled={busy} onPress={() => onTask(task.id)} />)}
      <Action label="Open all Tasks" disabled={busy} onPress={onTasks} />
    </Block>
  </>;
}
