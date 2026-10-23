import { AppTopBar } from "@/components/sections/AppTopBar";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { Skeleton } from "@/components/ui/skeleton";
import { PayoutStatusRow } from "@/components/profile/profileLanding/PayoutStatusRow";
import { PROFILE_PAGE_TITLE } from "@/components/profile/profileLanding/headingContract";
import { YouMenuList, YOU_STATIC_CAPTIONS } from "@/components/profile/profileLanding/YouMenu";

const RESERVE = { kind: "reserve" } as const;
const noop = () => {};

/** YouCard's box (board 18): 64px photo, name, facts line, "View my public profile". */
const YouCardSkeleton = () => (
  <div className="liquid-glass shrink-0 w-full flex items-center gap-4 px-4 py-4">
    <Skeleton className="w-16 h-16 rounded-full shrink-0" />
    <div className="flex-1 min-w-0 space-y-2">
      <Skeleton className="h-4 w-1/2 rounded-md" />
      <Skeleton className="h-3 w-2/3 rounded-md" />
      <Skeleton className="h-3 w-1/3 rounded-md" />
    </div>
  </div>
);

/**
 * /profile's FIRST FRAME HAS WORDS IN IT (Q1173, Q722): the landing's real top
 * bar ("You" + the bell), then bones for the profile card and the activity
 * tiles (both data), the payout row's own reserve, and board 18's four rows
 * with every caption known before data. The rows are YouMenuList itself,
 * drawn inert, so the loading frame cannot drift from the page.
 */
export const ProfilePageSkeleton = () => {
  // The reserve takes the paused row's height while payout setup is paused
  // (PayoutStatusRow setupPaused), so the landing does not shift under it.
  const setupPaused = usePayoutSetupPaused();
  return (
    <div className="flex flex-col gap-3 lg:gap-4" data-testid="profile-landing-skeleton">
      {/* ProfileLanding's top bar, with the same `-mb-3 lg:-mb-4` that cancels the column gap under it. */}
      <div className="-mb-3 lg:-mb-4">
        <AppTopBar title={PROFILE_PAGE_TITLE} showProfile={false} />
      </div>
      <YouCardSkeleton />
      {/* The payout row's own RESERVE: every state of that row is one height (StackedCopy). */}
      <div className="space-y-2">
        <PayoutStatusRow prompt={RESERVE} onSetUp={noop} onRetry={noop} setupPaused={setupPaused} />
      </div>
      <div className="flex flex-col gap-2" aria-hidden>
        <p className="px-1 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your activity</p>
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[62px] rounded-ds-lg" />
          ))}
        </div>
      </div>
      <div className="shrink-0" aria-hidden>
        <YouMenuList captions={YOU_STATIC_CAPTIONS} />
      </div>
    </div>
  );
};
