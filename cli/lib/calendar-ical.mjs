/** Deliberately bounded RFC5545 subset; no providers, invitations, recurrence or side effects. */
const LIMIT = 16 * 1024;
const encoder = new TextEncoder();
function fail(code = 'invalid_input') { throw Object.assign(new Error(code === 'calendar_ical_unsupported' ? 'This calendar file uses unsupported features.' : code === 'workspace_capacity' ? 'The calendar exceeds the supported file limits.' : 'The calendar file is invalid.'), { code }); }
function unicode(value) {
  if (typeof value !== 'string') fail();
  for (const character of value) { const point = character.codePointAt(0); if (point >= 0xd800 && point <= 0xdfff) fail(); }
  return value;
}
function text(value, maximum = 500, multiline = true) {
  unicode(value);
  if (!value.trim() || value.length > maximum || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(value) || !multiline && value.includes('\n')) fail();
  return value;
}
function decode(value, maximum = 500, multiline = true) {
  let decoded = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '\\') {
      const next = value[++index];
      if (next === 'n' || next === 'N') decoded += '\n';
      else if (next === '\\' || next === ',' || next === ';') decoded += next;
      else fail();
    } else { if (character === ',' || character === ';') fail(); decoded += character; }
  }
  return text(decoded, maximum, multiline);
}
function encode(value) { return text(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,'); }
function timestamp(value) {
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(value) || value.startsWith('0000')) fail();
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.000Z`;
  if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString() !== iso) fail();
  return iso;
}
function utc(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value || value.slice(20, 23) !== '000') fail('calendar_ical_unsupported');
  return value.slice(0, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
}
export function parseCalendarIcal(ical) {
  unicode(ical);
  if (encoder.encode(ical).length > LIMIT) fail('workspace_capacity');
  if (!ical.endsWith('\r\n') || /(^|[^\r])\n|\r(?!\n)/.test(ical) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(ical)) fail();
  const lines = [];
  for (const line of ical.slice(0, -2).split('\r\n')) {
    if (/^[ \t]/.test(line)) { if (!lines.length) fail(); lines[lines.length - 1] += line.slice(1); }
    else { if (!line) fail(); lines.push(line); }
  }
  if (lines.shift()?.toUpperCase() !== 'BEGIN:VCALENDAR' || lines.pop()?.toUpperCase() !== 'END:VCALENDAR') fail();
  const calendar = new Map(); const events = []; const uids = new Set(); let event = null; let sawEvent = false;
  for (const line of lines) {
    const split = line.indexOf(':'); if (split < 1) fail();
    const name = line.slice(0, split).toUpperCase(); const value = line.slice(split + 1);
    if (name.includes(';')) fail('calendar_ical_unsupported');
    if (name === 'BEGIN') { if (event || value.toUpperCase() !== 'VEVENT') fail('calendar_ical_unsupported'); event = new Map(); sawEvent = true; continue; }
    if (name === 'END') {
      if (!event || value.toUpperCase() !== 'VEVENT') fail('calendar_ical_unsupported');
      if (['UID', 'SUMMARY', 'DTSTART', 'DTEND', 'DTSTAMP'].some(key => !event.has(key))) fail();
      const uid = decode(event.get('UID'), 255, false); if (uids.has(uid)) fail(); uids.add(uid);
      const title = decode(event.get('SUMMARY')); const start = timestamp(event.get('DTSTART')); const end = timestamp(event.get('DTEND')); timestamp(event.get('DTSTAMP'));
      if (start >= end) fail(); events.push({ uid, title, start, end }); if (events.length > 50) fail('workspace_capacity'); event = null; continue;
    }
    const target = event ?? calendar;
    if (!(event ? ['UID', 'SUMMARY', 'DTSTART', 'DTEND', 'DTSTAMP'] : ['VERSION', 'PRODID', 'CALSCALE']).includes(name)) fail('calendar_ical_unsupported');
    if (!event && sawEvent) fail();
    if (target.has(name)) fail(); target.set(name, value);
  }
  if (event || calendar.get('VERSION') !== '2.0' || !calendar.has('PRODID')) fail();
  decode(calendar.get('PRODID'), 500, false);
  if (calendar.has('CALSCALE') && calendar.get('CALSCALE').toUpperCase() !== 'GREGORIAN') fail('calendar_ical_unsupported');
  return events;
}
async function hash(value) { const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value))); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function calendarIcalOpaqueUid(owner, calendarId, eventId) { return `oj_${await hash([owner, calendarId, eventId])}@openjob.invalid`; }
export async function calendarIcalImportId(owner, calendarId, uid) { return `ical_${await hash([owner, calendarId, uid])}`; }
function selected(view, calendarId) {
  if (!view || typeof calendarId !== 'string' || !calendarId || calendarId.length > 128) fail();
  const calendar = view.calendars.find(calendar => calendar.id === calendarId); if (!calendar) fail('forbidden');
  if (typeof calendar.ownerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(calendar.ownerId)) fail();
  const events = view.events.filter(event => event.calendarId === calendarId).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { calendar, events };
}
export async function calendarIcalRevision(view, calendarId) {
  const { calendar, events } = selected(view, calendarId);
  return `ci1_${await hash([calendar.ownerId, calendar.id, events.map(({ id, title, start, end }) => [id, title, start, end])])}`;
}
export async function previewCalendarIcalImport(view, calendarId, ical) {
  selected(view, calendarId); const events = parseCalendarIcal(ical);
  return { calendarId, expectedRevision: await calendarIcalRevision(view, calendarId), events };
}
function fold(line) {
  const lines = []; let current = ''; let bytes = 0;
  for (const character of unicode(line)) { const width = encoder.encode(character).length; if (bytes + width > 75) { lines.push(current); current = ' '; bytes = 1; } current += character; bytes += width; }
  lines.push(current); return lines.join('\r\n');
}
export async function createCalendarIcalExport(view, calendarId, now = new Date()) {
  const { calendar, events } = selected(view, calendarId); if (events.length > 50) fail('workspace_capacity');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail();
  const dtstamp = utc(new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenJob//Calendar Export//EN', 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    const start = utc(event.start); const end = utc(event.end); if (start >= end) fail();
    lines.push('BEGIN:VEVENT', `UID:${await calendarIcalOpaqueUid(calendar.ownerId, calendarId, event.id)}`, `DTSTAMP:${dtstamp}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${encode(event.title)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR'); const ical = lines.map(fold).join('\r\n') + '\r\n';
  if (encoder.encode(ical).length > LIMIT) fail('workspace_capacity');
  return { calendarId, filename: 'openjob-calendar.ics', contentType: 'text/calendar; charset=utf-8', ical };
}
