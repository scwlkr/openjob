export type ScheduledSlot = { start: string; end: string };

// Explicit offsets avoid interpreting an agent's local time in the server zone.
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = TIMESTAMP.exec(value);
  if (!match) return null;
  const [, date, hour, minute, second, , offset] = match;
  const dateValue = new Date(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(dateValue.getTime()) ||
    dateValue.toISOString().slice(0, 10) !== date ||
    Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
    (offset !== "Z" &&
      (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))
  ) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    milliseconds >= 0 && milliseconds <= 253402300799999
    ? new Date(milliseconds).toISOString()
    : null;
}

export function scheduledSlotField(value: unknown):
  | { value: ScheduledSlot | null }
  | { error: string } {
  if (value === null) return { value: null };
  if (
    value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 2 && "start" in value && "end" in value
  ) {
    const start = instant(value.start);
    const end = instant(value.end);
    if (start && end && start < end) return { value: { start, end } };
  }
  return {
    error: "Use start and end timestamps with explicit time zones (1970–9999); end must follow start, or use null to clear.",
  };
}
