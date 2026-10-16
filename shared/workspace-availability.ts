import type { WorkspaceView } from './workspace-contracts';
import * as implementation from '../cli/lib/workspace-availability.mjs';
export type TaskSlot = { start: string; end: string };
export type AvailabilityInput = TaskSlot & { taskId: string; durationMinutes: number };
export const findAvailableTaskSlots = implementation.findAvailableTaskSlots as (view: WorkspaceView, input: AvailabilityInput) => TaskSlot[];
export const assertTaskSlotAvailable = implementation.assertTaskSlotAvailable as (view: WorkspaceView, input: TaskSlot & { taskId: string }) => void;
