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
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm" aria-hidden>
        <Skeleton className="mx-auto h-24 w-24 rounded-full" />
        {/* The name (text-xl, 28px line, mt-3), the meta line (text-sm, 20px, mt-1), the trust line (mt-2). */}
        <div className="mt-3 flex h-7 items-center justify-center"><Skeleton className="h-5 w-36" /></div>
        <div className="mt-1 flex h-5 items-center justify-center"><Skeleton className="h-3.5 w-48" /></div>
        <div className="mt-2 flex h-5 items-center justify-center"><Skeleton className="h-3.5 w-32" /></div>
        <Skeleton className="mt-4 h-10 w-full rounded-full" />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-hidden>
        <Skeleton className="mb-3 h-4 w-28" />
        <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-square w-full rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}
