/**
 * Board 163 / Q2265: the quick tags a Declutter review may carry, per side. The server's list is
 * declutter_review_tags_for (migration 20261021023530); src/lib/declutter/reviewTags.test.ts pins the two equal.
 */
export const REVIEW_TAGS = {
  /** The buyer, about the seller. */
  buyer: [
    ["as_described", "As described"],
    ["easy_pickup", "Easy pickup"],
    ["friendly", "Friendly"],
    ["fair_price", "Fair price"],
  ],
  /** The seller, about the buyer. */
  seller: [
    ["on_time", "Showed up on time"],
    ["paid_fast", "Paid fast"],
    ["friendly", "Friendly"],
    ["easy_to_deal", "Easy to deal with"],
  ],
} as const satisfies Record<"buyer" | "seller", readonly (readonly [string, string])[]>;

const LABEL: Record<string, string> = Object.fromEntries([...REVIEW_TAGS.buyer, ...REVIEW_TAGS.seller]);

/** The words for a tag a reviewer on `side` chose; unknown tags have none (never shown raw). */
export function reviewTagLabel(tag: string): string | null {
  return LABEL[tag] ?? null;
}

/** The most-given tags across reviews, most first, ties by the list order; at most `max`. */
export function topReviewTags(tagLists: readonly (readonly string[] | null | undefined)[], max = 2): { tag: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tags of tagLists) for (const t of new Set(tags ?? [])) if (LABEL[t]) counts.set(t, (counts.get(t) ?? 0) + 1);
  const order: string[] = [...REVIEW_TAGS.buyer, ...REVIEW_TAGS.seller].map(([t]) => t);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .slice(0, max)
    .map(([tag, count]) => ({ tag, label: LABEL[tag], count }));
}
