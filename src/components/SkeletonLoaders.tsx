import { Skeleton } from "@/components/ui/skeleton";

export const JobCardSkeleton = () => (
  <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
    {/* Top bar */}
    <div className="px-4 py-2 border-b border-border/40 bg-muted/15 flex items-center justify-between">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-14" />
    </div>
    {/* Content */}
    <div className="px-4 py-3 space-y-2.5">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-22" />
      </div>
    </div>
    {/* Footer */}
    <div className="px-4 py-2 border-t border-border/40 bg-muted/15 flex items-center justify-between">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-4 w-16 rounded-full" />
    </div>
  </div>
);

export const ConversationSkeleton = () => (
  <div className="w-full p-4 rounded-xl border border-border bg-card space-y-2">
    <div className="flex items-center justify-between">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  </div>
);

export const ProfileCardSkeleton = () => (
  <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
    <Skeleton className="w-20 h-20 rounded-full mx-auto" />
    <Skeleton className="h-5 w-40 mx-auto" />
    <Skeleton className="h-3 w-24 mx-auto" />
    <Skeleton className="h-3 w-32 mx-auto" />
  </div>
);

export const StatsSkeleton = () => (
  <div className="grid grid-cols-3 gap-3">
    {[1, 2, 3].map((i) => (
      <div key={i} className="rounded-xl border border-border bg-card p-3 text-center space-y-2">
        <Skeleton className="h-8 w-12 mx-auto" />
        <Skeleton className="h-3 w-16 mx-auto" />
      </div>
    ))}
  </div>
);

export const ActivityCardSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="space-y-2 flex-1">
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-8 w-24 rounded-md" />
    </div>
    <div className="flex gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-20" />
    </div>
  </div>
);

export const DashboardSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-6 w-32" />
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  </div>
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
 * (75px avatar + name/stats stacked to its right) inside a 24px squircle card.
 */
export const IdentityHeroSkeleton = () => (
  <div className="rounded-[24px] bg-white shadow-[0_1px_2px_hsl(160_10%_12%/0.04),0_8px_28px_-12px_hsl(160_10%_12%/0.10)] p-4 flex items-center gap-4">
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
 * (Account / Money / Settings) at 24px squircle radius.
 */
export const MenuGroupCardSkeleton = () => (
  <div className="rounded-[24px] bg-white shadow-[0_1px_2px_hsl(160_10%_12%/0.04),0_8px_28px_-12px_hsl(160_10%_12%/0.10)] min-h-[78px] p-3 flex flex-col items-center justify-center gap-2">
    <Skeleton className="w-9 h-9 rounded-xl" />
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
