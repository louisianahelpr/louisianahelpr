import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { Database } from "@/integrations/supabase/types";
import type { ReplyBucket } from "@/lib/trustLine";
import { ProfileHeaderCard } from "./ProfileHeaderCard";
import { AtAGlanceCard } from "./AtAGlanceCard";
import { RecognitionRow } from "./RecognitionRow";
import { SubscriptionTierBadge } from "./ProfileBadge";
import type { useUserProfileData } from "./useUserProfileData";
import type { computeLastActiveLabel } from "./userProfileHelpers";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileData = ReturnType<typeof useUserProfileData>;

/**
 * Q806: UserProfile's masthead, moved verbatim out of UserProfile.tsx (pure move; same element, same props).
 */
export function UserProfileMasthead({
  profile, userId, displayName, initials, isOwnProfile, isIdVerified, badgeStats, data, credentialTier, tierProfile,
  lastActiveLabel, memberSinceLabel, stats, postedTotalCount, completedWorkedCount, declutterReviewCount, replyLatency,
  onTimeArrivalRate, revisionFrequency, replyBucket, mutualJobsCount, showReviews, showPostedJobs, showWorkedJobs,
  setShowReviews, setShowPostedJobs, setShowWorkedJobs,
}: {
  profile: Profile;
  userId: string | undefined;
  displayName: string;
  initials: string;
  isOwnProfile: boolean;
  isIdVerified: ProfileData["isIdVerified"];
  badgeStats: ProfileData["badgeStats"];
  data: ProfileData["data"];
  credentialTier: ProfileData["credentialTier"];
  tierProfile: ProfileData["tierProfile"];
  lastActiveLabel: ReturnType<typeof computeLastActiveLabel>;
  memberSinceLabel: string | null;
  stats: ProfileData["stats"];
  postedTotalCount: ProfileData["postedTotalCount"];
  completedWorkedCount: ProfileData["completedWorkedCount"];
  declutterReviewCount: number;
  replyLatency: ProfileData["replyLatency"];
  onTimeArrivalRate: ProfileData["onTimeArrivalRate"];
  revisionFrequency: ProfileData["revisionFrequency"];
  replyBucket: ReplyBucket | null;
  mutualJobsCount: ProfileData["mutualJobsCount"];
  showReviews: boolean;
  showPostedJobs: boolean;
  showWorkedJobs: boolean;
  setShowReviews: Dispatch<SetStateAction<boolean>>;
  setShowPostedJobs: Dispatch<SetStateAction<boolean>>;
  setShowWorkedJobs: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <>
          {/* ── MASTHEAD ──
              ONE card: who this person is, what they have earned, and what
              their record says. It used to be four separate cards stacked in a
              row (identity, a "CAREER MILESTONES" heading over a single pill,
              three stat tiles, a "TRACK RECORD" heading over a fourth card) —
              which is exactly why the screen read as "a stack of unrelated
              cards rather than one designed screen". */}
          <ProfileHeaderCard
            profile={profile}
            userId={userId!}
            displayName={displayName}
            initials={initials}
            isOwnProfile={isOwnProfile}
            isIdVerified={isIdVerified}
            tierBadge={<SubscriptionTierBadge tier={profile.subscription_tier} />}
            recognition={
              <RecognitionRow
                // AS A HELPR (VN-14, owner 2026-09-14): jobs worked, not posted
                // + worked, and reviews received as a Helpr — `stats` is the
                // headline total and stays on the tiles. `credentialTier` null
                // = unknown, which withholds Licensed Pro without asserting 0.
                milestoneStats={{
                  ...badgeStats,
                  repeatHirePercent: data?.repeatHirePercent ?? 0,
                  credentialTier,
                }}
                // Own-row flag OR get_safe_profiles.is_id_verified (RLS blocks the direct select for visitors).
                idVerified={
                  isIdVerified ||
                  (profile as unknown as { is_id_verified?: boolean }).is_id_verified === true
                }
                payoutsSetUp={(profile as unknown as { is_payout_ready?: boolean }).is_payout_ready === true}
                ladderProfile={tierProfile}
                ladderStats={badgeStats}
                credentials={profile as unknown as ComponentProps<typeof RecognitionRow>["credentials"]}
                backgroundChecked={
                  (profile as unknown as { background_check_status?: string }).background_check_status === "verified"
                }
              />
            }
            // PRESENCE on the identity line, not in the badge row — it is
            // live state, not an achievement (owner, 2026-09-11).
            lastActiveLabel={lastActiveLabel}
            atAGlance={
              <AtAGlanceCard
                isOwnProfile={isOwnProfile}
                displayName={displayName}
                memberSinceLabel={memberSinceLabel}
                stats={stats}
                // postedTotalCount, NOT postedJobs.length — the `postedJobs`
                // fetch carries a .limit(20), so the stat read "20 Posted" for
                // anyone with more than 20 jobs. The exact count is already
                // fetched on this same load (count: exact, head: true).
                postedJobsCount={postedTotalCount}
                // completedWorkedCount, NOT completedWorkedJobs.length: that
                // array is a .limit(20) page of `jobs` rows RLS hides from
                // every visitor, so the tile read "0 Jobs completed" on a
                // stranger's view of a helper with a dozen. The count is a
                // SECURITY DEFINER aggregate; the list stays the list.
                workedJobsCount={completedWorkedCount}
                // #28: the hero's rating tile must not say "No reviews yet" over Declutter reviews.
                declutterReviewCount={declutterReviewCount}
                replyLatency={replyLatency}
                onTimeArrivalRate={onTimeArrivalRate}
                revisionFrequency={revisionFrequency}
                repeatHirePercent={data?.repeatHirePercent ?? null}
                repeatClientSample={data?.statSamples?.repeatClients ?? null}
                replyBucket={replyBucket}
                // Moved here from the header line (owner, 2026-09-14, VN-16).
                mutualJobsCount={mutualJobsCount}
                showReviews={showReviews}
                showPostedJobs={showPostedJobs}
                showWorkedJobs={showWorkedJobs}
                onToggleReviews={() => {
                  setShowReviews(!showReviews);
                  setShowPostedJobs(false);
                  setShowWorkedJobs(false);
                }}
                onTogglePosted={() => {
                  setShowPostedJobs(!showPostedJobs);
                  setShowReviews(false);
                  setShowWorkedJobs(false);
                }}
                onToggleWorked={() => {
                  setShowWorkedJobs(!showWorkedJobs);
                  setShowReviews(false);
                  setShowPostedJobs(false);
                }}
              />
            }
          />
    </>
  );
}
