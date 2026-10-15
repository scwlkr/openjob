import type { ScheduledSlot } from "./openjob-contracts";
import { scheduledSlotField } from "../shared/task-scheduling";
import styles from "./openjob.module.css";

export function scheduleInput(slot?: ScheduledSlot) {
  return {
    scheduledStart: slot?.start.replace(/Z$/, "") ?? "",
    scheduledEnd: slot?.end.replace(/Z$/, "") ?? "",
  };
}

export function scheduledSlotForInput(start: string, end: string) {
  if (!start && !end) return { value: null };
  if (!start || !end) return { error: "Choose both planned start and end, or clear planned work." };
  const timestamp = (value: string) => `${value.length === 16 ? `${value}:00` : value}Z`;
  return scheduledSlotField({ start: timestamp(start), end: timestamp(end) });
}

export function formatScheduledSlot(slot: ScheduledSlot) {
  const format = new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC",
  });
  return `Planned ${format.format(new Date(slot.start))} – ${format.format(new Date(slot.end))} UTC`;
}

export function TaskScheduleFields({ start, end, onChange }: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  return (
    <fieldset className={styles.taskScheduleField}>
      <legend className={styles.taskFieldLabel}>Planned work (UTC)</legend>
      <p>Separate from the due date.</p>
      <label>
        <span>Planned start (UTC)</span>
        <input type="datetime-local" step="0.001" value={start}
          onChange={(event) => onChange(event.target.value, end)} />
      </label>
      <label>
        <span>Planned end (UTC)</span>
        <input type="datetime-local" step="0.001" value={end}
          onChange={(event) => onChange(start, event.target.value)} />
      </label>
      {start || end ? (
        <button className={styles.taskScheduleClear} type="button" onClick={() => onChange("", "")}>
          Clear planned work
        </button>
      ) : null}
    </fieldset>
  );
}
