import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import type { ProfileLandingProps } from "./profileLanding/types";
import { useProfileLandingDerived } from "./profileLanding/useProfileLandingDerived";
import { useProfileQrCode } from "./profileLanding/useProfileQrCode";
import { IdentityHeader } from "./profileLanding/IdentityHeader";
import { SettingsSection } from "./profileLanding/SettingsSection";
import { QrCodeModal } from "./profileLanding/QrCodeModal";

export function ProfileLanding({
  profile,
  userId,
  displayName,
  initials,
  avatarBroken,
  setAvatarBroken,
  avgRating,
  reviewCount,
  completedCount,
  onSelectTab,
  onNavigate,
  onRequestDelete,
  onRequestLogout,
  earningsSparkline = null,
  totalEarnings = 0,
}: ProfileLandingProps) {
  const { qrOpen, setQrOpen, qrDataUrl } = useProfileQrCode(profile);
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
  } = useProfileLandingDerived({
    profile,
    avatarBroken,
  });

  return (
    <>
      <IdentityHeader
        profile={profile}
        userId={userId}
        displayName={displayName}
        initials={initials}
        setAvatarBroken={setAvatarBroken}
        avgRating={avgRating}
        reviewCount={reviewCount}
        completedCount={completedCount}
        onSelectTab={onSelectTab}
        earningsSparkline={earningsSparkline}
        totalEarnings={totalEarnings}
        tier={tier}
        hasPhoto={hasPhoto}
        memberSinceLabel={memberSinceLabel}
        earnedBadges={earnedBadges}
        setQrOpen={setQrOpen}
      />

      {/* ── Settings & navigation ────────────────────────────────────
          One unified pattern: every sub-section is a list row grouped
          under a quiet section label. (Replaces the old mix of square
          category tiles + a separate row list — list-of-rows scales
          cleaner and is easier to scan.) */}
      <SettingsSection
        payoutPrompt={payoutPrompt}
        onRetryPayoutStatus={refetchStatus}
        menuGroups={menuGroups}
        onSelectTab={onSelectTab}
        onNavigate={onNavigate}
        onRequestLogout={onRequestLogout}
        onRequestDelete={onRequestDelete}
      />

      {/* ── QR code modal ─────────────────────────────────────────────── */}
      <QrCodeModal
        profile={profile}
        qrOpen={qrOpen}
        setQrOpen={setQrOpen}
        qrDataUrl={qrDataUrl}
      />
    </>
  );
}

export default ProfileLanding;
