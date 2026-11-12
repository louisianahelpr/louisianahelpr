import { useState, useEffect, type ReactNode } from "react";
import { formatName } from "@/lib/utils";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Ban, UserX } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { HelperWorkPhotos } from "@/components/profile/HelperWorkPhotos";
import { UserProfileMasthead } from "./UserProfileMasthead";
import { UserProfileLoadingBody } from "./UserProfileLoadingBody";
import BackgroundCheckCard from "@/components/profile/BackgroundCheckCard";
import { RatingBreakdown } from "./RatingBreakdown";
import { ReviewsSection } from "./ReviewsSection";
import { JobsList } from "./JobsList";
import { ProfileDeclutterSections } from "./ProfileDeclutterSections";
import { PROFILE_FROM_DECLUTTER, PROFILE_FROM_PARAM } from "@/lib/profileLink/memberProfilePath";
import { useDeclutterReviewCount } from "./useDeclutterReviewCount";
import { InviteToJobBar } from "./InviteToJobBar";
import { OwnProfileActions } from "./BookMeShareButton";
import { VisitorProfileActions } from "./VisitorProfileActions";
import { useBlockedByMe } from "./useBlockedByMe";
import { useUserProfileData } from "./useUserProfileData";
import { useReviewResponse } from "./useReviewResponse";
import { computeLastActiveLabel } from "./userProfileHelpers";

import ReportDialog from "@/components/ReportDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { useReplySpeed } from "@/lib/trustLine";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUnblock } from "./useUnblock";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** Your own public profile is a preview, titled by what it is (app audit A3-C7). */
const OWN_PROFILE_TITLE = "How others see you";

const UserProfile = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentAuthUser } = useCurrentUser();
  const currentUserId = currentAuthUser?.id ?? null;

  // Q367 (owner, 2026-09-24): the profile of someone YOU blocked shows "You
  // blocked this person" and an Unblock button, and none of their details.
  // Blocker side only — a person who blocked you still sees nothing new here.
  const { blockedByMeKey, data: blockedByMe, status: blockStatus, isError: blockError, refetch: refetchBlock } = useBlockedByMe(currentUserId, userId);
  const { unblocking, handleUnblock } = useUnblock(currentUserId, userId, blockedByMeKey);

  const [showReviews, setShowReviews] = useState(searchParams.get("tab") === "reviews");
  // F359i (owner 11-12): opened from a Declutter listing, the seller's Declutter sits above the masthead.
  const declutterFirst = searchParams.get(PROFILE_FROM_PARAM) === PROFILE_FROM_DECLUTTER;

  // Handle Stripe subscription checkout return. The confirmation used to be
  // a toast on the suppressed channel, so completing (or cancelling) checkout
  // landed back here in total silence. One-shot inline banner; the param is
  // stripped so a refresh doesn't repeat it.
  const [proReturn, setProReturn] = useState<"success" | "cancel" | null>(null);
  useEffect(() => {
    const pro = searchParams.get("pro");
    if (!pro) return;
    if (pro === "success" || pro === "cancel") setProReturn(pro);
    const next = new URLSearchParams(searchParams);
    next.delete("pro");
    setSearchParams(next, { replace: true });
  }, []);

  const [showPostedJobs, setShowPostedJobs] = useState(false);
  const [showWorkedJobs, setShowWorkedJobs] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  // Reviews filter + pagination (#27). Category null = "all", rating null
  // = "all". Visible count starts at PAGE_SIZE and grows in PAGE_SIZE
  // increments via the "Show more" button at the bottom of the list.
  const [reviewCategoryFilter, setReviewCategoryFilter] = useState<string | null>(null);
  // Star-filter bucket (#3): "all" | "5" | "4" | "low" (≤3); three buckets read cleaner than five rating chips.
  const [reviewRatingFilter, setReviewRatingFilter] = useState<"all" | "5" | "4" | "low">("all");
  const [reviewVisibleCount, setReviewVisibleCount] = useState(5);
  // All Supabase fetching + derivation lives in this hook (extracted verbatim).
  const {
    data,
    isError,
    refetch,
    reviewsFromQuery,
    setLocalReviews,
    reviews,
    stats,
    loadingMoreReviews,
    reviewsHasMore,
    reviewsTotalCount,
    loadMoreReviews,
    postedJobs,
    completedWorkedJobs,
    completedWorkedCount,
    badgeStats,
    credentialTier,
    canReadReviewText,
    reviewsLoadFailed,
    replyLatency,
    mutualJobsCount,
    onTimeArrivalRate,
    revisionFrequency,
    lastActiveBand,
    isIdVerified,
    backgroundCheckStatus,
    tierProfile,
    postedTotalCount,
    loading,
    offlineEmpty,
  } = useUserProfileData(userId, currentUserId);
  const { respondingToReview, setRespondingToReview, responseText, setResponseText, savingResponse, handleSaveResponse } = useReviewResponse(setLocalReviews, reviewsFromQuery);
  const declutterReviewCount = useDeclutterReviewCount(userId);
  // Q2478 2b: the public reply-speed bucket (signed-in viewers only; get_reply_speed refuses anon).
  const replyBucket = useReplySpeed(currentUserId && userId ? [userId] : []).get(userId ?? "") ?? null;

  const profile = (data?.profile ?? null) as Profile | null;

  // Computed up-front so the loading skeleton can render the same
  // PageHeader (eyebrow/title/meta) as the loaded state — both only
  // depend on the route param + current user, not the fetched profile.
  const isOwnProfile = currentUserId === userId;

  // Identity, computed BEFORE the loading/error/empty guards so the page title
  // and the header can both use it and so this stays above every early return
  // (usePageTitle is a hook).
  const displayName = formatName(profile?.full_name);
  const memberSinceLabel = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

  // THE HEADER SAYS "Profile", FULL STOP (owner, 2026-08-31: "put the name
  // back in the box and profile back where it was to the right of back").
  //
  // An earlier pass this morning put the member's NAME in this h1. That is
  // what emptied the masthead: the card stopped printing the name to avoid
  // saying it twice, and was left as an avatar next to a bare "Since May
  // 2026". The h1 is a fixed label again, sitting right of the back button
  // where it has always been, and the name is back in the box beside the
  // avatar — where it appears exactly once.
  //
  // The own-profile view is titled by what it is: there the subject is not a
  // stranger to identify, it is the preview itself, and the whole screen
  // exists to answer "what do others see?" (app audit A3-C7: "Profile Review" never said so at 375).
  const headerTitle = isOwnProfile ? OWN_PROFILE_TITLE : "Profile";

  // The BROWSER TAB still names the person — a tab strip with four identical
  // "Profile — Helpr" entries is useless, and a document title is not a
  // second heading on the screen. `profile?.full_name`, NOT `displayName`:
  // `formatName` falls back to the literal "A neighbor" for a missing name,
  // so keying off it made the tab read "A neighbor" for the whole load.
  usePageTitle(
    isOwnProfile
      ? `${OWN_PROFILE_TITLE} — Helpr`
      : profile?.full_name
        ? `${displayName} — Helpr`
        : "Profile — Helpr",
  );

  const headerEyebrow = isOwnProfile ? "How others see you" : "Helpr profile";
  // NOTE: PageHeader paints NEITHER `eyebrow` NOR `meta` — both were retired
  // app-wide (see the note in PageHeader.tsx); the props are kept only so the
  // ~140 existing call sites don't churn. So these two are passed for parity
  // with every sibling page, and the facts a visitor actually needs (place,
  // tenure) are rendered by ProfileHeaderCard instead. Do not "fix" a missing
  // subtitle by re-adding it here — it will not paint.
  const headerMeta = isOwnProfile
    ? "A preview of what someone hiring you sees"
    : "Reviews, badges, and history";

  // Whether the loaded header will render trailing actions (Message, Save,
  // overflow). Mirrored as a placeholder in the skeleton / not-found states so
  // the header keeps the same layout (one title row, actions flush right)
  // before and after the fetch resolves — no height jump.
  const headerHasActions = !isOwnProfile && !!currentUserId;
  // TWO bones, one per control the loaded header carries: SaveHelperButton
  // and the overflow menu (both `h-10 w-10`). The third stood in for the
  // Message button, which the owner removed from this page ("only the poster
  // can message"), so the placeholder promised a control that never arrives.
  const headerActionPlaceholder = headerHasActions ? (
    <div className="flex items-center gap-1" aria-hidden>
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
  //
  // NO `flex flex-col` + `flex-1` STRETCH HERE ANY MORE, and no `mt-auto` on
  // the closing block. That combination was an attempt to answer "roughly a
  // third of the screen is empty grey" by stretching the column to the shell
  // and pinning the trust footer to the bottom of it. It did not remove the
  // empty third — it MOVED it, out of the tail and into the middle of the
  // page, between the last card and the footer. Measured on a sparse profile
  // before this change: a 177–199px hole sat between the masthead and
  // "Booking on Helpr" at every one of 320 / 375 / 768 / 1440.
  //
  // Owner's call: unpin it. Content flows, the closing block follows the last
  // card, and the page simply ends there. Leftover space belongs at the end
  // of a short page, not punched through the middle of it.
  const wrap = (inner: ReactNode) => (
    <div className="min-h-screen bg-premium-page pb-safe-nav">{inner}</div>
  );

  // Fail closed: while the block check loads or errors, show the loading /
  // error state rather than briefly painting the details of someone blocked.
  // Q571: "pending", not isLoading. A block check paused offline has isLoading
  // false and no answer, and reading that as "checked" painted the profile.
  const blockCheckPending = !!currentUserId && !!userId && currentUserId !== userId && (blockStatus === "pending" || blockError);
  if (blockedByMe || (blockCheckPending && blockError)) {
    return wrap(
      <>
        <PageHeader eyebrow={headerEyebrow} title="Profile" meta={headerMeta} />
        <div className="page-measure mx-auto px-5 lg:px-6 xl:px-6 pb-8">
          <div className="flex">
            {blockedByMe ? (
              <EmptyState
                variant="inline"
                icon={Ban}
                title="You blocked this person"
                body="Their profile is hidden, and they can't message you or apply to your jobs. Unblock them to see it again."
                action={
                  <BarkPillButton onClick={handleUnblock} disabled={unblocking}>
                    {unblocking ? "Unblocking…" : "Unblock"}
                  </BarkPillButton>
                }
              />
            ) : (
              <ErrorState variant="inline" onRetry={() => refetchBlock()} />
            )}
          </div>
        </div>
      </>
    );
  }

  if (loading || blockCheckPending) {
    return wrap(
      <>
        <PageHeader
          eyebrow={headerEyebrow}
          title={headerTitle}
          meta={headerMeta}
          titleActions={headerActionPlaceholder}
        />
        <UserProfileLoadingBody proReturn={proReturn} />
      </>
    );
  }

  // One shell for the three states with no profile to show (offline, error,
  // not found): the same header and column as the loaded page.
  // No action placeholders here: with no profile there are no actions to
  // arrive, so the grey boxes would never resolve (audit #48).
  const stateCard = (card: ReactNode) =>
    wrap(
      <>
        <PageHeader eyebrow={headerEyebrow} title={headerTitle} meta={headerMeta} />
        <div className="page-measure mx-auto px-5 lg:px-6 xl:px-6 pb-8">
          <div className="flex">{card}</div>
        </div>
      </>,
    );

  if (offlineEmpty) {
    return stateCard(
      <OfflineEmptyState body="This profile will load here as soon as you're back online." onRetry={() => void refetch()} />,
    );
  }

  if (isError) return stateCard(<ErrorState variant="inline" onRetry={() => refetch()} />);

  if (!profile) {
    return stateCard(
      <EmptyState
        variant="inline"
        icon={UserX}
        title="Profile not found"
        body="This profile may have been removed, or the link is no longer valid."
        // The header's back arrow already goes back (audit #48: "Go back"
        // duplicated it); the way ON is Jobs, where they came looking for a Helpr.
        action={<BarkPillButton onClick={() => navigate("/jobs")}>Browse jobs</BarkPillButton>}
      />,
    );
  }

  // `.filter(Boolean)` before `.map`: " ".split(" ") is ["", ""], whose first
  // characters are `undefined`, and Array#join turns those into "" — so a
  // whitespace-only name produced EMPTY initials, and the avatar fallback
  // painted a coloured square with nothing in it. (ProfileHeaderCard carries
  // its own last-resort guard too; this one keeps the bad value from being
  // manufactured in the first place.)
  const initials =
    (profile.full_name || "")
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";
  // NO `computeBadges` CALL HERE ANY MORE. Owner, 2026-09-11: the
  // performance-badge group (Highly Rated / Trusted / On Fire / Fast
  // Responder / Community Fav / Reliable) is deleted from this page — it
  // collided with the career ladder three ways, most visibly by printing
  // "Trusted" three times at three thresholds. Career milestones are the
  // earned system; the subscription tier is still the one header badge
  // (<SubscriptionTierBadge>). `computeBadges` itself survives only for
  // JobPosterCard, which is a different surface.

  const lastActiveLabel = computeLastActiveLabel(lastActiveBand);

  return wrap(
    <>
      <PageHeader
        // DEFAULT width, in EVERY state (loading / error / empty / loaded).
        //
        // Two things this guards. First, the width used to be "5xl" while
        // loading and "lg" once data landed, so the title jumped hundreds of
        // pixels the moment the query resolved — hence the same value on all
        // four headers on this page.
        //
        // Second, that value is now the SHARED one. This page used to carry a
        // bespoke `container px-5 > max-w-lg lg:max-w-5xl xl:max-w-6xl` ladder,
        // so "Profile" sat on a different left edge and a different column
        // width from the title on every other document-scroll page (owner:
        // "spacing for title should be the same as all other pages"). Header
        // and body both use the canonical shell now — `page-measure mx-auto
        // px-5 lg:px-6 xl:px-6 pt-4 pb-8` — which is exactly what the
        // header's `default` width resolves to, so the two share one edge.
        eyebrow={headerEyebrow}
        title={headerTitle}
        meta={headerMeta}
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
            <VisitorProfileActions userId={userId} currentUserId={currentUserId} onReport={() => setShowReport(true)} onBlock={() => setShowBlock(true)} />
          ) : isOwnProfile ? (
            <OwnProfileActions userId={userId} displayName={displayName} />
          ) : null
        }
      />

      {/* THE BODY IS A PLAIN DOCUMENT COLUMN — it does NOT stretch.
          See the note on `wrap` above: stretching it and pinning the footer
          with `mt-auto` relocated the empty band into the middle of the page.

          ORDER, top to bottom: who they are (identity + bio) → what their
          record says (At a glance, endorsements, reviews, history) → how
          booking works. Nothing about the platform outranks the person.

          NO per-page desktop-rail inset here, deliberately. The rail is inset
          in exactly ONE layer, globally: document-scroll pages like this one
          get it from `html.web-desktop.desktop-rail:not(.app-shell) #root` in
          index.css. Re-insetting here would push the column by a second rail
          width (the PostJob bug). `/user` is in DOCUMENT_SCROLL_ROUTES and
          this page is a plain `min-h-screen` document-scroll surface — shell
          choice and route list agree. */}
      <div
        data-profile-body
        className="page-measure mx-auto px-5 lg:px-6 xl:px-6 pb-8 w-full"
      >
        {/* ONE COLUMN at every width (owner: "should all be in 1 column", and
            "fix this to all go up and down"). The 12-col split put the identity
            card in a narrow left rail — where "You've worked together 1 time"
            wrapped to two lines and the bio to three — while three stat tiles
            sat alone across a much wider right column with a screen of empty
            page under them. A profile is read top to bottom; splitting it made
            the left half cramped and the right half hollow.

            Width is used INSIDE the sections instead: the At-a-glance grid
            goes 2-up → 6-up, the chip rows wrap, and prose carries its own
            reading cap. That is how a single column fills a 1440 frame without
            reintroducing a layout the owner has already rejected. */}
        <div className="flex flex-col gap-section items-stretch">
          {declutterFirst && <ProfileDeclutterSections userId={userId!} />}
          <UserProfileMasthead
            profile={profile} userId={userId} displayName={displayName} initials={initials} isOwnProfile={isOwnProfile}
            isIdVerified={isIdVerified} badgeStats={badgeStats} data={data} credentialTier={credentialTier} tierProfile={tierProfile}
            lastActiveLabel={lastActiveLabel} memberSinceLabel={memberSinceLabel} stats={stats} postedTotalCount={postedTotalCount}
            completedWorkedCount={completedWorkedCount} declutterReviewCount={declutterReviewCount} replyLatency={replyLatency}
            onTimeArrivalRate={onTimeArrivalRate} revisionFrequency={revisionFrequency} replyBucket={replyBucket}
            mutualJobsCount={mutualJobsCount} showReviews={showReviews} showPostedJobs={showPostedJobs} showWorkedJobs={showWorkedJobs}
            setShowReviews={setShowReviews} setShowPostedJobs={setShowPostedJobs} setShowWorkedJobs={setShowWorkedJobs}
          />
          {!declutterFirst && <ProfileDeclutterSections userId={userId!} />}

          {/* "No disputes on record" USED TO RENDER HERE, in green, as the
              positive half of the Track Record card. It is gone, and its
              backing query with it.

              It was not a weak signal — it was an unfounded one. It fired on
              `count === 0` from a client-side `job_disputes` SELECT, and that
              table's RLS ("Job parties and admins can view job_disputes",
              20260612190000_dispute_revision.sql) only returns rows for jobs
              the VIEWER was a party to. A stranger can never see another
              member's disputes, so the count was always 0 and the badge
              rendered an affirmative safety claim on every profile in the app,
              regardless of the truth. It was also measuring the wrong thing:
              it counted disputes this person OPENED, not disputes opened
              against them.

              A truthful version needs a SECURITY DEFINER RPC that returns an
              aggregate the way `helper_repeat_hire_percent` does; until that
              exists the honest move is to claim nothing. */}


          {/* ── RIGHT COLUMN (activity + reviews) ──
              Stats, rating breakdown, poster reputation, skill
              endorsements, review wall + expanded reviews, job history,
              availability, portfolio, member-since, report affordance.
              This column takes the scroll so the masthead can stay
              pinned as the viewer reads reviews. */}
          <div className="space-y-section">
            {/* The "Boost your profile" completion card used to sit here, on the
                owner's own view of this page. It is gone (owner, 2026-08-27:
                "preview shouldn't have that at all").

                THIS PAGE IS THE PREVIEW. Its whole job is to show the user what
                a stranger sees — the header literally reads "How others see you
                · A preview of what someone hiring you sees". A completion meter and
                a self-improvement checklist are things no visitor can ever see,
                so putting them here made the preview lie about the one thing it
                exists to report.

                It was also contradicting the meter it duplicated: this card
                scored five fields of its own (photo 25 / bio 20 / skills 20 /
                three completed jobs 20 / one review 15) and read 45% on the very
                account whose Edit-Profile meter — the shared
                `getProfileCompletion` helper — read 100%. Profile completion now
                lives in exactly one place: Edit Profile.

                Nothing became unreachable. Every incomplete row on that
                checklist navigated to `/profile?tab=profile` (photo, bio,
                skills) or `/home` (find jobs); both are one tap from the
                bottom nav, and the Edit-Profile form owns those fields. */}

            {/* Paid background-check → public Background-Checked badge.
                Own profile only; self-hides into a confirmation once verified. */}
            {isOwnProfile && (
              <BackgroundCheckCard status={backgroundCheckStatus} />
            )}


            {/* ── Rating distribution + sub-ratings (1a/1b) ── Rides with the
                reviews expansion; on its own it was a chart with no context. */}
            {/* Only when there is something to break down. Expanding Reviews
                rendered RatingBreakdown + PublicReviewWall + ReviewsSection at
                once, so a profile with no reviews opened three empty panels
                (owner, 2026-08-25: "it opens 3 blank tabs that shows no
                reviews"). ReviewsSection owns the real "No reviews yet" state,
                so the two supplementary panels stand down and the user gets one
                honest answer instead of three blank ones. */}
            {showReviews && reviews.length > 0 && <RatingBreakdown reviews={reviews} />}

            {/* No "As a job poster — N jobs posted" panel (owner: "remove, it
                already says this above"). It opened from the "Posted" stat box
                and its headline number WAS that stat box's number, restated a
                few hundred pixels lower with a label around it. Tapping a stat
                to be told the stat again is the definition of a dead expand.
                The posted-jobs LIST it reveals below is the useful half and
                still opens on the same tap. */}

            {/* Skill endorsements section removed 2026-09-04 — cut, not
                hidden. `helper_skills` had exactly one reference in the
                whole repo (the read this component did) and no INSERT
                anywhere in src/ or supabase/functions/: there was no way
                for a helper to ever add a skill, so the section this
                mounted was structurally guaranteed to render empty forever.
                Both `helper_skills` and `skill_endorsements` are dropped
                (migration 20260904034410). */}

            {/* ONE review list (owner, 2026-09-15, VN-15 pop-up: "One list
                only"). The recent-reviews wall (PublicReviewWall) used to
                render here too, so expanding reviews showed the same quotes
                twice in two card styles. The rating summary above and the
                filterable ReviewsSection below are the whole review surface
                now; ReviewsSection already says "Sign in to read all N
                reviews" to a signed-out visitor. */}
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
                trueReviewCount={stats.reviewCount}
                canReadReviewText={canReadReviewText}
                reviewsLoadFailed={reviewsLoadFailed}
                onRetryReviews={() => void refetch()}
                loadMoreReviews={loadMoreReviews}
                loadingMoreReviews={loadingMoreReviews}
              />
            )}

            {/* Posted Jobs expanded inline */}
            {showPostedJobs && (
              <JobsList jobs={postedJobs} variant="posted" knownCount={postedTotalCount} viewerId={currentUserId} isOwnProfile={isOwnProfile} />
            )}

            {/* Worked Jobs expanded inline */}
            {showWorkedJobs && (
              <JobsList
                jobs={completedWorkedJobs}
                variant="worked"
                knownCount={completedWorkedCount}
                viewerId={currentUserId}
                isOwnProfile={isOwnProfile}
              />
            )}

            {/* No hourly-rate card. Louisiana Helpr prices jobs POSTER-side:
                the poster sets the price and the helper bids against it, so a
                helper's own "$X/hr" is not a number anybody transacts on. It
                was shown here for months but could never be set (its editor
                had been deleted), so every profile omitted it anyway. Retired
                deliberately 2026-08-27 rather than given an editor. */}

            {/* No Availability section on the PUBLIC profile (owner, 2026-09-14,
                VN-12). The own Profile Availability tab still edits it. */}

            {/* Recent work — photos the helper uploaded on their own profile.
                Ungated on purpose; see HelperWorkPhotos for why. */}
            <HelperWorkPhotos urls={profile.portfolio_urls ?? []} />

            {/* No "Work portfolio" of job proof photos (Q2026, lead decision (A) 2026-11-04):
                proof photos live in the private proof-photos bucket, readable only by the two
                people on the job, and are often taken inside someone's home. Recent work above
                is the past-work grid, built from the Helpr's own uploads only. */}


          </div>

        </div>

        {/* Every member can be invited, a new one included: every account posts and does jobs (app audit A3-C9). */}
        {!isOwnProfile && currentUserId && <InviteToJobBar userId={userId!} />}
      </div>

      {showReport && userId && (
        <ReportDialog
          open={showReport}
          onClose={() => setShowReport(false)}
          reportedType="user" reportedId={userId}
          alsoBlock={profile ? { name: formatName(profile.full_name) || "this person", onBlock: () => setShowBlock(true) } : undefined}
        />
      )}

      {showBlock && userId && profile && (
        <BlockUserDialog
          open={showBlock}
          onClose={() => setShowBlock(false)}
          blockedUserId={userId}
          blockedUserName={formatName(profile.full_name) || "this user"}
          onBlocked={() => navigate("/home", { replace: true })}
        />
      )}
    </>
  );
};

export default UserProfile;
