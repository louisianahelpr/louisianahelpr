/**
 * When a Declutter chat line was sent, or until when a chat is open (order chat, handover chat). AUD31-12 (audit
 * 2026-10-31): a message from 9 days ago read "Thu 1:06 AM", the weekday alone, so it looked like this week. Within
 * 6 days either way the weekday says it ("Thu 1:06 AM"); further out the date does ("Oct 22, 1:06 AM"), with the year
 * only when it is not this year.
 */
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

export function talkTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (Math.abs(now.getTime() - d.getTime()) <= SIX_DAYS_MS) {
    return d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
