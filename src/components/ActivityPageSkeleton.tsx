import { Skeleton } from "@/components/ui/skeleton";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { ApplicationCardSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { LoadingHeading } from "@/components/ui/LoadingHeading";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { POSTS_HEADER_PADDING } from "@/pages/posts/PostsHeader";
import { JOBS_HEADER_PADDING } from "@/pages/jobs/JobsHeader";

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
  /**
   * THE TAB ROW IS PART OF THE TITLE CARD, so the placeholder reserves it.
   *
   * Owner, 2026-09-21: "/jobs … jumps really bad". Measured on prod
   * (helper-e2e, Chromium at 375, this checkout's local build, 2026-09-21):
   * the first PLACEHOLDER card's top sat at y=95 and the first REAL card's at
   * y=138 — the whole list, every card, slid 43px DOWN the instant the data
   * landed. The 43px is this row: the page header (PostsHeader on My Posts,
   * JobsHeader on My Jobs) renders the five status tabs
   * (`You · Waiting · Soon · Done · Cancel`) on their own line under the
   * title on phone whenever that row is open, and a placeholder that draws
   * only the 44px title line describes a different screen. The row is 41px;
   * the arithmetic below agrees.
   *
   * Sized from the real row's own box rather than by eye: `py-[13px]` on a
   * `text-ds-11 leading-none` label (UnderlineTabs, phone = not `dense`) is
   * 13 + 11 + 13 = 37px, in a wrapper carrying `pb-0.5`. Bones stand in for
   * the five labels at roughly their measured widths, because a reader who
   * sees one 32px bone where five words are coming has been told the wrong
   * shape even when the height is right.
   *
   * NOT reserved on the desktop website: there the tabs ride INSIDE the
   * header row (`inlineFilters`), which the `isWebDesktop` branch below
   * already sizes at its measured 35px.
   */
  const headerRow = (
    <div aria-hidden>
      <div className="flex items-center" style={{ minHeight: "44px" }}>
        <Skeleton className="h-4 w-32 rounded" />
      </div>
      {!isWebDesktop && (
        // The real scroller's box, class for class (`-mx-5 px-5 … pb-0.5`), so
        // the reserved line cannot drift from the line it reserves.
        <div className="-mx-5 px-5 pb-0.5 overflow-hidden">
          {/* 13 + 15 + 13 = 41px, which is the real row MEASURED at 375 (the
              tab's own `py-[13px]` around a line box that is taller than its
              11px label, because UnderlineTabs baseline-aligns the label with
              a `text-ds-9` count beside it). Reserving 11px for the label
              alone left the whole panel 4px high, which is 4px every card
              inherits. */}
          <div className="flex items-baseline gap-3" style={{ paddingTop: "13px", paddingBottom: "13px" }}>
            {[24, 42, 30, 30, 36].map((w, i) => (
              <Skeleton key={i} className="h-[15px] rounded" style={{ width: `${w}px` }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
  return (
    <PageScaffold titleCard={isWebDesktop ? undefined : headerRow} titleCardClassName={tab === "posted" ? POSTS_HEADER_PADDING : JOBS_HEADER_PADDING}>
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
      {/* `space-y-3`, which is what BOTH loaded lists use (AppliedJobsTab and
          PostedJobsTab: `space-y-3 ds-activity-grid`, and the grouped
          ActivitySectionedView the same). It said `space-y-2.5` — 10px against
          the real 12px — so even once each card reserved the right HEIGHT the
          pitch was 2px short per row and the list crept upward as it went:
          measured at 375, placeholder card 4 landed 13px above the real one.
          A gap is part of the reservation. */}
      <div className="flex-1 min-h-0 px-4 pt-3 pb-0 space-y-3" aria-hidden>
        {tab === "applied"
          ? [1, 2, 3, 4].map((i) => <ApplicationCardSkeleton key={i} />)
          : [1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
      </div>
    </PageScaffold>
  );
}
