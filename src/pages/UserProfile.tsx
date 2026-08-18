import { useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Briefcase, Clock, MoreVertical, Flag, Ban, UserX, MessageSquare } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { HelperAvailabilityDisplay } from "@/components/HelperAvailabilityDisplay";
import { computeBadges } from "@/components/HelperBadges";
import { HelperPortfolio } from "@/components/HelperPortfolio";
import { PublicReviewWall } from "@/components/profile/PublicReviewWall";
import { SkillEndorsements } from "@/components/profile/SkillEndorsements";
import { CareerMilestones } from "@/components/profile/CareerMilestones";
import { ProfileCompletionCard } from "@/components/profile/ProfileCompletionCard";
import { ProfileHeaderCard } from "./userProfile/ProfileHeaderCard";
import BackgroundCheckCard from "@/components/profile/BackgroundCheckCard";
import { ProfileStatsGrid } from "./userProfile/ProfileStatsGrid";
import { RatingBreakdown } from "./userProfile/RatingBreakdown";
import { PosterReputationCard } from "./userProfile/PosterReputationCard";
import { ReviewsSection } from "./userProfile/ReviewsSection";
import { JobsList } from "./userProfile/JobsList";
import { useUserProfileData } from "./userProfile/useUserProfileData";
import {
  NEARBY_RADIUS_MI,
  computeLastActiveLabel,
  computeJobsNearbyCount,
} from "./userProfile/userProfileHelpers";

import ReportDialog from "@/components/ReportDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import SaveHelperButton from "@/components/SaveHelperButton";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUserLocation } from "@/hooks/useUserLocation";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const UserProfile = () => {
  usePageTitle("User Profile — Helpr");
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentAuthUser } = useCurrentUser();
  const currentUserId = currentAuthUser?.id ?? null;

  const [showReviews, setShowReviews] = useState(searchParams.get("tab") === "reviews");

  // Handle Stripe subscription checkout return
  useEffect(() => {
    const pro = searchParams.get("pro");
    if (!pro) return;
    if (pro === "success") {
      toast.success("You're now upgraded — welcome to your new plan.");
    } else if (pro === "cancel") {
      toast.info("Upgrade cancelled — you can upgrade any time from your profile.");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("pro");
    setSearchParams(next, { replace: true });
  }, []);

  const [showPostedJobs, setShowPostedJobs] = useState(false);
  const [showWorkedJobs, setShowWorkedJobs] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  // Viewer opts in to the "did N jobs nearby" social proof (#31).
  // Gated so we don't fire the geolocation prompt just to render a badge.
  // The hook caches across pages, so once requested it's near-instant on
  // every subsequent profile view in the same session.
  const [showNearbyProof, setShowNearbyProof] = useState(false);
  // Reviews filter + pagination (#27). Category null = "all", rating null
  // = "all". Visible count starts at PAGE_SIZE and grows in PAGE_SIZE
  // increments via the "Show more" button at the bottom of the list.
  const [reviewCategoryFilter, setReviewCategoryFilter] = useState<string | null>(null);
  // Star-filter bucket (#3): "all" | "5" | "4" | "low" (≤3). Three discrete
  // buckets reads cleaner than five rating chips — a customer scanning
  // reviews wants to see the negatives or just the perfect-fives, not
  // the granular per-star breakdown.
  const [reviewRatingFilter, setReviewRatingFilter] = useState<"all" | "5" | "4" | "low">("all");
  const [reviewVisibleCount, setReviewVisibleCount] = useState(5);
  // Response-to-review state: which review is being responded to, and the draft text.
  const [respondingToReview, setRespondingToReview] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [savingResponse, setSavingResponse] = useState(false);

  // All Supabase fetching + derivation lives in this hook (extracted verbatim).
  const {
    data,
    isError,
    refetch,
    hasCleanRecord,
    hasSubmittedCredentials,
    petCareSignal,
    reviewsFromQuery,
    setLocalReviews,
    reviews,
    stats,
    loadingMoreReviews,
    reviewsHasMore,
    reviewsTotalCount,
    loadMoreReviews,
    postedJobs,
    workedJobs,
    completedWorkedJobs,
    responseMetrics,
    cancellationRate,
    mutualJobsCount,
    onTimeArrivalRate,
    revisionFrequency,
    lastActiveAt,
    isIdVerified,
    backgroundCheckStatus,
    tierProfile,
    posterReputation,
    postedTotalCount,
    postedCancelledCount,
    loading,
  } = useUserProfileData(userId, currentUserId);

  const profile = (data?.profile ?? null) as Profile | null;

  // Geo for the "did N jobs nearby" badge (#31). Only enable the hook
  // when the viewer has explicitly opted in via the inline trigger, so
  // we never surprise-prompt for location just to render a profile.
  const viewerLoc = useUserLocation(showNearbyProof);
  const jobsNearbyCount = computeJobsNearbyCount(viewerLoc, workedJobs);

  // Computed up-front so the loading skeleton can render the same
  // PageHeader (eyebrow/title/meta) as the loaded state — both only
  // depend on the route param + current user, not the fetched profile.
  const isOwnProfile = currentUserId === userId;

  // Whether the loaded header will render trailing actions (Message, Save,
  // overflow). Mirrored as a placeholder in the skeleton / not-found states so
  // the header keeps the same layout (one title row, actions flush right)
  // before and after the fetch resolves — no height jump.
  const headerHasActions = !isOwnProfile && !!currentUserId;
  const headerActionPlaceholder = headerHasActions ? (
    <div className="flex items-center gap-1" aria-hidden>
      <div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />
      <div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />
      <div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />
    </div>
  ) : null;

  // Authed-only route (ProtectedRoute): the persistent app chrome —
  // DesktopSidebarNav rail on web, MobileNav on phones — is supplied globally
  // in App.tsx, and the desktop rail inset comes from the global #root rule.
  // So this page is a plain document-scroll surface; it must NOT pull in the
  // marketing PublicLayout, whose Navbar/Footer would double-stack on top of
  // the app shell. Every rendered state routes through this wrapper.
  const wrap = (inner: ReactNode) => (
    <div className="min-h-screen bg-premium-page pb-safe-nav">{inner}</div>
  );

  if (loading) {
    return wrap(
      <>
        <PageHeader
          width="container-lg-5xl-6xl"
          eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
          title={isOwnProfile ? "Profile Review" : "Profile"}
          meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
          titleActions={headerActionPlaceholder}
        />
        <div className="container mx-auto px-5 py-6">
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="rounded-2xl liquid-glass p-5 text-center space-y-3">
              <div className="w-24 h-24 rounded-ds-avatar squircle bg-muted motion-safe:animate-pulse mx-auto" />
              <div className="h-6 w-40 bg-muted motion-safe:animate-pulse mx-auto rounded" />
              <div className="h-4 w-24 bg-muted motion-safe:animate-pulse mx-auto rounded" />
              <div className="h-4 w-64 bg-muted motion-safe:animate-pulse mx-auto rounded" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-ds-md liquid-glass p-3 space-y-2">
                  <div className="h-7 w-10 bg-muted motion-safe:animate-pulse mx-auto rounded" />
                  <div className="h-3 w-12 bg-muted motion-safe:animate-pulse mx-auto rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (isError) {
    return wrap(
      <>
        <PageHeader
          width="container-lg-5xl-6xl"
          eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
          title={isOwnProfile ? "Profile Review" : "Profile"}
          meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
          titleActions={headerActionPlaceholder}
        />
        <div className="container mx-auto px-5 py-6">
          <div className="max-w-2xl mx-auto flex">
            <ErrorState variant="inline" onRetry={() => refetch()} />
          </div>
        </div>
      </>
    );
  }

  if (!profile) {
    return wrap(
      <>
        <PageHeader
          width="container-lg-5xl-6xl"
          eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
          title={isOwnProfile ? "Profile Review" : "Profile"}
          meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
          titleActions={headerActionPlaceholder}
        />
        <div className="container mx-auto px-5 py-6">
          <div className="max-w-2xl mx-auto flex">
            <EmptyState
              variant="inline"
              icon={UserX}
              title="User not found"
              body="This profile may have been removed, or the link is no longer valid."
              action={
                <BarkPillButton onClick={() => navigate(-1)}>Go back</BarkPillButton>
              }
            />
          </div>
        </div>
      </>
    );
  }

  const displayName = formatName(profile.full_name);
  const initials = (profile.full_name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const badges = computeBadges({ avgRating: stats.avgRating, reviewCount: stats.reviewCount, completedJobs: stats.completedJobs, helprTier: profile.subscription_tier || null });

  const lastActiveLabel = computeLastActiveLabel(lastActiveAt);

  // Save or update the reviewee's public response to a review they received.
  const handleSaveResponse = async (reviewId: string) => {
    // Tapping Save on an empty textarea used to do nothing at all — no toast,
    // no state change, no reason given. Say why instead of dead-ending.
    if (!responseText.trim()) {
      toast.error("Write a response first.");
      return;
    }
    setSavingResponse(true);
    try {
      const { error } = await (supabase.rpc as any)("respond_to_review", {
        _review_id: reviewId,
        _response_text: responseText.trim(),
      });
      if (error) {
        if (error.code === "PGRST202") {
          toast.error("Couldn't save your response right now — try again?");
        } else {
          toast.error("Couldn't save your response — try again?");
        }
        return;
      }
      // Optimistic update locally so the response appears immediately.
      setLocalReviews((prev) =>
        (prev ?? reviewsFromQuery).map((r) =>
          r.id === reviewId
            ? { ...r, response_text: responseText.trim(), response_at: new Date().toISOString() }
            : r,
        ),
      );
      setRespondingToReview(null);
      setResponseText("");
      toast.success("Response saved.");
    } catch {
      toast.error("Couldn't save your response — try again?");
    } finally {
      setSavingResponse(false);
    }
  };

  return wrap(
    <>
      <PageHeader
        // Same width in EVERY state (loading / error / empty / loaded): this
        // used to be "5xl" while loading and "lg" once data landed, so the
        // title jumped hundreds of pixels the moment the query resolved. The
        // value mirrors the loaded body below — `container mx-auto px-5` >
        // `max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto`.
        width="container-lg-5xl-6xl"
        eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
        title={isOwnProfile ? "Profile Review" : "Profile"}
        meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
        // ONE header, not two. These used to ride in `rightSlot`, which renders
        // its own sticky `.glass-header` bar ABOVE the title block — so this
        // screen opened with an app bar of icons, then a second bar with the
        // back button and "Profile", and only then any content. That is the
        // stacked-header pattern already removed from Messages, Profile, My
        // Jobs, My Posts and PostJob; UserProfile was the one left. On the
        // title row they cost 0 extra vertical space (the row is taller than a
        // 40px icon button either way) and the 56px `h-14` bar is gone.
        //
        // The notch inset follows them: with no top bar, PageHeader's
        // `absorbSafeArea` branch pads the title block by
        // `var(--safe-area-top, 0px)` — the :root-resolved var, never a bare
        // env(), which reads 0 under <PageTransition>'s transform.
        titleActions={
          !isOwnProfile && currentUserId ? (
            <>
              {/* Persistent Message button (#2). Always shown for any
                  signed-in viewer who isn't viewing themselves, no matter
                  whether there's an active job context. Hitting it deep-
                  links into Messages scoped to this user — the inbox
                  picks up an existing thread, or surfaces a "no thread
                  yet" affordance. */}
              <Button
                variant="ghost"
                size="icon"
                className="rounded-ds-md h-10 w-10 shrink-0"
                aria-label={`Message ${displayName}`}
                onClick={() => navigate(`/messages?userId=${userId}`)}
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
              <SaveHelperButton helperId={userId!} customerId={currentUserId} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-ds-md h-10 w-10 shrink-0" aria-label="More options">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate(`/post-job?offerTo=${userId}`)}>
                    <Briefcase className="w-4 h-4 mr-2" /> Offer a job directly
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowReport(true)}>
                    <Flag className="w-4 h-4 mr-2" /> Report user
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowBlock(true)}>
                    <Ban className="w-4 h-4 mr-2" /> Block user
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null
        }
      />

      <div className="container mx-auto px-5 py-6">
        {/* Split-column desktop layout: the mobile-first single column
            (max-w-lg centered) widens to a two-column masthead + reviews
            layout at lg+. Below lg the grid collapses to one column and
            the section order stays exactly as it was on mobile — the
            left-column blocks (identity, milestones) render first, then
            the right-column blocks (stats, reviews, history, etc.) stack
            below. Outer container widens per Profile.tsx precedent so
            desktop uses the full app-shell width instead of an lg-column
            marooned in dead margin. */}
        <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 xl:gap-12 items-start">
          {/* ── LEFT COLUMN (masthead) ──
              Identity, trust chips, bio, career milestones. Sticky at
              lg+ so it stays visible as the viewer scrolls through the
              reviews / history on the right. `self-start` keeps sticky
              working under `items-start` (otherwise the grid would
              stretch this column to match the taller right column and
              the sticky element would have nothing to slide against). */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-5 lg:sticky lg:top-6 lg:self-start">
            {/* Profile Card — brand-aligned hero. Avatar with tier ring,
                italic display name, italic serif meta and bio. */}
            <ProfileHeaderCard
              profile={profile}
              userId={userId!}
              displayName={displayName}
              initials={initials}
              isOwnProfile={isOwnProfile}
              isIdVerified={isIdVerified}
              lastActiveLabel={lastActiveLabel}
              mutualJobsCount={mutualJobsCount}
              responseMetrics={responseMetrics}
              onTimeArrivalRate={onTimeArrivalRate}
              revisionFrequency={revisionFrequency}
              cancellationRate={cancellationRate}
              hasCleanRecord={hasCleanRecord}
              petCareSignal={petCareSignal}
              badges={badges}
              tierProfile={tierProfile}
              stats={stats}
              hasSubmittedCredentials={hasSubmittedCredentials}
              workedJobs={workedJobs}
              showNearbyProof={showNearbyProof}
              onShowNearbyProof={() => setShowNearbyProof(true)}
              viewerLoc={viewerLoc}
              jobsNearbyCount={jobsNearbyCount}
              nearbyRadiusMi={NEARBY_RADIUS_MI}
            />

            {/* Career milestones — earned badges based on job count, rating,
                and credential tier. Shows next-milestone progress on own profile.
                Sits with identity in the masthead because it's a persistent
                trust-signal about the person, not about a specific interaction.

                credentialTier (0-3; 2 = verified trade license) now comes from
                the get_user_credential_tier RPC via useUserProfileData, and is
                0 when that RPC errors or isn't deployed. It used to be computed
                inline as
                  `data?.credentialTier ?? profile?.license_status === "verified" ? 2 : 0`
                — `??` binds tighter than `?:`, so that parsed as
                `(undefined ?? false) ? 2 : 0` and was permanently 0. It also
                read a `license_status` column that neither get_safe_profiles
                nor the fallback select ever returns, so no precedence fix alone
                could have made it non-zero. */}
            <CareerMilestones
              stats={{
                completedJobs: stats.completedJobs,
                avgRating: stats.avgRating,
                repeatHirePercent: data?.repeatHirePercent ?? 0,
                credentialTier: data?.credentialTier ?? 0,
              }}
              showProgress={isOwnProfile}
            />
          </div>

          {/* ── RIGHT COLUMN (activity + reviews) ──
              Stats, rating breakdown, poster reputation, skill
              endorsements, review wall + expanded reviews, job history,
              availability, portfolio, member-since, report affordance.
              This column takes the scroll so the masthead can stay
              pinned as the viewer reads reviews. */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-5">
            {/* Profile completion nudge — only shown to the owner, hidden at 100% */}
            {isOwnProfile && userId && (
              <ProfileCompletionCard
                avatarUrl={profile.avatar_url}
                bio={profile.bio}
                skills={profile.skills}
                completedJobs={stats.completedJobs}
                reviewCount={stats.reviewCount}
                userId={userId}
              />
            )}

            {/* Paid background-check → public Background-Checked badge.
                Own profile only; self-hides into a confirmation once verified. */}
            {isOwnProfile && (
              <BackgroundCheckCard status={backgroundCheckStatus} />
            )}

            {/* Stats */}
            <ProfileStatsGrid
              stats={stats}
              // postedTotalCount, NOT postedJobs.length — the `postedJobs`
              // fetch carries a .limit(20), so the stat read "20 Posted" for
              // anyone with more than 20 jobs. The exact count is already
              // fetched on this same load (count: exact, head: true) and was
              // simply never wired up. The list below still shows 20; the
              // number above it is now true.
              postedJobsCount={postedTotalCount}
              workedJobsCount={completedWorkedJobs.length}
              isOwnProfile={isOwnProfile}
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

            {/* ── Rating distribution + sub-ratings (1a/1b) ── */}
            <RatingBreakdown reviews={reviews} />

            {/* ── As a job poster (1c) ── */}
            <PosterReputationCard
              postedTotalCount={postedTotalCount}
              postedCancelledCount={postedCancelledCount}
              posterReputation={posterReputation}
            />

            {/* Skill endorsements — pills showing the helper's endorsed
                skills. Past clients (mutual job count > 0) see a + button
                to endorse. Own profile hides the section here (managed
                in ProfileLanding instead). */}
            {!isOwnProfile && (
              <SkillEndorsements
                profileUserId={userId!}
                viewerUserId={currentUserId}
                canEndorse={!isOwnProfile && mutualJobsCount > 0}
              />
            )}

            {/* Recent reviews — public trust-signal wall (#86). Always
                visible on other-user profiles so prospective posters see
                quotes from past customers without having to expand the
                full reviews tab. Owner sees the existing toggle only. */}
            {!isOwnProfile && (
              <PublicReviewWall
                helperId={userId!}
                totalReviewCount={stats.reviewCount}
                onSeeAll={
                  stats.reviewCount > 5
                    ? () => {
                        setShowReviews(true);
                        setShowPostedJobs(false);
                        setShowWorkedJobs(false);
                      }
                    : undefined
                }
              />
            )}

            {/* Reviews expanded inline — filter by category/rating +
                progressive pagination (#27). */}
            {showReviews && (
              <ReviewsSection
                reviews={reviews}
                isOwnProfile={isOwnProfile}
                profileFullName={profile.full_name}
                reviewCategoryFilter={reviewCategoryFilter}
                reviewRatingFilter={reviewRatingFilter}
                reviewVisibleCount={reviewVisibleCount}
                onSetReviewCategoryFilter={setReviewCategoryFilter}
                onSetReviewRatingFilter={setReviewRatingFilter}
                onSetReviewVisibleCount={setReviewVisibleCount}
                onResetVisibleCount={setReviewVisibleCount}
                respondingToReview={respondingToReview}
                responseText={responseText}
                onSetResponseText={setResponseText}
                onStartResponding={(reviewId, initial) => {
                  setResponseText(initial);
                  setRespondingToReview(reviewId);
                }}
                onCancelResponding={() => setRespondingToReview(null)}
                onSaveResponse={handleSaveResponse}
                savingResponse={savingResponse}
                reviewsHasMore={reviewsHasMore}
                reviewsTotalCount={reviewsTotalCount}
                loadMoreReviews={loadMoreReviews}
                loadingMoreReviews={loadingMoreReviews}
              />
            )}

            {/* Posted Jobs expanded inline */}
            {showPostedJobs && <JobsList jobs={postedJobs} variant="posted" />}

            {/* Worked Jobs expanded inline */}
            {showWorkedJobs && <JobsList jobs={completedWorkedJobs} variant="worked" />}

            {profile.hourly_rate && (
              <div className="rounded-2xl liquid-glass p-5 flex items-center gap-3">
                <Clock className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-ds-13 font-semibold text-foreground">${profile.hourly_rate}/hr</p>
                  <p className="text-ds-11 text-muted-foreground">Hourly rate</p>
                </div>
              </div>
            )}

            {/* Availability */}
            <HelperAvailabilityDisplay helperId={userId!} />

            {/* Portfolio — Pro+ only */}
            {(profile.subscription_tier === "pro" || profile.subscription_tier === "elite") && <HelperPortfolio helperId={userId!} />}

            {/* Member since */}
            <p className="text-ds-11 text-muted-foreground text-center">
              Member since {new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>

            {/* Inline "Report this profile" surface (#29). The header dropdown
                still exposes Report, but a viewer who feels uneasy after
                reading the bio shouldn't have to hunt the 3-dot menu. Kept
                low-key (muted text, no destructive color) so it reads as a
                safety affordance rather than an accusation. */}
            {!isOwnProfile && currentUserId && (
              <div className="pt-2 flex justify-center">
                <button
                  onClick={() => setShowReport(true)}
                  className="inline-flex items-center gap-1.5 text-ds-11 text-muted-foreground underline-offset-4 hover:underline hover:text-foreground transition-colors min-h-[44px] px-3"
                  aria-label="Report this profile"
                >
                  <Flag className="w-3 h-3" />
                  Report this profile
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showReport && userId && (
        <ReportDialog
          open={showReport}
          onClose={() => setShowReport(false)}
          reportedType="user"
          reportedId={userId}
        />
      )}

      {showBlock && userId && profile && (
        <BlockUserDialog
          open={showBlock}
          onClose={() => setShowBlock(false)}
          blockedUserId={userId}
          blockedUserName={formatName(profile.full_name) || "this user"}
          onBlocked={() => navigate("/dashboard", { replace: true })}
        />
      )}
    </>
  );
};

export default UserProfile;
