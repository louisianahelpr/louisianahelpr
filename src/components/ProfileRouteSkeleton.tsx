import AppShell from "@/components/AppShell";
import { ProfilePageSkeleton } from "@/components/SkeletonLoaders";
import ProfileTabFallback from "@/components/profile/ProfileTabFallback";
import { EarningsPageSkeleton, isEarningsTabUrl } from "@/components/profile/earningsTab/EarningsPageSkeleton";
import { resolveTab } from "@/pages/profile/types";

/**
 * Suspense fallback for the `/profile` route's lazy chunk.
 *
 * Same defect and same fix as DashboardRouteSkeleton / ActivityRouteSkeleton:
 * `/profile` used routeEl's default `RouteSuspenseFallback`, so a cold
 * 375x812 slow-3G load painted the generic bones column (no shell, no header
 * inset, no dock clearance) → Profile.tsx's own `loading` branch → content.
 * Three frames, two of them different shapes.
 *
 * This is Profile.tsx's `loading` branch (`Profile.tsx:513-530`) lifted into
 * the eager bundle: the SAME `AppShell` props, the SAME container string, the
 * SAME `ProfilePageSkeleton`. Profile is the one main screen not built on
 * PageScaffold, so this must use AppShell directly — matching the page, per
 * CLAUDE.md's shell rule. `/profile` is correctly absent from
 * DOCUMENT_SCROLL_ROUTES (AppShell owns its own internal scroll container),
 * and this fallback does not change that.
 *
 * Cheap to import eagerly: AppShell is already in the entry chunk (PageScaffold
 * wraps it for DashboardRouteSkeleton) and SkeletonLoaders imports nothing but
 * the Skeleton primitive.
 */
const ProfileRouteSkeleton = () => {
  // The tab is in the URL, so it is knowable in THIS frame — the first of the
  // three a cold deep link paints. Same resolver Profile.tsx uses, so a typo'd
  // or retired `?tab=` lands on "landing" here exactly as it will there.
  const tab = resolveTab(new URLSearchParams(window.location.search).get("tab"));
  return (
  <div role="status" aria-live="polite" aria-busy="true" data-testid="profile-route-skeleton">
    <span className="sr-only">Loading your profile…</span>
    <AppShell
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page pt-safe-top"
    >
      {/* The container string stays CHARACTER-FOR-CHARACTER Profile.tsx's, and
          on 2026-09-20 it lost `pt-3 lg:pt-5` there: the landing now renders
          its own `<PageHeader>` (the owner's "align the landing title to
          x=72"), so every Profile surface owns its top gap through PageHeader
          and the container contributes none. Keeping the padding here would
          paint this first frame 12px below the two that follow it — the
          three-frames-two-shapes defect this file exists to stop. */}
      <div
        className="container mx-auto px-5 lg:px-6 xl:px-6 pb-4 flex-1 min-h-0 overflow-y-auto"
        aria-hidden
      >
        <div className="page-measure mx-auto">
          {/* MEASURED 2026-09-22 at 375 on prod: a cold deep link into
              `/profile?tab=pets` painted, in THIS frame, an avatar-hero card
              over three round-avatar person tiles under a grey title BAR — no
              "My Pets" h1, no back chevron — against a real screen of two pet
              cards and an "Add a Pet" button. That is the owner's 2026-09-22
              report ("a lot load with the incorrect stuff") verbatim, and it
              is the SAME expression Profile.tsx:604 documents itself as having
              replaced: the fix landed in Profile.tsx's own loading branch and
              never reached the route-level fallback that paints BEFORE it. So
              the landing skeleton kept standing in for all twenty-four tabs on
              the first frame of every cold deep link.

              Now the three-way branch matches Profile.tsx's exactly, on the
              shared primitive: the landing gets the landing's bones, earnings
              keeps its own, and every other tab gets `ProfileTabFallback` —
              the tab's REAL `<h1>` in its final position from frame one, over
              one screenful of reserve (owner's ruling, 2026-09-19: "skeleton
              fills the screen, grows below").

              No `onBack`: there is no Profile state to flip back to from here,
              and `ProfileTabHeader`'s chevron falls through to BackButton's
              history pop, which is the correct gesture on a route fallback. */}
          {tab === "landing" ? (
            <ProfilePageSkeleton />
          ) : isEarningsTabUrl() ? (
            <EarningsPageSkeleton />
          ) : (
            <ProfileTabFallback tab={tab} />
          )}
        </div>
      </div>
    </AppShell>
  </div>
  );
};

export default ProfileRouteSkeleton;
