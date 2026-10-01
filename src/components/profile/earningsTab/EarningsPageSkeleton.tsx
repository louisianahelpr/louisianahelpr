import { Skeleton } from "@/components/ui/skeleton";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { TAB_TITLES } from "@/pages/profile/types";

/**
 * ONE skeleton for Earnings & Payouts (VN-3, owner 2026-09-15: "One skeleton.
 * Better organization").
 *
 * The page used to paint three different shapes on a cold load: the Profile
 * LANDING skeleton (avatar + three tiles) from the route and Profile's own
 * loading branch, then the real header, then each card popping in as its own
 * query landed. Measured on prod with helper-e2e: 6 layout shifts, CLS 0.243 at
 * 1440 and 0.480 at 375.
 *
 * This is the finished page's silhouette — title row, view switcher, the
 * Earned summary card, the history card — so every loading frame has the
 * layout the loaded page will have. `withHeader` is false where the real
 * ProfileTabHeader and switcher are already on screen.
 */
export function EarningsPageSkeleton({
  withHeader = true,
  withSwitcher = withHeader,
}: {
  withHeader?: boolean;
  /** The 50px view-switcher bone. Defaults to `withHeader`; EarningsTab passes
   *  it alone because its real header is up but its switcher is held back
   *  until the connect card (which sits ABOVE the switcher) has settled. */
  withSwitcher?: boolean;
}) {
  return (
    <ProfileTabBody aria-hidden data-testid="earnings-page-skeleton">
      {withHeader && (
        <>
          {/* The REAL header (68px), not a 44px bone row, and a switcher bone
              the switcher's measured 50px: the bone pair read 44/48 against
              68/50 loaded, a +20px jump on prod at 375 (2026-10-01). */}
          <ProfileTabHeader title={TAB_TITLES.earnings} />
        </>
      )}
      {withSwitcher && <Skeleton className="h-[50px] w-full rounded-full" />}
      <section className="space-y-3">
        <div className="rounded-2xl liquid-glass p-card space-y-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-5 w-24 rounded" />
          </div>
          <Skeleton className="h-11 w-full rounded-full" />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-8 w-32 rounded" />
              <Skeleton className="h-3 w-28 rounded" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-8 w-24 rounded" />
              <Skeleton className="h-3 w-20 rounded" />
            </div>
          </div>
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <div className="rounded-2xl liquid-glass p-card space-y-3">
          <Skeleton className="h-5 w-36 rounded" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="h-3 w-1/3 rounded" />
              </div>
              <Skeleton className="h-5 w-16 rounded" />
            </div>
          ))}
        </div>
      </section>
    </ProfileTabBody>
  );
}

/** True when the current URL opens the Earnings tab, so the route-level and
 *  Profile loading skeletons can paint the Earnings silhouette instead of the
 *  Profile landing's. */
export function isEarningsTabUrl(): boolean {
  if (typeof window === "undefined") return false;
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "earnings" || tab === "payment";
}
