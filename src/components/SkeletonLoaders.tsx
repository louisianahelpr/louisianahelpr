import { Skeleton } from "@/components/ui/skeleton";

export const JobCardSkeleton = () => (
  // Glass-tinted skeleton shaped like a real job card — chip row at top
  // (urgent/category), title + price line, two columns of metadata, then
  // bottom apply-button placeholder. Each surface uses the .skeleton-glass
  // utility (champagne base + soft sweep) so the loading state matches
  // the real liquid-glass card visual language.
  <div className="rounded-2xl overflow-hidden skeleton-glass" style={{ borderRadius: "1rem" }}>
    {/* Header row: title + price tile */}
    <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-3">
      <div className="flex-1 space-y-2">
        <div className="flex gap-1.5">
          <Skeleton className="h-3.5 w-14 rounded-full" />
          <Skeleton className="h-3.5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-4 w-3/4 rounded" />
      </div>
      <Skeleton className="h-9 w-14 rounded-ds-md" />
    </div>
    {/* Metadata grid */}
    <div className="px-4 pb-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
      <Skeleton className="h-3 w-24 rounded" />
      <Skeleton className="h-3 w-20 rounded" />
      <Skeleton className="h-3 w-28 rounded" />
      <Skeleton className="h-3 w-16 rounded" />
    </div>
    {/* Footer: location + apply button */}
    <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.08)" }}>
      <Skeleton className="h-3 w-32 rounded" />
      <Skeleton className="h-7 w-20 rounded-full" />
    </div>
  </div>
);

export const ConversationSkeleton = () => (
  // Frosted glass placeholder shaped like a real conversation row —
  // avatar circle on the left, name + job + last-message lines on the
  // right. Matches the brand's liquid-glass material so the loading
  // state doesn't clash with the loaded UI.
  <div className="rounded-ds-md skeleton-glass p-3 flex items-center gap-3">
    <Skeleton className="w-10 h-10 rounded-full shrink-0" />
    <div className="flex-1 space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-3 w-12 rounded" />
      </div>
      <Skeleton className="h-3 w-24 rounded" />
      <Skeleton className="h-3 w-44 rounded" />
    </div>
  </div>
);

export const ProfileCardSkeleton = () => (
  <div className="rounded-2xl skeleton-glass p-6 text-center space-y-3">
    <Skeleton className="w-20 h-20 rounded-full mx-auto" />
    <Skeleton className="h-5 w-40 mx-auto" />
    <Skeleton className="h-3 w-24 mx-auto" />
    <Skeleton className="h-3 w-32 mx-auto" />
  </div>
);

export const StatsSkeleton = () => (
  <div className="grid grid-cols-3 gap-3">
    {[1, 2, 3].map((i) => (
      <div key={i} className="rounded-ds-md skeleton-glass p-3 text-center space-y-2">
        <Skeleton className="h-8 w-12 mx-auto" />
        <Skeleton className="h-3 w-16 mx-auto" />
      </div>
    ))}
  </div>
);

export const ActivityCardSkeleton = () => (
  // Glass-tinted skeleton shaped like a real activity card. Matches the
  // brand's liquid-glass material instead of the previous bordered card.
  <div className="rounded-ds-md skeleton-glass p-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="space-y-2 flex-1">
        <Skeleton className="h-5 w-40 rounded" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-8 w-24 rounded-md" />
    </div>
    <div className="flex gap-3">
      <Skeleton className="h-3 w-24 rounded" />
      <Skeleton className="h-3 w-20 rounded" />
    </div>
  </div>
);

/**
 * Greeting title-card skeleton — fills the PageScaffold title card while
 * the feed loads. Mirrors the real two-line block (large `text-page-title`
 * headline + a small uppercase date eyebrow) so the card doesn't change
 * height when the greeting resolves.
 */
export const DashboardTitleSkeleton = () => (
  <div className="space-y-2">
    <Skeleton className="h-7 w-1/2 rounded-md" />
    <Skeleton className="h-3 w-2/5 rounded" />
  </div>
);

/**
 * Dashboard panel-interior skeleton. Renders the SAME three-section
 * structure the loaded panel has — Picked-for-you / Nearby / Everything
 * else — each with its own shape-matched card skeleton variant. A single
 * uniform skeleton row across all three sections looked like one flat
 * list and caused a layout jump when the real, differently-sized cards
 * arrived; per-section variants reserve the right footprint up front so
 * the swap is silent (no CLS, no scroll-position re-anchor).
 */
export const DashboardSkeleton = () => (
  <>
    {/* CALM. This used to render the feed's real section headers — "Picked for
        you" and "Everything else", live colour, real icons, a real hairline
        rule — wrapped around ghost cards each built from six grey bars of
        differing widths, plus a header row with two button squares. Finished
        chrome around unfinished content reads as a BROKEN page, not a loading
        one, and the bar lattice gave it more visual detail than the real feed
        it stands in for.

        A skeleton's whole job is to hold the shape and then get out of the way.
        So: no invented section labels (they may not even be the sections that
        arrive), one soft silhouette per card instead of six bars, and the
        card's own footprint carried by height alone. The layout still reserves
        the same space, so nothing jumps when the feed lands. */}
    <div className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl skeleton-glass h-[104px]"
          style={{ borderRadius: "1rem" }}
        />
      ))}
    </div>
  </>
);

export const MessagesSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-40" />
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <ConversationSkeleton key={i} />
      ))}
    </div>
  </div>
);

/**
 * Identity hero skeleton — matches the new horizontal Profile header
 * (75px avatar + name/stats stacked to its right) inside a rounded-ds-lg squircle card.
 */
export const IdentityHeroSkeleton = () => (
  <div className="rounded-ds-lg bg-card shadow-[0_1px_2px_hsl(160_10%_12%/0.04),0_8px_28px_-12px_hsl(160_10%_12%/0.10)] p-4 flex items-center gap-4">
    <Skeleton className="w-[75px] h-[75px] rounded-2xl shrink-0" />
    <div className="flex-1 space-y-2.5">
      <Skeleton className="h-5 w-2/3 rounded-md" />
      <Skeleton className="h-3 w-1/2 rounded-md" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="h-4 w-12 rounded-full" />
      </div>
    </div>
  </div>
);

/**
 * Menu group card skeleton — one of the three "neighborhood" boxes
 * (Account / Money / Settings) at rounded-ds-lg squircle radius.
 */
export const MenuGroupCardSkeleton = () => (
  <div className="rounded-ds-lg bg-card shadow-[0_1px_2px_hsl(160_10%_12%/0.04),0_8px_28px_-12px_hsl(160_10%_12%/0.10)] min-h-[78px] p-3 flex flex-col items-center justify-center gap-2">
    <Skeleton className="w-9 h-9 rounded-ds-md" />
    <Skeleton className="h-3 w-12 rounded-md" />
  </div>
);

/**
 * Full Profile-page skeleton — identity hero + 3-up menu grid.
 * Bottom action row is intentionally omitted; the top + bottom nav are
 * rendered solid by the shell so they appear instantly.
 */
export const ProfilePageSkeleton = () => (
  <div className="space-y-3">
    <IdentityHeroSkeleton />
    <div className="grid grid-cols-3 gap-2.5">
      <MenuGroupCardSkeleton />
      <MenuGroupCardSkeleton />
      <MenuGroupCardSkeleton />
    </div>
  </div>
);
