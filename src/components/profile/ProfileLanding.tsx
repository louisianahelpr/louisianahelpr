import type { ProfileLandingProps } from "./profileLanding/types";
import { useProfileLandingDerived } from "./profileLanding/useProfileLandingDerived";
import { useIntroVideoUpload } from "./profileLanding/useIntroVideoUpload";
import { useProfileQrCode } from "./profileLanding/useProfileQrCode";
import { IdentityHeader } from "./profileLanding/IdentityHeader";
import { CompletionChecklist } from "./profileLanding/CompletionChecklist";
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
  stripeConnectStatus,
  onSelectTab,
  onNavigate,
  onRequestDelete,
  onRequestLogout,
  reviewsPreview = [],
  reviewsError = false,
  onRetryReviews,
  earningsSparkline = null,
  totalEarnings = 0,
}: ProfileLandingProps) {
  const { videoUploading, handleVideoUpload } = useIntroVideoUpload(profile);
  const { qrOpen, setQrOpen, qrDataUrl } = useProfileQrCode(profile);

  const {
    tier,
    hasPhoto,
    memberSinceLabel,
    earnedBadges,
    portfolioUrls,
    completion,
    completionPct,
    completionTargets,
    handleCompletionItemTap,
    menuGroups,
  } = useProfileLandingDerived({
    profile,
    avatarBroken,
    completedCount,
    avgRating,
    reviewCount,
    stripeConnectStatus,
    onSelectTab,
    onNavigate,
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
        reviewsPreview={reviewsPreview}
        reviewsError={reviewsError}
        onRetryReviews={onRetryReviews}
        earningsSparkline={earningsSparkline}
        totalEarnings={totalEarnings}
        tier={tier}
        hasPhoto={hasPhoto}
        memberSinceLabel={memberSinceLabel}
        earnedBadges={earnedBadges}
        portfolioUrls={portfolioUrls}
        videoUploading={videoUploading}
        handleVideoUpload={handleVideoUpload}
        setQrOpen={setQrOpen}
      />

      {/* ── Finish your profile ──────────────────────────────────────
          Completion checklist. Sits right under the header (the most
          sensible spot — it's the user's own next action), as a quiet
          collapsed disclosure rather than permanent clutter. The whole
          block is HIDDEN once every actionable enhancement is done. */}
      {completion.nextLabel !== null && (
        <CompletionChecklist
          completion={completion}
          completionPct={completionPct}
          completionTargets={completionTargets}
          handleCompletionItemTap={handleCompletionItemTap}
        />
      )}

      {/* ── Settings & navigation ────────────────────────────────────
          One unified pattern: every sub-section is a list row grouped
          under a quiet section label. (Replaces the old mix of square
          category tiles + a separate row list — list-of-rows scales
          cleaner and is easier to scan.) */}
      <SettingsSection
        profile={profile}
        stripeConnectStatus={stripeConnectStatus}
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
