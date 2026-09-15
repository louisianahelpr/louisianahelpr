import { Skeleton } from "@/components/ui/skeleton";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { ApplicationCardSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { LoadingHeading } from "@/components/ui/LoadingHeading";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { ACTIVITY_HEADER_PADDING } from "@/pages/activity/ActivityHeader";

/**
 * ONE loading silhouette for My Jobs / My Posts, shared by the route fallback
 * (ActivityRouteSkeleton) and Activity.tsx's own loading branch (VN-32, owner
 * 2026-09-14: "this page jumps about 10 times before it settles").
 *
 * The two loading frames used to disagree with each other AND with the loaded
 * page, so a cold load moved the cards three times before any data arrived:
 *  - on the desktop website the loaded page is ONE box (the header is the
 *    panel's first row, `px-5 py-1` under a hairline) but both skeletons drew a
 *    floating title card plus a second box, so the first card sat ~46px lower
 *    than it would once loaded;
 *  - the page branch put its sr-only LoadingHeading INSIDE `space-y-2.5`,
 *    which still gave the first card a 10px top margin the route skeleton did
 *    not have (measured on prod at 1440: first skeleton card top 168 → 178).
 * This mirrors the loaded structure exactly: title card on phone/native, header
 * row inside the panel on the desktop website, and the list's own
 * `px-4 pt-3 space-y-2.5` with nothing hidden ahead of the first card.
 */
export function ActivityPageSkeleton({ tab }: { tab: "applied" | "posted" }) {
  const isWebDesktop = useIsWebDesktop();
  const headerRow = (
    <div className="flex items-center" style={{ minHeight: "44px" }} aria-hidden>
      <Skeleton className="h-4 w-32 rounded" />
    </div>
  );
  return (
    <PageScaffold titleCard={isWebDesktop ? undefined : headerRow} titleCardClassName={ACTIVITY_HEADER_PADDING}>
      <LoadingHeading
        title={tab === "posted" ? "My Posts" : "My Jobs"}
        message={tab === "posted" ? "Loading your posts…" : "Loading your jobs…"}
      />
      {isWebDesktop && (
        // 35px row: the loaded desktop header's measured content height (the
        // inline tab strip), not the 44px phone title-card row.
        <div className="shrink-0 px-5 py-1" style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}>
          <div className="flex items-center" style={{ minHeight: "35px" }} aria-hidden>
            <Skeleton className="h-4 w-32 rounded" />
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 px-4 pt-3 pb-0 space-y-2.5" aria-hidden>
        {tab === "applied"
          ? [1, 2, 3, 4].map((i) => <ApplicationCardSkeleton key={i} />)
          : [1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
      </div>
    </PageScaffold>
  );
}
