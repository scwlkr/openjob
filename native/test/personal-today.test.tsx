import { AppState, type AppStateStatus } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { Today } from '../src/personal-workspace/Today';
import { OpenJobThemeProvider } from '../src/theme';
import type { WorkspaceView } from '../src/personal-workspace-contracts';

it('rolls the device-local day forward on the timer and foreground return', async () => {
  jest.useFakeTimers();
  const intervals = jest.spyOn(globalThis, 'setInterval');
  const clears = jest.spyOn(globalThis, 'clearInterval');
  const initial = new Date(2026, 9, 17, 23, 59, 50);
  jest.setSystemTime(initial);
  let foreground: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => { foreground = callback; return { remove }; });
  const start = new Date(2026, 9, 18, 9).toISOString(); const end = new Date(2026, 9, 18, 10).toISOString();
  const view: WorkspaceView = { accounts: [], messages: [], tasks: [], calendars: [{ id: 'personal', ownerId: 'alex', name: 'Personal', color: '#123456' }], events: [{ id: 'tomorrow', calendarId: 'personal', title: 'Tomorrow planning', start, end }], drafts: [], sent: [], agents: [], activity: [] };
  try {
    const tree = await render(<OpenJobThemeProvider preference="light" setPreference={() => undefined}><Today view={view} busy={false} onTask={jest.fn()} onEvent={jest.fn()} onTasks={jest.fn()} onCalendar={jest.fn()} /></OpenJobThemeProvider>);
    expect(screen.queryByRole('button', { name: 'Open block: Tomorrow planning' })).toBeNull();
    await act(async () => { jest.advanceTimersByTime(30000); });
    expect(screen.getByRole('button', { name: 'Open block: Tomorrow planning' })).toBeTruthy();
    jest.setSystemTime(new Date(2026, 9, 19, 9));
    await act(async () => foreground?.('active'));
    expect(screen.queryByRole('button', { name: 'Open block: Tomorrow planning' })).toBeNull();
    await tree.unmount(); expect(remove).toHaveBeenCalledTimes(1); const index = intervals.mock.calls.findIndex(call => call[1] === 30000); expect(index).toBeGreaterThanOrEqual(0); expect(clears).toHaveBeenCalledWith(intervals.mock.results[index]!.value);
  } finally { listener.mockRestore(); intervals.mockRestore(); clears.mockRestore(); jest.useRealTimers(); }
});
