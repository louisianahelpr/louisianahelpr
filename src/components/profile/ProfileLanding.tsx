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
      <IdentityHeader
        profile={profile}
        userId={userId}
        displayName={displayName}
        initials={initials}
        avgRating={avgRating}
        reviewCount={reviewCount}
        completedCount={completedCount}
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
        <div
          className="liquid-glass"
          style={{
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
          }}
        >
          <div className="p-2 space-y-2">
            <PayoutStatusRow
              prompt={payoutPrompt}
              onSetUp={() => onSelectTab("payment")}
              onRetry={refetchStatus}
            />
            <VerificationStatusRow profile={profile} />
          </div>
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
