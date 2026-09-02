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
import { Banknote, Briefcase, Crown, Lock, MoreVertical, Flag, Ban, ShieldCheck, UserX } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { HelperAvailabilityDisplay } from "@/components/HelperAvailabilityDisplay";
import { computeBadges } from "@/components/HelperBadges";
import { HelperPortfolio } from "@/components/HelperPortfolio";
import { HelperWorkPhotos } from "@/components/profile/HelperWorkPhotos";
import { PublicReviewWall } from "@/components/profile/PublicReviewWall";
import { SkillEndorsements } from "@/components/profile/SkillEndorsements";
import { ProfileHeaderCard } from "./userProfile/ProfileHeaderCard";
import BackgroundCheckCard from "@/components/profile/BackgroundCheckCard";
import { AtAGlanceCard } from "./userProfile/AtAGlanceCard";
import { RecognitionRow } from "./userProfile/RecognitionRow";
import { RatingBreakdown } from "./userProfile/RatingBreakdown";
import { ReviewsSection } from "./userProfile/ReviewsSection";
import { JobsList } from "./userProfile/JobsList";
import { useUserProfileData } from "./userProfile/useUserProfileData";
import { computeLastActiveLabel } from "./userProfile/userProfileHelpers";

import ReportDialog from "@/components/ReportDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import SaveHelperButton from "@/components/SaveHelperButton";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { hasInAppHistory } from "@/lib/inAppHistory";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const UserProfile = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentAuthUser } = useCurrentUser();
  const currentUserId = currentAuthUser?.id ?? null;

  const [showReviews, setShowReviews] = useState(searchParams.get("tab") === "reviews");

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
    completedWorkedCount,
    canReadReviewText,
    statSamples,
    replyLatency,
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
    loading,
  } = useUserProfileData(userId, currentUserId);

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
  // The own-profile view keeps "Profile Review": there the subject is not a
  // stranger to identify, it is the preview itself, and the whole screen
  // exists to answer "what do others see?".
  const headerTitle = isOwnProfile ? "Profile Review" : "Profile";

  // The BROWSER TAB still names the person — a tab strip with four identical
  // "Profile — Helpr" entries is useless, and a document title is not a
  // second heading on the screen. `profile?.full_name`, NOT `displayName`:
  // `formatName` falls back to the literal "A neighbor" for a missing name,
  // so keying off it made the tab read "A neighbor" for the whole load.
  usePageTitle(
    isOwnProfile
      ? "Profile Review — Helpr"
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
    ? "A preview from a poster's perspective"
    : "Reviews, badges, and history";

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

  if (loading) {
    return wrap(
      <>
        <PageHeader
          eyebrow={headerEyebrow}
          title={headerTitle}
          meta={headerMeta}
          titleActions={headerActionPlaceholder}
        />
        <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pb-8">
          {/* The SAME wrapper the loaded body uses below — full page measure,
              one column, gap-6. It used to carry `max-w-2xl mx-auto`, a cap no
              other state on this page has: 86545cb12 moved all four states onto
              the shared shell and dropped that cap from the error and not-found
              branches, but missed this one. Measured at 1440: the skeleton
              column sat at 672px and the loaded column at 1096px, so the page
              visibly grew 1.63x the instant the query resolved — the owner's
              "opens small then gets bigger".

              The bones below also mirror the real card SHAPES rather than
              approximating them, because width was only half of it: two bones
              (~300px) were standing in for a body that runs 600–1500px, so the
              page grew vertically too, on every viewport including phone where
              the width cap never binds. */}
          <div className="flex flex-col gap-6 items-stretch">
            {proReturn && (
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-2xl"
                style={{ background: "hsl(var(--bark) / 0.06)", border: "1px solid hsl(var(--bark) / 0.16)" }}
                role="status"
              >
                <Crown className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
                <p className="text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
                  {proReturn === "success"
                    ? "Membership upgrade confirmed — your new perks are live."
                    : "Checkout canceled — no charge was made."}
                </p>
              </div>
            )}
            {/* Mirrors ProfileHeaderCard: below sm one centred stack, at sm+ a
                fixed identity column beside the record. */}
            <div className="rounded-2xl liquid-glass p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-5">
              <div className="flex flex-col items-center sm:items-start gap-2 sm:w-[212px] sm:shrink-0">
                <div className="w-24 h-24 rounded-ds-avatar squircle bg-muted motion-safe:animate-pulse" />
                <div className="h-6 w-40 bg-muted motion-safe:animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted motion-safe:animate-pulse rounded" />
              </div>
              <div className="flex-1 space-y-3 w-full">
                <div className="h-4 w-full bg-muted motion-safe:animate-pulse rounded" />
                <div className="h-4 w-5/6 bg-muted motion-safe:animate-pulse rounded" />
                <div className="h-16 w-full bg-muted motion-safe:animate-pulse rounded" />
              </div>
            </div>
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="rounded-ds-md liquid-glass p-3 space-y-2">
                    <div className="h-7 w-10 bg-muted motion-safe:animate-pulse mx-auto rounded" />
                    <div className="h-3 w-12 bg-muted motion-safe:animate-pulse mx-auto rounded" />
                  </div>
                ))}
              </div>
              {/* Endorsements, availability and portfolio each run their OWN
                  fetch and return null until it lands, so they arrive in a
                  second wave after this skeleton is already gone. One bone
                  holds that space instead of letting the page jump twice. */}
              <div className="h-40 rounded-2xl liquid-glass motion-safe:animate-pulse" />
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
          eyebrow={headerEyebrow}
          title={headerTitle}
          meta={headerMeta}
          titleActions={headerActionPlaceholder}
        />
        <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pb-8">
          <div className="flex">
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
          eyebrow={headerEyebrow}
          title={headerTitle}
          meta={headerMeta}
          titleActions={headerActionPlaceholder}
        />
        <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pb-8">
          <div className="flex">
            <EmptyState
              variant="inline"
              icon={UserX}
              title="Profile not found"
              body="This profile may have been removed, or the link is no longer valid."
              // Same guard as every other back affordance: a profile link
              // shared into a messaging app opens cold, and `navigate(-1)`
              // from there leaves the app instead of showing this person the
              // rest of it. Browse is the honest fallback — they arrived
              // looking for a helpr.
              action={
                <BarkPillButton
                  onClick={() => (hasInAppHistory() ? navigate(-1) : navigate("/dashboard"))}
                >
                  Go back
                </BarkPillButton>
              }
            />
          </div>
        </div>
      </>
    );
  }

  // The PUBLIC id-verification flag. `isIdVerified` (from the hook) reads a
  // direct `profiles` select, which RLS only permits on your own row, so it is
  // always false for a visitor; `get_safe_profiles` returns `is_id_verified`
  // for exactly this purpose. Both are consulted, same as in the masthead.
  const profileIdVerified =
    isIdVerified ||
    (profile as unknown as { is_id_verified?: boolean }).is_id_verified === true;

  // PAYOUT READINESS — public, and the only place on this page that reads it.
  // `(stripe_account_id IS NOT NULL AND stripe_payouts_enabled)`, computed
  // server-side in `get_safe_profiles` (restored by migration 20260831213259
  // after 20260831145430 dropped the column). Strict `=== true` so a row that
  // predates the restore, or a fallback row from the direct self-select
  // below, reads "not set up" rather than throwing.
  const profilePayoutReady =
    (profile as unknown as { is_payout_ready?: boolean }).is_payout_ready === true;

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
    } catch {
      toast.error("Couldn't save your response — try again?");
    } finally {
      setSavingResponse(false);
    }
  };

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
        // px-5 lg:px-8 xl:px-12 pt-4 pb-8` — which is exactly what the
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
            <>
              {/* NO MESSAGE BUTTON HERE AT ALL (owner: "remove the message
                  button, only the poster can message").

                  It used to render behind a `canMessage` gate that opened on
                  any of three grounds — an existing thread, this person having
                  applied to one of the viewer's jobs, or the two having worked
                  together. Two of those let a HELPER open a channel, which is
                  the thing the rule is meant to prevent, and the third only
                  restated a thread that already exists in Messages.

                  A profile is now a place to READ about someone, never to
                  start a conversation with them. The poster's route is
                  unaffected: they message from the application, which is where
                  they were going to do it anyway, and an existing thread is
                  still in Messages. */}
              <SaveHelperButton helperId={userId!} customerId={currentUserId} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-ds-md h-10 w-10 shrink-0" aria-label="More options">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Only offer work to someone who shows evidence of DOING
                      work. The unified user model (see useUserProfileData —
                      "every user can apply OR post") means there is no helper
                      role to gate on, so this gates on behaviour instead: has
                      this person ever been the helper on a job?

                      Without it the action rendered on every profile, including
                      pure posters with 0 completed and 0 worked jobs — offering
                      a job to someone with no signal they take work is a dead
                      end for the poster and noise for the recipient. Same shape
                      as `canEndorse={mutualJobsCount > 0}` below. */}
                  {workedJobs.length > 0 && (
                    <DropdownMenuItem onClick={() => navigate(`/post-job?offerTo=${userId}`)}>
                      <Briefcase className="w-4 h-4 mr-2" /> Offer a Job Directly
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setShowReport(true)}>
                    <Flag className="w-4 h-4 mr-2" /> Report User
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowBlock(true)}>
                    <Ban className="w-4 h-4 mr-2" /> Block User
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
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
        className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pb-8 w-full"
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
        <div className="flex flex-col gap-5 items-stretch">
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
            lastActiveLabel={lastActiveLabel}
            mutualJobsCount={mutualJobsCount}
            tierProfile={tierProfile}
            stats={stats}
            hasSubmittedCredentials={hasSubmittedCredentials}
            recognition={
              <RecognitionRow
                milestoneStats={{
                  completedJobs: stats.completedJobs,
                  avgRating: stats.avgRating,
                  repeatHirePercent: data?.repeatHirePercent ?? 0,
                  credentialTier: data?.credentialTier ?? 0,
                }}
                badges={badges}
              />
            }
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
                replyLatency={replyLatency}
                onTimeArrivalRate={onTimeArrivalRate}
                revisionFrequency={revisionFrequency}
                cancellationRate={cancellationRate}
                posterReputation={posterReputation}
                petCareSignal={petCareSignal}
                repeatHirePercent={data?.repeatHirePercent ?? null}
                statSamples={statSamples}
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
          <div className="space-y-5">
            {/* The "Boost your profile" completion card used to sit here, on the
                owner's own view of this page. It is gone (owner, 2026-08-27:
                "preview shouldn't have that at all").

                THIS PAGE IS THE PREVIEW. Its whole job is to show the user what
                a stranger sees — the header literally reads "How others see you
                · A preview from a poster's perspective". A completion meter and
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
                skills) or `/dashboard` (find jobs); both are one tap from the
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

            {/* Skill endorsements — pills showing the helper's endorsed
                skills. Past clients (mutual job count > 0) see a + button
                to endorse.

                Rendered for EVERYONE, owner included (owner, 2026-08-27:
                "show them — make Preview truly public"). This page IS the
                preview of what a stranger sees, so hiding a whole public
                section from the person previewing it defeated its purpose.

                `canEndorse` keeps its `!isOwnProfile` guard on purpose —
                that is the one thing a visitor gets that the owner must
                not: the + button. Self-endorsement isn't a truthful
                preview, it's an abusable affordance. Section public,
                control not. */}
            <SkillEndorsements
              profileUserId={userId!}
              viewerUserId={currentUserId}
              canEndorse={!isOwnProfile && mutualJobsCount > 0}
            />

            {/* Recent reviews — public trust-signal wall (#86). Shown to
                everyone, owner included (owner, 2026-08-27), so the
                preview reproduces what a prospective poster actually
                reads. Read-only: quotes from past customers, no control
                that could let anyone review themselves. */}
            {/* `canReadReviewText` guard: this wall runs its own `reviews`
                select, and that policy is TO authenticated — so for a
                signed-out visitor it fetches nothing and renders its "be the
                first to review" empty state, which would now sit under a
                truthful "4.8 · 5 reviews" tile. ReviewsSection below says the
                honest thing instead ("Sign in to read all 5 reviews"). */}
            {showReviews && stats.reviewCount > 0 && canReadReviewText && (
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
                trueReviewCount={stats.reviewCount}
                canReadReviewText={canReadReviewText}
                loadMoreReviews={loadMoreReviews}
                loadingMoreReviews={loadingMoreReviews}
              />
            )}

            {/* Posted Jobs expanded inline */}
            {showPostedJobs && (
              <JobsList jobs={postedJobs} variant="posted" knownCount={postedTotalCount} />
            )}

            {/* Worked Jobs expanded inline */}
            {showWorkedJobs && (
              <JobsList
                jobs={completedWorkedJobs}
                variant="worked"
                knownCount={completedWorkedCount}
              />
            )}

            {/* No hourly-rate card. Louisiana Helpr prices jobs POSTER-side:
                the poster sets the price and the helper bids against it, so a
                helper's own "$X/hr" is not a number anybody transacts on. It
                was shown here for months but could never be set (its editor
                had been deleted), so every profile omitted it anyway. Retired
                deliberately 2026-08-27 rather than given an editor. */}

            {/* Availability */}
            <HelperAvailabilityDisplay helperId={userId!} />

            {/* Recent work — photos the helper uploaded on their own profile.
                Ungated on purpose; see HelperWorkPhotos for why. */}
            <HelperWorkPhotos urls={profile.portfolio_urls ?? []} />

            {/* Portfolio — Pro+ only */}
            {(profile.subscription_tier === "pro" || profile.subscription_tier === "elite") && <HelperPortfolio helperId={userId!} />}


          </div>

          {/* ── HOW A BOOKING IS PROTECTED ──
              NOT pinned. It follows the last card and the page ends with it;
              see the note on `wrap`. On a young marketplace the profile a
              visitor lands on most often is one with no reviews and no record,
              and the question it leaves them with is "so how do I know this is
              safe?". This is the answer, and every line of it is sourced from
              `get_safe_profiles` — the one read path that returns real values
              to a viewer with no shared history.

              ORDER MATTERS HERE (owner, 2026-08-31: keep the ID line, "but
              quieter — below the escrow explainer, not leading"). The escrow
              promise is unconditional and true of every booking, so it leads.
              The ID line follows. A member who signed up this morning is not
              introduced to a stranger with a sentence about what they have
              not done.

              WHAT IS *NOT* HERE: "Report this profile". Report User and Block
              User already sit in the ⋮ menu at the top right, which is the
              conventional home for them and was already built. A second entry
              point at the foot of the page was a third way to say the same
              thing (owner: "remove report from the bottom").

              SOURCING. Every claim reads a column `get_safe_profiles` returns
              to any caller — verified against prod on 2026-08-31 with the
              anon key, i.e. a viewer with no session at all:
                • `is_id_verified`  → true for 6bdc1f67, false for 2222…2201
                • `is_payout_ready` → true for 6bdc1f67, false for 76b07824
              Neither is reachable any other way: the direct `profiles` select
              this page also runs returns ZERO rows for another member under
              RLS (measured), so `isIdVerified` from the hook is permanently
              false for a visitor and cannot be used on its own.

              The escrow line states no timing figure on purpose — the release
              window is config, and restating a config number in prose is how
              the Legal "90%" bug happened. */}
          <div
            className="pt-5 flex flex-col gap-2.5"
            style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.14)" }}
          >
            <p
              className="font-sans font-semibold uppercase tracking-wider text-ds-11"
              style={{ color: "hsl(var(--olivewood) / 0.7)", letterSpacing: "0.12em" }}
            >
              Booking on Helpr
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <p
                className="font-serif italic text-ds-13 leading-relaxed flex items-start gap-2"
                style={{ color: "hsl(var(--olivewood) / 0.9)" }}
              >
                <Lock
                  className="w-4 h-4 shrink-0 mt-0.5"
                  style={{ color: "hsl(var(--bark) / 0.75)" }}
                  aria-hidden
                />
                <span>
                  You pay Helpr, not the member — the money is held in escrow
                  and released once the job is done.
                </span>
              </p>
              <p
                className="font-serif italic text-ds-13 leading-relaxed flex items-start gap-2"
                style={{ color: "hsl(var(--olivewood) / 0.9)" }}
              >
                <ShieldCheck
                  className="w-4 h-4 shrink-0 mt-0.5"
                  style={{
                    color: profileIdVerified
                      ? "hsl(var(--bark) / 0.75)"
                      : "hsl(var(--olivewood) / 0.5)",
                  }}
                  aria-hidden
                />
                <span>
                  {profileIdVerified
                    ? `${displayName}'s government ID has been verified by Stripe.`
                    : `${displayName} hasn't verified a government ID yet.`}
                </span>
              </p>
              {/* PAYOUT SETUP — new, and the one public fact about this member
                  that this page rendered nowhere. It was dropped from
                  `get_safe_profiles` by 20260831145430 and restored by
                  20260831213259; `src/integrations/supabase/types.ts` already
                  carries it, so no cast is needed. It is the difference
                  between "escrow will reach this person" and "it will sit
                  there", which is exactly what a poster about to pay wants to
                  know, and it is legible on a profile with no other record. */}
              <p
                className="font-serif italic text-ds-13 leading-relaxed flex items-start gap-2"
                style={{ color: "hsl(var(--olivewood) / 0.9)" }}
              >
                <Banknote
                  className="w-4 h-4 shrink-0 mt-0.5"
                  style={{
                    color: profilePayoutReady
                      ? "hsl(var(--bark) / 0.75)"
                      : "hsl(var(--olivewood) / 0.5)",
                  }}
                  aria-hidden
                />
                <span>
                  {/* The negative branch is phrased about the SETUP, not the
                      person, and names nobody. A brand-new profile already
                      carries "hasn't built a public record yet" and "hasn't
                      verified a government ID yet"; a third sentence beginning
                      with their name and the word "hasn't" turns an honest
                      page into a character reference. Same fact, no pile-on. */}
                  {profilePayoutReady
                    ? `${displayName} has finished payout setup with Stripe, so escrow can be released to them.`
                    : "Payout setup isn't complete yet — no money can leave escrow until it is."}
                </span>
              </p>
            </div>
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
