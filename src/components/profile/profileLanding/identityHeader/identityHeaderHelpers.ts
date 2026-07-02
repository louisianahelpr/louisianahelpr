/**
 * Pure formatting helpers extracted from IdentityHeader. No hooks, no
 * component state — safe to unit-test in isolation. Behaviour must stay
 * byte-identical to the inline logic they replaced.
 */

/**
 * Compact relative-time label for a review timestamp ("today", "3d ago",
 * "2w ago", "5mo ago", "1y ago"). Mirrors the inline `days`/`when` logic
 * that rendered next to each review preview. `now` is injectable only for
 * testing; production callers pass nothing so it uses `Date.now()`.
 */
export function relativeReviewTime(createdAt: string, now: number = Date.now()): string {
  const days = Math.max(
    0,
    Math.floor((now - new Date(createdAt).getTime()) / 86400000),
  );
  return (
    days < 1 ? "today" :
    days < 7 ? `${days}d ago` :
    days < 30 ? `${Math.floor(days / 7)}w ago` :
    days < 365 ? `${Math.floor(days / 30)}mo ago` :
    `${Math.floor(days / 365)}y ago`
  );
}

/**
 * Formats an intro-video duration in seconds to `M:SS` (e.g. 65 → "1:05").
 * Mirrors the inline `Math.floor(sec / 60):String(sec % 60).padStart(2,"0")`
 * used in the intro-video play row.
 */
export function formatVideoDuration(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
