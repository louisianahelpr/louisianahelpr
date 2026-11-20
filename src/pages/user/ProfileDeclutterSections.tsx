import { MovingSaleBanner } from "@/components/declutter/MovingSaleBanner";
import { SellingNowRow } from "@/components/declutter/SellingNowRow";
import { DeclutterProfileSection } from "@/components/declutter/DeclutterProfileSection";
import { AwayBanner } from "@/components/declutter/AwayMode";

/**
 * A member's Declutter on their public profile (/user/:userId), as one group: their moving sale (board 164), what
 * they are selling now (board 40) and the Declutter reviews others left them (#61). UserProfile mounts it under the
 * masthead, or above it when the profile was opened from a Declutter listing (F359i, owner 11-12, ?from=declutter).
 * Guard: src/pages/user/userProfileMounts.test.tsx.
 */
export function ProfileDeclutterSections({ userId }: { userId: string }) {
  return (
    <>
      {/* Declutter top 5 #5 (owner 11-19): "Away until Mon, Nov 30" while the seller is away. */}
      <AwayBanner sellerId={userId} />
      <MovingSaleBanner sellerId={userId} />
      <SellingNowRow sellerId={userId} />
      <DeclutterProfileSection userId={userId} />
    </>
  );
}
