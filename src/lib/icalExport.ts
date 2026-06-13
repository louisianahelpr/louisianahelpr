/**
 * Generates an iCalendar (.ics) string for a single job event.
 * Works cross-platform: iOS/Android import via native share/download,
 * web browsers via an <a download> link.
 */
export interface CalendarJobEvent {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  dateNeeded: string;        // "YYYY-MM-DD"
  startTime: string | null;  // "HH:MM:SS" or "HH:MM"
  estimatedHours: number | null;
}

function toIcsDate(date: Date): string {
  // UTC compact format: 20260615T140000Z
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcsString(job: CalendarJobEvent): string {
  const dateStr = job.dateNeeded; // "YYYY-MM-DD"
  const [year, month, day] = dateStr.split("-").map(Number);

  let startHour = 9, startMin = 0;
  if (job.startTime) {
    const parts = job.startTime.split(":").map(Number);
    startHour = parts[0] ?? 9;
    startMin = parts[1] ?? 0;
  }

  const start = new Date(year, month - 1, day, startHour, startMin, 0);
  const durationHours = job.estimatedHours ?? 2;
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

  const dtStart = toIcsDate(start);
  const dtEnd = toIcsDate(end);
  const now = toIcsDate(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Louisiana Helpr//Helpr//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${job.id}@louisianahelpr.com`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcs(job.title)}`,
    job.location ? `LOCATION:${escapeIcs(job.location)}` : null,
    job.description ? `DESCRIPTION:${escapeIcs(job.description.slice(0, 500))}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");

  return lines;
}

export function downloadIcs(job: CalendarJobEvent): void {
  const ics = buildIcsString(job);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `helpr-job-${job.id.slice(0, 8)}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
