import type { WorkspaceView, WorkspaceTask, WorkspaceCalendar, WorkspaceEvent, WorkspaceDraft } from './workspace-contracts';
import * as implementation from '../cli/lib/workspace-export.mjs';

export type WorkspaceExportSection = 'tasks' | 'calendar' | 'drafts';
export type WorkspaceExport = {
  format: 'openjob-personal-export'; version: 1; exportedAt: string;
  context: { kind: 'personal'; ownerUserId: string }; sections: WorkspaceExportSection[];
  tasks: Omit<WorkspaceTask, 'sourceMessageId' | 'sourceAccountId'>[];
  calendars: Omit<WorkspaceCalendar, 'accountId'>[];
  events: WorkspaceEvent[];
  drafts: (Omit<WorkspaceDraft, 'messageId'> & { mode: 'fixture' })[];
};
export const WORKSPACE_EXPORT_MAX_BYTES = implementation.WORKSPACE_EXPORT_MAX_BYTES;
export const normalizeExportSections = implementation.normalizeExportSections as (value: unknown) => WorkspaceExportSection[];
export const validateWorkspaceExport = implementation.validateWorkspaceExport as (value: unknown) => WorkspaceExport;
export const createWorkspaceExport = implementation.createWorkspaceExport as (owner: string, view: WorkspaceView, sections: WorkspaceExportSection[], now?: Date) => WorkspaceExport;
