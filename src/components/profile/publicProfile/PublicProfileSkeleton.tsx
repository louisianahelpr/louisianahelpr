/**
 * /u/<handle> while the profile loads (share-profile audit L6, 2026-11-05). It was one text line, "Loading this profile…",
 * so the page jumped when the data landed. These bones take the hero card's shape (96px avatar, name, the meta line,
 * the trust line, a full-width button) and one section card below it, in the same column classes the page uses.
 */
import { Skeleton } from "@/components/ui/skeleton";

export function PublicProfileSkeleton({ column }: { column: string }) {
  return (
    <div role="status" aria-label="Loading this profile" className={`${column} space-y-4 pb-8`} data-testid="pp-skeleton">
      <span className="sr-only">Loading this profile…</span>
      {/* Owner 11-14 (Depop review item 10): below lg the header is compact (64px photo beside three short lines, the
          actions in one row) and the listings a 3-across grid, so the bones take that shape there. */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm max-lg:rounded-none max-lg:border-0 max-lg:p-0" data-pp-plain="" aria-hidden>
        <div className="max-lg:flex max-lg:items-center max-lg:gap-3">
          <Skeleton className="mx-auto h-24 w-24 rounded-full max-lg:mx-0 max-lg:h-16 max-lg:w-16 max-lg:shrink-0" />
          <div className="max-lg:flex-1">
            {/* The name (text-xl, 28px line, mt-3), the meta line (text-sm, 20px, mt-1), the trust line (mt-2). */}
            <div className="mt-3 flex h-7 items-center justify-center max-lg:mt-0 max-lg:h-6 max-lg:justify-start"><Skeleton className="h-5 w-36" /></div>
            <div className="mt-1 flex h-5 items-center justify-center max-lg:mt-0.5 max-lg:justify-start"><Skeleton className="h-3.5 w-48 max-lg:w-40" /></div>
            <div className="mt-2 flex h-5 items-center justify-center max-lg:mt-0.5 max-lg:justify-start"><Skeleton className="h-3.5 w-32" /></div>
          </div>
        </div>
        <Skeleton className="mt-4 h-10 w-full rounded-full max-lg:mt-3" />
      </div>
      <div className="h-11 border-b border-border lg:hidden" aria-hidden />
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm max-lg:rounded-none max-lg:border-0 max-lg:p-0" data-pp-plain="" aria-hidden>
        <Skeleton className="mb-3 h-4 w-28 max-lg:hidden" />
        <div className="grid grid-cols-3 gap-0.5 lg:grid-cols-4 lg:gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className={`aspect-square w-full rounded-none lg:rounded-xl${i > 3 ? " lg:hidden" : ""}`} />)}
        </div>
      </div>
    </div>
  );
}
