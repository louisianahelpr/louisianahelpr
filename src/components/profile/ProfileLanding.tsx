import PageHeader from "@/components/PageHeader";
import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import type { ProfileLandingProps } from "./profileLanding/types";
import { useProfileLandingDerived } from "./profileLanding/useProfileLandingDerived";
import { IdentityHeader } from "./profileLanding/IdentityHeader";
import { SettingsSection } from "./profileLanding/SettingsSection";
import { PayoutStatusRow } from "./profileLanding/PayoutStatusRow";
import { VerificationStatusRow } from "./profileLanding/VerificationStatusRow";
import { verificationPromptFor } from "./profileLanding/verificationPrompt";

export function ProfileLanding({
  profile,
  userId,
  displayName,
  initials,
  avgRating,
  reviewCount,
  completedCount,
  helperBadgeStats,
  onSelectTab,
  onNavigate,
  onRequestDelete,
  onRequestLogout,
}: ProfileLandingProps) {
  // Owned here rather than passed in — see the note in `types.ts`. Cached,
  // so re-opening Profile in the same session paints the payout state on
  // the first frame instead of re-asking Stripe every mount.
  const { payoutPrompt, refetchStatus } = useStripeConnectStatus();

  const {
    tier,
    hasPhoto,
    memberSinceLabel,
    earnedBadges,
    menuGroups,
  } = useProfileLandingDerived({ profile });

  return (
    <>
      {/* ── THE PAGE TITLE ──────────────────────────────────────────
          The member's name, on the SAME title line as all 25 Profile tabs
          (owner, 2026-09-20: "align the landing title to x=72"). Measured at
          1440 before the change: tab titles x=72, landing x=145; at 375,
          68 against 141. The cards already agreed (24 / 20); the title was
          the last Profile surface that did not.

          Why it lands there BY CONSTRUCTION and not by a nudge: this is the
          same `<PageHeader>` the tabs render through (via ProfileTabHeader),
          with the same two load-bearing options — `width="none"` because
          Profile.tsx has already applied the app container + `page-measure`
          one layer up, and `topInsetHandled` because AppShell's `pt-safe-top`
          has already cleared the notch. The x is then the header's own back
          slot (36) + `gap-3` (12) off the gutter, which is the same arithmetic
          every tab title is subject to.

          `hideBack` + `reserveBackSlot`: the landing is a bottom-nav ROOT —
          there is nothing to go back to and a chevron here would navigate out
          of the tab — so the slot is held open EMPTY rather than filled. See
          the prop's note in PageHeader.tsx.

          The nudge that was NOT taken: a one-off left margin on the old
          in-card `<h1>`. It would have matched the number and matched nothing
          else — the landing would still have been the one Profile screen with
          no page title, still on the pre-2026-08-29 inline `clamp()` type
          ramp, and still free to drift the next time the back slot changed
          width.

          `-mb-3 lg:-mb-4` cancels the LANDING COLUMN's own `gap-3 lg:gap-4`
          (Profile.tsx), the same way ProfileTabHeader's `-mb-4` cancels the
          tab shell's `space-y-4` — so the air under this title equals the air
          above it, which is PageHeader's app-wide rule. It is keyed to that
          gap and moves with it; it is NOT keyed to PageHeader's padding. */}
      <div className="-mb-3 lg:-mb-4">
        <PageHeader
          title={displayName || "Welcome back"}
          hideBack
          reserveBackSlot
          width="none"
          topInsetHandled
        />
      </div>

      <IdentityHeader
        profile={profile}
        userId={userId}
        displayName={displayName}
        initials={initials}
        avgRating={avgRating}
        reviewCount={reviewCount}
        completedCount={completedCount}
        helperBadgeStats={helperBadgeStats ?? null}
        onSelectTab={onSelectTab}
        tier={tier}
        hasPhoto={hasPhoto}
        memberSinceLabel={memberSinceLabel}
        earnedBadges={earnedBadges}
      />

      {/* ── Getting-started slot ─────────────────────────────────────
          The two things that stand between a member and working, in the
          order the server checks them: can we pay you, and do we know who
          you are. Both live in ONE card so they read as a checklist rather
          than two competing alarms, and the card disappears completely once
          neither has anything to say.

          The verification row is new (2026-09-06). Before it, identity was
          surfaced NOWHERE on this screen — the only ID prompt in the whole
          product was mounted inside PostJob — while `jobs` INSERT and
          `helper_award_block_reason()` both refused unverified members. See
          `verificationPrompt.ts`. */}
      {(payoutPrompt.kind !== "none" || verificationPromptFor(profile).kind !== "none") && (
        /* NO CARD BEHIND THESE BANNERS. Owner, 2026-09-11: remove the white
           card behind "Finish setting up". Each row already draws its own
           bordered, sienna-tinted surface (`PayoutStatusRow`'s BOX,
           `VerificationStatusRow`'s), so the `liquid-glass` box put a second
           boundary a single padding step outside the first — the same
           box-inside-a-box the owner caught on the empty states. The rows are
           the cards; this is just the gap between them. */
        <div className="space-y-2">
          <PayoutStatusRow
            prompt={payoutPrompt}
            onSetUp={() => onSelectTab("payment")}
            onRetry={refetchStatus}
          />
          <VerificationStatusRow profile={profile} />
        </div>
      )}

      {/* ── Settings & navigation ────────────────────────────────────
          One unified pattern: every sub-section is a list row grouped
          under a quiet section label. (Replaces the old mix of square
          category tiles + a separate row list — list-of-rows scales
          cleaner and is easier to scan.) */}
      <SettingsSection
        menuGroups={menuGroups}
        onSelectTab={onSelectTab}
        onNavigate={onNavigate}
        onRequestLogout={onRequestLogout}
        onRequestDelete={onRequestDelete}
      />

    </>
  );
}
