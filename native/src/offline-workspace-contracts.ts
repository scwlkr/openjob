import type { PersonalWorkspaceCommand } from '../../shared/personal-workspace-contracts';
import type { TaskCalendarProjection, TaskCalendarSyncSnapshot, TaskCalendarSyncInput, TaskCalendarSyncAck } from '../../shared/task-calendar-sync';
export type { TaskCalendarProjection, TaskCalendarSyncSnapshot, TaskCalendarSyncInput, TaskCalendarSyncAck };
export type NativeOfflineWorkspaceRecord = {
  ownerUserId: string; revision: string; projection: TaskCalendarProjection;
  pending?: TaskCalendarSyncInput & { attempted: boolean };
};
export type NativeOfflineWorkspaceState = {
  projection?: TaskCalendarProjection; revision?: string;
  status: 'empty' | 'synced' | 'pending' | 'syncing' | 'conflict'; pendingCount: number;
  currentServer?: TaskCalendarSyncSnapshot; error?: string;
};
export type NativeOfflineWorkspaceCache = {
  load(owner: string, guard?: () => void): Promise<NativeOfflineWorkspaceRecord | null>;
  save(record: NativeOfflineWorkspaceRecord, guard?: () => void): Promise<void>;
  purge(): Promise<void>;
};
export type NativeOfflineWorkspaceController = {
  load(owner: string): Promise<NativeOfflineWorkspaceState>;
  refresh(owner: string): Promise<NativeOfflineWorkspaceState>;
  edit(owner: string, input: PersonalWorkspaceCommand): Promise<NativeOfflineWorkspaceState>;
  sync(owner: string): Promise<NativeOfflineWorkspaceState>;
  resolve(owner: string, choice: 'server' | 'local'): Promise<NativeOfflineWorkspaceState>;
};
