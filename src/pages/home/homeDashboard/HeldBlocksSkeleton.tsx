import { Skeleton } from "@/components/ui/skeleton";

/**
 * F204 (lead 11-09): while a first visit holds the blocks under Next up (useHoldWhileFirstVisitReads, up to 10 s on a
 * slow phone), their place shows bones, never blank ground: Coming up's header and two rows (main), or the money tile
 * and the section chips (the desktop side column). The bones are removed as the blocks arrive in the same place, so
 * nothing that stays on screen moves; bones are never a page's largest paint (no text, no image).
 */
export function HeldBlocksSkeleton({ side = false }: { side?: boolean }) {
  if (side) {
    return (
      <div data-home-held="side" aria-hidden className="hidden xl:flex flex-col gap-2 min-w-0">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-4 w-28 mt-2 rounded-ds-md" />
        <div className="flex flex-wrap gap-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-11 w-32 rounded-full" />)}
        </div>
      </div>
    );
  }
  return (
    <div data-home-held="main" aria-hidden className="flex flex-col gap-2">
      <div className="px-1">
        <Skeleton className="h-4 w-24 rounded-ds-md" />
      </div>
      <div className="liquid-glass overflow-hidden">
        {[0, 1].map((i) => (
          <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? "border-b border-border/70" : ""}`}>
            <Skeleton className="w-10 h-10 shrink-0 rounded-full" />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <Skeleton className="h-4 w-40 max-w-full rounded-ds-md" />
              <Skeleton className="h-3.5 w-52 max-w-full rounded-ds-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
