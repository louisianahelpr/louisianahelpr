/**
 * Which Declutter items this app run already reported a view for (owner request 11-05), kept apart from
 * itemViews.ts so sign-out can clear it without pulling the item-views code onto boot: the next account on
 * this device must get its own first view of an item counted (Q724).
 */
export const sent = new Set<string>();

/** Forget which items this session already reported (sign-out, and the tests). */
export function resetSentItemViews() {
  sent.clear();
}
