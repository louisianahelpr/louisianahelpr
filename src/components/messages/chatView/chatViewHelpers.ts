import type { Message } from "../types";
import type { JobSystemEvent, JobSystemEventKind } from "@/lib/jobSystemEvents";
import type { TimelineItem } from "./types";

// Format the divider label for a given message timestamp. "Today",
// "Yesterday", or the locale's short date — read at a glance without
// the full year noise for current-week messages.
export const dateDividerLabel = (d: Date): string => {
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOf(now);
  const that = startOf(d);
  const diffDays = Math.round((today - that) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)
    return d.toLocaleDateString("en-US", { weekday: "long" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

// iMessage-style read receipt: only the CURRENT USER's most recent
// *settled* outbound message carries a "Read"/"Delivered" indicator —
// not every bubble. Derived from the messages already in state (no new
// query). We walk from the end and take the first non-system,
// fully-sent message we sent.
export function resolveLastOwnMessageId(
  messages: Message[],
  userId: string | null,
): string | null {
  if (!userId) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.sender_id === userId &&
      !m.is_system &&
      m.sendStatus === undefined
    ) {
      return m.id;
    }
  }
  return null;
}

// Resolve the first-unread id from the loaded messages. We look at the
// LAST N inbound (where N == unread count) and take the earliest as the
// jump target — these are the unread messages the user hasn't seen yet.
export function resolveFirstUnreadTargetId(
  messages: Message[],
  userId: string,
  unreadCount: number,
): string | null {
  const inboundFromMe = messages.filter((m) => m.receiver_id === userId);
  const count = Math.min(unreadCount, inboundFromMe.length);
  if (count > 0) {
    const target = inboundFromMe[inboundFromMe.length - count];
    return target.id;
  }
  return null;
}

// Build the merged, date-divided timeline from messages + system events.
export function buildTimeline(
  messages: Message[],
  jobSystemEvents: JobSystemEvent[],
  hasMoreMessages: boolean,
): TimelineItem[] {
  // Two independent mechanisms describe the same job transitions, and a
  // cancelled thread showed BOTH: a derived jobSystemEvent pill reading "Job
  // cancelled by helper." and, right under it, a stored is_system message
  // reading "Job cancelled". Same fact, twice, in two different visual idioms.
  //
  // The derived event wins because it names WHO acted and carries a timestamp;
  // the stored row is the older, blunter version of the same announcement. So
  // a stored system message is dropped when a derived event already covers
  // that transition. Matching is on the transition KIND, not on wording — the
  // two strings are deliberately phrased differently, so comparing text would
  // never dedupe them.
  const coveredKinds = new Set(jobSystemEvents.map((e) => e.kind));
  // Each derived event kind, paired with what the older stored wording for the
  // same transition looks like. Kinds are checked against the real
  // JobSystemEventKind union, so a renamed kind fails the build rather than
  // silently un-deduping.
  const DUPLICATE_PATTERNS: { kind: JobSystemEventKind; matches: RegExp }[] = [
    { kind: "cancelled", matches: /\bcancell?ed\b/i },
    { kind: "disputed", matches: /\bdisput/i },
    { kind: "poster_confirmed_completed", matches: /\bcomplete/i },
    { kind: "helper_completed", matches: /\bcomplete/i },
  ];
  const isDuplicateStoredSystem = (m: Message): boolean => {
    if (!m.is_system) return false;
    const text = m.content ?? "";
    return DUPLICATE_PATTERNS.some((p) => coveredKinds.has(p.kind) && p.matches.test(text));
  };

  const items: TimelineItem[] = messages
    .filter((m) => !isDuplicateStoredSystem(m))
    .map((m) => ({
      type: "message",
      key: m.clientId ?? m.id,
      at: m.created_at,
      message: m,
    }));
  // Only include system events that fall within the loaded window —
  // anything older than the oldest message stays hidden until the
  // user loads earlier messages (otherwise paginated history would
  // surface system rows out of order at the top of the visible thread).
  if (jobSystemEvents.length > 0) {
    const oldestLoadedAt = messages.length > 0
      ? new Date(messages[0].created_at).getTime()
      : -Infinity;
    const onlyWhenAllLoaded = hasMoreMessages;
    for (const ev of jobSystemEvents) {
      const evMs = new Date(ev.at).getTime();
      // If older messages still exist server-side, only show system
      // events that occurred after the oldest message we have loaded.
      if (onlyWhenAllLoaded && evMs < oldestLoadedAt) continue;
      items.push({
        type: "system",
        key: ev.id,
        at: ev.at,
        event: ev,
      });
    }
  }
  items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // Insert date dividers between items that cross a day boundary so the
  // thread reads as a dated transcript ("Today" / "Yesterday" / a
  // formatted date) rather than an undifferentiated wall of bubbles.
  const dated: TimelineItem[] = [];
  let prevDayKey: string | null = null;
  for (const item of items) {
    const d = new Date(item.at);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dayKey !== prevDayKey) {
      dated.push({
        type: "date",
        key: `date-${dayKey}`,
        at: item.at,
        label: dateDividerLabel(d),
      });
      prevDayKey = dayKey;
    }
    dated.push(item);
  }
  return dated;
}
