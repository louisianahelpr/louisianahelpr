import type { LastActiveLabel } from "./types";

// Active-cohort label (#5). Cohort-based copy ("Active today" / "Active
// this week") instead of exact "2h ago" — a privacy nudge so a viewer
// can't pattern-match someone's online routine. Same two visual states
// as before: "live" (green pulse) within 10 minutes, muted olivewood
// otherwise. Returns null beyond 7 days so stale presence doesn't
// mislead. The "Active now" label stays because it's already a coarse
// 10-minute bucket, not a real-time indicator.
export function computeLastActiveLabel(lastActiveAt: Date | null): LastActiveLabel | null {
  if (!lastActiveAt) return null;
  const ms = Date.now() - lastActiveAt.getTime();
  if (ms < 0) return null; // clock skew safeguard
  if (ms < 10 * 60_000) return { text: "Active now", isLive: true };
  if (ms < 24 * 60 * 60_000) return { text: "Active today", isLive: false };
  if (ms < 7 * 24 * 60 * 60_000) return { text: "Active this week", isLive: false };
  return null;
}
