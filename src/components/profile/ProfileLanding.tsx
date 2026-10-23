import { AppTopBar } from "@/components/sections/AppTopBar";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import type { ProfileLandingProps } from "./profileLanding/types";
import { YouCard } from "./profileLanding/YouCard";
import { YouMenu } from "./profileLanding/YouMenu";
import { PayoutStatusRow } from "./profileLanding/PayoutStatusRow";
import { PROFILE_PAGE_TITLE } from "./profileLanding/headingContract";
import { YourActivity } from "./profileLanding/YourActivity";

export function ProfileLanding({
  profile,
  userId,
  displayName,
  avgRating,
  reviewCount,
  onSelectTab,
  onRequestDelete,
  onRequestLogout,
}: ProfileLandingProps) {
  // Owned here rather than passed in — see the note in `types.ts`. Cached,
  // so re-opening Profile in the same session paints the payout state on
  // the first frame instead of re-asking Stripe every mount.
  const { payoutPrompt, refetchStatus } = useStripeConnectStatus();
  // Owner ruling 2026-10-23: payout setup is paused; the row says so instead
  // of offering "Set up".
  const setupPaused = usePayoutSetupPaused();

  return (
    <>
      {/* ── THE TOP BAR (board 18) ─────────────────────────────────
          The same AppTopBar as Home, Explore and Messages: the title "You"
          on the left, the bell on the right. No profile photo in the bar, since
          this IS your profile (spec v2 §3 top bar; board 18). */}
      <div className="-mb-3 lg:-mb-4">
        <AppTopBar title={PROFILE_PAGE_TITLE} showProfile={false} />
      </div>

      <YouCard
        profile={profile}
        userId={userId}
        displayName={displayName}
        avgRating={avgRating}
        reviewCount={reviewCount}
      />

      {/* ── Getting-started slot ─────────────────────────────────────
          The one thing that stands between a member and being hired: can we
          pay you. The row disappears completely once it has nothing to say.

          There used to be a second row here, "Verify your ID". Identity
          verification gates nothing any more (owner, 2026-10-01: "we don't do
          that anymore"), so the prompt went with the server requirement
          (migration 20261001222911). Guarded by
          src/test/identityNeverGatesPostOrAward.test.ts. */}
      {payoutPrompt.kind !== "none" && (
        /* NO CARD BEHIND THIS BANNER. Owner, 2026-09-11: remove the white
           card behind "Finish setting up". `PayoutStatusRow` draws its own
           bordered, sienna-tinted surface, so a `liquid-glass` box behind it
           would be a box inside a box. */
        <div className="space-y-2">
          <PayoutStatusRow
            prompt={payoutPrompt}
            onSetUp={() => onSelectTab("payment")}
            onRetry={refetchStatus}
            setupPaused={setupPaused}
          />
        </div>
      )}

      {/* ── Settings & navigation ────────────────────────────────────
          One unified pattern: every sub-section is a list row grouped
          under a quiet section label. (Replaces the old mix of square
          category tiles + a separate row list — list-of-rows scales
          cleaner and is easier to scan.) */}
      {/* No section rows here (owner: sections don't live in Profile).
          Declutter, Shops and Homes are tabs in the dock and the rail
          (useSectionTabs, 2026-10-18); Quotes moved into Post a Job
          (2026-10-19), so its row left too. */}

      {/* Board 18: both sides of every section, right under who you are. */}
      <YourActivity />

      {/* Board 18: Money · Alerts · Settings · Talk to a real person, then Log out
          (clear) and Delete account (quiet). Every other row lives one level down
          in You › Money, You › Settings or Help (board 52, spec v2 §9.8). */}
      <YouMenu onSelectTab={onSelectTab} onRequestLogout={onRequestLogout} onRequestDelete={onRequestDelete} />
    </>
  );
}
