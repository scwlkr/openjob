const OPENJOB_RFC3339_TIMESTAMP =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{3}|\d{6}|\d{9}))?Z$/;

export function isOpenJobTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = OPENJOB_RFC3339_TIMESTAMP.exec(value);
  if (!match || match[1] === "0000") return false;
  const [, year, month, day, hour, minute, second] = match;
  const wholeSecond = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const milliseconds = Date.parse(wholeSecond);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() ===
      `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}
