import AppShell from "@/components/AppShell";
import { ProfilePageSkeleton } from "@/components/profile/ProfilePageSkeleton";
import { ProfileTabFallback } from "@/components/profile/ProfileTabFallback";
import { ProfileOfflineGate } from "@/components/profile/ProfileOfflineGate";
import { EarningsPageSkeleton, isEarningsTabUrl } from "@/components/profile/earningsTab/EarningsPageSkeleton";
import { PAGE_COLUMN } from "@/lib/pageColumn";
import type { Tab } from "./types";

/**
 * Profile's boot frame while `showSkeleton` holds (Profile.tsx returns this
 * before anything else). Moved verbatim out of Profile.tsx (Q806
 * god-component split); the DOM is unchanged.
 */
export function ProfileLoadingShell({ tab, backFromTab }: { tab: Tab; backFromTab: () => void }) {
  // Loading state mirrors the loaded state's shell so there's no
  // header jump when the skeleton resolves. Uses AppShell + the same
  // DashboardHeader (which carries `.glass-header` → safe-area-top
  // inset) so the HelprMark never overlaps the iOS status bar clock.
  return (
    <AppShell
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page pt-safe-top"
    >
      {/* NO top padding, EXACTLY as the loaded container below has none
          (2026-09-20). Both used to gate `pt-3 lg:pt-5` on the landing tab,
          because the landing was the one Profile surface with no PageHeader
          of its own to own that gap; it has one now, so both dropped the
          condition together. They must move as a pair: this shell used to
          apply the padding unconditionally while the loaded one applied it
          only to the landing, and every one of the twenty-four tabs booted
          12px lower than the content that replaced it and then hopped up.
          Measured at 375 on a cold deep link into ?tab=gift_card: skeleton
          h1 at y=38, real h1 at y=26. The comment above claimed this shell
          "mirrors the loaded state's shell so there's no header jump"; the
          declaration did not. Trust the declaration, never the comment
          beside it — which is also why `ProfilePageSkeleton` now draws the
          landing's title row.

          aria-busy, as on ProfileRouteSkeleton (the frame before this one):
          the skeleton's real Work rows are a loading frame, not the page
          arriving. Without it the landing's wait for its switch answers
          (Q?profile-declutter-shift) read as a second content wave. */}
      <div aria-busy="true" className="container mx-auto px-5 lg:px-6 xl:px-6 pb-4 flex-1 min-h-0 overflow-y-auto">
        <div className={`page-measure ${PAGE_COLUMN}`}>
          {/* THE PLACEHOLDER MUST BE THE SCREEN YOU ASKED FOR. This line
              used to read `isEarningsTabUrl() ? <EarningsPageSkeleton /> :
              <ProfilePageSkeleton />`, which special-cased exactly ONE tab
              and gave the other twenty-three the LANDING's shape — so a cold
              deep link into ?tab=gift_card painted an avatar hero and three
              stat tiles before the gift-card form arrived (owner, 2026-09-19:
              loading states are "not consistent with their info"). It was
              also the middle of three loading screens on that path: splash,
              landing bones, tab bones, tab.

              Now the landing gets the landing's skeleton, earnings keeps its
              own true per-tab one, and every other tab gets the SAME
              placeholder its Suspense boundary uses — one screenful, under
              that tab's real title — so the deep link paints one loading
              screen instead of three and it is the right one. */}
          <ProfileOfflineGate tab={tab} onBack={backFromTab}>
          {tab === "landing" ? (
            <ProfilePageSkeleton />
          ) : isEarningsTabUrl() ? (
            <EarningsPageSkeleton />
          ) : (
            <ProfileTabFallback tab={tab} onBack={backFromTab} />
          )}
          </ProfileOfflineGate>
        </div>
      </div>
    </AppShell>
  );
}
