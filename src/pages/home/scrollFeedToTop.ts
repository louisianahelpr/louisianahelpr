/**
 * After clearing filters, snap the feed back to the top so the user lands on
 * the fresh unfiltered head of the list rather than mid-scroll where the old
 * filter ended.
 */
export function scrollFeedToTop(el: HTMLElement | null) {
  if (el) el.scrollTo({ top: 0, behavior: "smooth" });
}
