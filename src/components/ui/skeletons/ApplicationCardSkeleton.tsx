import { Skeleton } from "@/components/ui/skeleton";

/**
 * ApplicationCardSkeleton — shape-matched placeholder for the helper-
 * side application card (see `src/components/activity/AppliedJobCard.tsx`).
 *
 * Mirrors the real card's three-section layout:
 *   1. Header row: italic display title on the left, a payout chip on
 *      the right, separated by a hairline rule.
 *   2. Summary block: a date/location meta row + a one-line description
 *      preview + a "Posted by" attribution line.
 *   3. Action footer: a single action button row (the real card swaps
 *      this for Accept/Decline pairs depending on state — we use a
 *      single full-width bar as the average shape).
 *
 * Wraps the same `liquid-glass` surface as the real card so the
 * loading-to-loaded swap is visually stable.
 */
export function ApplicationCardSkeleton() {
  return (
    <div className="rounded-2xl liquid-glass overflow-hidden" aria-hidden>
      {/* Header — title + payout pill. */}
      <div
        className="w-full px-4 py-2.5 flex items-center justify-between"
        style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
      >
        <Skeleton
          className="h-4 w-[55%] rounded"
          style={{ background: "hsl(var(--olivewood) / 0.14)" }}
        />
        <Skeleton
          className="h-5 w-16 rounded-full shrink-0 ml-3"
          style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
        />
      </div>

      {/* Summary block — date/location meta row + description preview +
          poster attribution. */}
      <div className="px-4 py-3 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <Skeleton
            className="h-3 w-28 rounded"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          />
          <Skeleton
            className="h-3 w-24 rounded"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          />
        </div>
        <Skeleton
          className="h-3 w-[90%] rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
        <Skeleton
          className="h-3 w-[60%] rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
        <Skeleton
          className="h-3 w-32 rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
      </div>

      {/* Action footer — single full-width button placeholder. */}
      <div
        className="px-4 py-3"
        style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
      >
        <Skeleton
          className="h-9 w-full rounded-ds-md"
          style={{ background: "hsl(var(--olivewood) / 0.12)" }}
        />
      </div>
    </div>
  );
}
