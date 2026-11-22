/**
 * "Add to calendar" for a Holiday Hub light display or event (holiday audit 1121 area 5 #20): one all-day calendar
 * entry (RFC 5545 .ics) from its own dates, so it opens in Apple Calendar, Google Calendar or Outlook. Only an item
 * with a confirmed start day gets one (never a made-up date): a one-day item is that day, a run is its first day
 * through its last (DTEND is the day after, as all-day entries need). Hours stay in the description: they are free text
 * ("10 am-5 pm (Sun to 4 pm)"), so the entry is all-day rather than a guessed time.
 */
export interface IcsItem {
  id: string;
  name: string;
  start: string | null;
  end: string | null;
  tba: boolean;
  hours: string | null;
  address: string | null;
  city: string | null;
  url: string | null;
  note: string | null;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets fold onto continuation lines that start with a space. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

const ymd = (d: string) => d.replace(/-/g, "");
const dayAfter = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** The item's .ics text, or null when it has no confirmed start day. `now` stamps the entry (DTSTAMP). */
export function holidayIcs(item: IcsItem, now: Date): string | null {
  if (item.tba || !item.start || !/^\d{4}-\d{2}-\d{2}$/.test(item.start)) return null;
  const last = item.end && /^\d{4}-\d{2}-\d{2}$/.test(item.end) && item.end >= item.start ? item.end : item.start;
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const where = [item.address, item.city].filter(Boolean).join(", ");
  const about = [item.hours, item.note, item.url].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Louisiana Helpr//Holiday Hub//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${item.id}@louisianahelpr.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(item.start)}`,
    `DTEND;VALUE=DATE:${ymd(dayAfter(last))}`,
    `SUMMARY:${esc(item.name)}`,
    ...(where ? [`LOCATION:${esc(where)}`] : []),
    ...(about ? [`DESCRIPTION:${esc(about)}`] : []),
    ...(item.url && /^https:\/\//.test(item.url) ? [`URL:${item.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** A safe file name for the entry: the item's id. */
export const holidayIcsName = (item: Pick<IcsItem, "id">) => `${item.id.replace(/[^a-z0-9-]/gi, "-")}.ics`;
