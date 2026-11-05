/**
 * How many of a member's own listings are for sale right now: status 'live' only (owner request 11-05, "add the number
 * next to sell so I can see how many items I'm selling"). Paused, waiting for a review, sold and taken-down listings
 * are not for sale. ONE rule for every place that says it: Declutter's Selling tab and Home's "You're selling" line.
 * Kept free of imports so Home can use it without pulling Declutter's code into its chunk.
 */
export function liveListingCount(items: ReadonlyArray<{ status: string }>): number {
  return items.filter((i) => i.status === "live").length;
}
