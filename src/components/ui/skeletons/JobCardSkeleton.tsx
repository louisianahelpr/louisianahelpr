import { Skeleton } from "@/components/ui/skeleton";

/**
 * JobCardSkeleton — shape-matched placeholder for the browse-feed job
 * card (see `src/components/dashboard/JobCard.tsx`). Loading-state
 * transitions for the dashboard feed used to "thump" — a single grey
 * rectangle gave way to a 3-column row with an avatar, title block, and
 * a price tile. This skeleton mirrors that layout so the swap is
 * visually stable (no CLS): a 1px category rail down the left edge, a
 * 44px avatar circle on the left, title + meta lines in the center,
 * and the price tile on the right.
 *
 * The shimmer comes from the inner <Skeleton/> primitives — keep the
 * outer card static (overlapping sweeps read as moiré).
 */
export function JobCardSkeleton() {
  return (
    <div
      className="relative rounded-2xl border border-border/60 bg-card overflow-hidden shadow-[var(--card-shadow)]"
      aria-hidden
    >
      {/* Category rail — vertical 1px stripe down the left edge,
          matching the colored rail on the real card. Neutral
          olivewood tint while loading; the real card recolors per
          category. */}
      <span
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: "hsl(var(--olivewood) / 0.18)" }}
      />
      <div className="w-full px-3.5 py-3 flex items-center gap-3">
        {/* Avatar (44px) + faint category-icon chip overlay. */}
        <div className="relative shrink-0">
          <Skeleton
            className="w-11 h-11 rounded-full"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          />
          <Skeleton
            className="absolute -top-0.5 -left-0.5 w-4 h-4 rounded-full ring-2 ring-card"
            style={{ background: "hsl(var(--olivewood) / 0.16)" }}
          />
        </div>

        {/* Center: title + meta row. Title gets ~70% width to match
            the real card's leading display title, meta row ~50%. */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton
            className="h-4 w-[70%] rounded"
            style={{ background: "hsl(var(--olivewood) / 0.14)" }}
          />
          <Skeleton
            className="h-3 w-[50%] rounded"
            style={{ background: "hsl(var(--olivewood) / 0.10)" }}
          />
        </div>

        {/* Right: price tile + small badge above (mirrors the
            urgent/boosted cluster on the real card). */}
        <div className="relative shrink-0 flex flex-col items-end gap-1">
          <Skeleton
            className="absolute -top-1 -right-1 h-3.5 w-12 rounded-full"
            style={{ background: "hsl(var(--olivewood) / 0.16)" }}
          />
          <Skeleton
            className="h-12 w-16 rounded-ds-md"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * RecommendedJobCardSkeleton — shape-matched to the "Picked for you"
 * card in BrowseTasksFeed. Recommended cards lead with a sienna-tinted
 * category rail (it's the highlighted section), a longer title (~80%),
 * a 2-line description hint, and a slightly taller price tile. The
 * skeleton mirrors that ratio so the swap doesn't shove the list down.
 */
export function RecommendedJobCardSkeleton() {
  return (
    <div
      className="relative rounded-2xl border border-border/60 bg-card overflow-hidden shadow-[var(--card-shadow)]"
      aria-hidden
    >
      {/* Recommended-section accent rail — a touch warmer than the
          neutral skeleton (matches the sienna eyebrow above). */}
      <span
        className="absolute left-0 top-0 bottom-0 w-1.5"
        style={{ background: "hsl(var(--burnt-sienna) / 0.22)" }}
      />
      {/* Category-tab placeholder + tiny "New" chip. */}
      <span
        className="absolute top-0 left-0 z-10 inline-flex items-center gap-1 pl-3 pr-2.5 py-1 rounded-br-lg"
        style={{ background: "hsl(var(--burnt-sienna) / 0.10)" }}
      >
        <Skeleton className="h-2 w-12 rounded" style={{ background: "hsl(var(--burnt-sienna) / 0.20)" }} />
      </span>
      <div className="w-full px-3.5 pt-6 pb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {/* Title — recommended cards get more vertical room because
              the "best match" framing wants a longer headline. */}
          <Skeleton className="h-4 w-[80%] rounded" style={{ background: "hsl(var(--olivewood) / 0.14)" }} />
          <Skeleton className="h-3 w-[55%] rounded" style={{ background: "hsl(var(--olivewood) / 0.10)" }} />
          {/* Meta row — location · date · stars */}
          <div className="flex gap-2 pt-0.5">
            <Skeleton className="h-2.5 w-14 rounded" style={{ background: "hsl(var(--olivewood) / 0.09)" }} />
            <Skeleton className="h-2.5 w-10 rounded" style={{ background: "hsl(var(--olivewood) / 0.09)" }} />
            <Skeleton className="h-2.5 w-8 rounded" style={{ background: "hsl(var(--olivewood) / 0.09)" }} />
          </div>
        </div>
        {/* Price chip — compact, matching the real card's px-2.5 py-1.5
            amount tile. Kept small on purpose: a larger box read like a
            photo thumbnail, which the feed cards don't have. */}
        <div className="shrink-0">
          <Skeleton className="h-11 w-[52px] rounded-ds-md" style={{ background: "hsl(var(--bark) / 0.12)" }} />
        </div>
      </div>
    </div>
  );
}


