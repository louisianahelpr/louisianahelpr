/**
 * Declutter haul-away: the two pure pieces My listings needs at render (the
 * Post a Job link and "in N days"). Kept apart from ./haulAwayParam (the
 * predicates the server rule pins, loaded with ./haulAway) so the Declutter
 * screen imports nothing that Post a Job's haul-away code also imports: a
 * module two signed-in chunks share lands in the signed-in-shared chunk on
 * /posts' critical path (Q178).
 */

/** Most items one haul-away takes (the server refuses more: haul_away_too_many). */
export const HAUL_AWAY_MAX_ITEMS = 10;

/** The Post a Job link for these items. */
export function haulAwayPostJobPath(itemIds: string[]): string {
  return `/post-job?haulAway=${itemIds.slice(0, HAUL_AWAY_MAX_ITEMS).join(",")}`;
}

/** Whole days until a too-soon item can be hauled (at least 1). */
export function daysUntil(iso: string | null, now = Date.now()): number {
  if (!iso) return 1;
  return Math.max(1, Math.ceil((Date.parse(iso) - now) / 86_400_000));
}
