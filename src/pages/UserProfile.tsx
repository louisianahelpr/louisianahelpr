import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { MapPin, Star, Briefcase, Clock, CheckCircle, Phone, ClipboardList, Hammer, ShieldCheck, MoreVertical, Flag, Ban, UserX, ChevronDown } from "lucide-react";
import { getCategoryIcon } from "@/lib/categoryIcons";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { HelperAvailabilityDisplay } from "@/components/HelperAvailabilityDisplay";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import CredentialBadge from "@/components/CredentialBadge";
import BusinessBadge from "@/components/BusinessBadge";
import { HelperPortfolio } from "@/components/HelperPortfolio";
import { PublicReviewWall } from "@/components/profile/PublicReviewWall";
import HelperTierBadge from "@/components/profile/HelperTierBadge";

import ReportDialog from "@/components/ReportDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import SaveHelperButton from "@/components/SaveHelperButton";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { cn } from "@/lib/utils";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { queryKeys } from "@/lib/queryKeys";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { haversineMiles } from "@/lib/geo";
import { useUserLocation } from "@/hooks/useUserLocation";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const UserProfile = () => {
  usePageTitle("User Profile — Helpr");
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user: currentAuthUser } = useCurrentUser();
  const currentUserId = currentAuthUser?.id ?? null;

  const [showReviews, setShowReviews] = useState(searchParams.get("tab") === "reviews");
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
  const [reviewRatingFilter, setReviewRatingFilter] = useState<number | null>(null);
  const [reviewVisibleCount, setReviewVisibleCount] = useState(5);

  // React Query: cached for 60s, instant on revisit, refresh in background.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.userProfile.byId(userId),
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      // `get_safe_profiles` only returns *approved*, non-banned rows, so
      // it deliberately hides profiles that aren't public yet. That's
      // correct for viewing other people — but it also hid the viewer's
      // OWN profile from the "How others see you" preview whenever their
      // account was still pending approval, surfacing a false "User not
      // found". When the requested id is the current user's, fall back to
      // a direct self-select (the profiles RLS policy already permits the
      // owner to read their own row regardless of approval_status).
      const profileRes = await supabase.rpc("get_safe_profiles", { user_ids: [userId!] });
      if (profileRes.error) throw profileRes.error;
      let prof = (profileRes.data?.[0] ?? null) as any;

      if (!prof && userId === currentUserId) {
        prof = unwrap(
          await supabase
            .from("profiles")
            .select("user_id, full_name, avatar_url, bio, location, skills, hourly_rate, subscription_tier, portfolio_urls, created_at")
            .eq("user_id", userId!)
            .maybeSingle(),
        );
      }

      if (!prof) {
        return { profile: null as Profile | null };
      }

      // Unified user model — every user can apply OR post. Always fetch
      // applications; the metrics section just hides itself if empty.
      // Was previously gated on role === 'helper', but role distinction
      // no longer exists in the UI.
      //
      // jobs select also pulls latitude/longitude so the "did N jobs
      // nearby" social-proof badge (#31) can filter against the viewer's
      // location without a second round trip. status_history_total /
      // cancellation_count_*_res are head-only count queries so the
      // cancellation-rate stat (#30) reflects ALL jobs, not just the 20
      // we render inline.
      const [reviewsRes, postedRes, workedRes, appsRes, idCheckRes, postedTotalRes, postedCancelledRes, workedTotalRes, workedCancelledRes] = await Promise.all([
        // feedback_visible_at filter: anti-retaliation reveal — hidden until
        // both sides post or 14 days pass. set_review_visibility trigger
        // stamps this column on insert.
        supabase.from("reviews").select("rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id").eq("reviewee_id", userId!).lte("feedback_visible_at", new Date().toISOString()).order("created_at", { ascending: false }),
        supabase.from("jobs").select("id, title, status, category, budget, created_at, latitude, longitude").eq("customer_id", userId!).order("created_at", { ascending: false }).limit(20),
        supabase.from("jobs").select("id, title, status, category, budget, created_at, latitude, longitude").eq("helper_id", userId!).order("created_at", { ascending: false }).limit(20),
        supabase.from("applications").select("status, created_at, updated_at").eq("helper_id", userId!),
        // Verification-ladder inputs (#112): grab the trust signals while
        // we're already touching this row. `get_safe_profiles` doesn't
        // expose these, but the profiles RLS policy already permits SELECT
        // on any approved row (that's the same gate `id_document_url`
        // relies on), so a direct select is fine.
        supabase
          .from("profiles")
          .select("id_document_url, approval_status, idv_status, stripe_account_id")
          .eq("user_id", userId!)
          .maybeSingle(),
        // Count-only queries — `head: true` skips row payload, so these
        // are cheap. They power the lifetime cancellation-rate display
        // (#30) without inflating the limited job lists rendered above.
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", userId!),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", userId!).eq("status", "cancelled"),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("helper_id", userId!),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("helper_id", userId!).eq("status", "cancelled"),
      ]);

      // These five feed secondary stats (reviews, job counts, response
      // metrics, trust signals) — a failure should degrade gracefully to
      // empty rather than brick the whole profile over the critical name/bio
      // we already have. But don't silently swallow: report so a real outage
      // is observable instead of looking like "this user has 0 reviews".
      for (const [label, res] of [
        ["reviews", reviewsRes], ["posted_jobs", postedRes], ["worked_jobs", workedRes],
        ["applications", appsRes], ["trust_signals", idCheckRes],
        ["posted_total", postedTotalRes], ["posted_cancelled", postedCancelledRes],
        ["worked_total", workedTotalRes], ["worked_cancelled", workedCancelledRes],
      ] as const) {
        if (res.error) {
          report(res.error, {
            severity: "warning",
            tags: { area: `user_profile.${label}` },
            context: { viewed_user_id: userId },
          });
        }
      }

      const postedJobs = postedRes.data || [];
      const workedJobs = workedRes.data || [];
      const allJobs = [...postedJobs, ...workedJobs];
      const completedCount = new Set(allJobs.filter(j => j.status === "completed").map(j => j.id)).size;
      const ratings = reviewsRes.data?.map((r: any) => r.rating) || [];
      const stats = {
        completedJobs: completedCount,
        avgRating: ratings.length > 0 ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : 0,
        reviewCount: ratings.length,
      };

      // Cancellation-rate metric (#30) — separate posted-side vs worked-side
      // rates so the badge can read "the right" rate for the audience. We
      // compute the combined rate inline at the render site. A minimum
      // sample size of 5 prevents "1 of 1 cancelled = 100%" cliffs on
      // fresh accounts.
      const totalJobsCount = (postedTotalRes.count ?? 0) + (workedTotalRes.count ?? 0);
      const totalCancelledCount = (postedCancelledRes.count ?? 0) + (workedCancelledRes.count ?? 0);
      const cancellationRate = {
        total: totalJobsCount,
        cancelled: totalCancelledCount,
        // Only render when there's enough history to be meaningful.
        rate: totalJobsCount >= 5 ? (totalCancelledCount / totalJobsCount) * 100 : null,
      };

      let responseMetrics = { avgResponseHours: null as number | null, acceptanceRate: null as number | null, totalApplications: 0 };
      if (appsRes?.data && appsRes.data.length > 0) {
        const allApps = appsRes.data;
        const accepted = allApps.filter((a: any) => a.status === "accepted");
        const acceptanceRate = allApps.length > 0 ? (accepted.length / allApps.length) * 100 : null;
        const responseTimes = accepted
          .map((a: any) => (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / 3_600_000)
          .filter((h: number) => h > 0 && h < 720);
        responseMetrics = {
          avgResponseHours: responseTimes.length > 0 ? responseTimes.reduce((a: number, b: number) => a + b, 0) / responseTimes.length : null,
          acceptanceRate,
          totalApplications: allApps.length,
        };
      }

      let reviews: any[] = [];
      if (reviewsRes.data && reviewsRes.data.length > 0) {
        const reviewerIds = [...new Set(reviewsRes.data.map((r: any) => r.reviewer_id))] as string[];
        const jobIds = [...new Set(reviewsRes.data.map((r: any) => r.job_id))] as string[];
        const [profilesRes2, jobsRes] = await Promise.all([
          supabase.rpc("get_safe_profiles", { user_ids: reviewerIds }),
          // category pulled in alongside title so the reviews-tab filter
          // (#27) can group by job type without a follow-up fetch.
          supabase.from("jobs").select("id, title, category").in("id", jobIds),
        ]);
        const nameMap = new Map(profilesRes2.data?.map((p: any) => [p.user_id, formatName(p.full_name)]) || []);
        const jobMap = new Map(jobsRes.data?.map((j: any) => [j.id, { title: j.title, category: j.category as string | null }]) || []);
        reviews = reviewsRes.data.map((r: any) => {
          const j = jobMap.get(r.job_id);
          return {
            rating: r.rating,
            punctuality: r.punctuality ?? null,
            quality: r.quality ?? null,
            communication: r.communication ?? null,
            feedback: r.feedback,
            created_at: r.created_at,
            reviewerName: nameMap.get(r.reviewer_id) || "User",
            jobTitle: j?.title || "Job",
            jobCategory: j?.category ?? null,
          };
        });
      }

      return {
        profile: prof as Profile,
        reviews,
        stats,
        postedJobs,
        workedJobs,
        responseMetrics,
        cancellationRate,
        isIdVerified: !!idCheckRes.data?.id_document_url,
        // Verification-ladder inputs — passed straight through to
        // HelperTierBadge. Null-safe if the row read was blocked.
        tierProfile: {
          approval_status: idCheckRes.data?.approval_status ?? null,
          idv_status: idCheckRes.data?.idv_status ?? null,
          stripe_account_id: idCheckRes.data?.stripe_account_id ?? null,
        },
      };
    },
  });

  const profile = (data?.profile ?? null) as Profile | null;
  const reviews = (data?.reviews ?? []) as Array<{ rating: number; punctuality: number | null; quality: number | null; communication: number | null; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string; jobCategory: string | null }>;
  const stats = data?.stats ?? { completedJobs: 0, avgRating: 0, reviewCount: 0 };
  const postedJobs = (data?.postedJobs ?? []) as Array<{ id: string; title: string; status: string; category: string; budget: number; created_at: string; latitude: number | null; longitude: number | null }>;
  const workedJobs = (data?.workedJobs ?? []) as Array<{ id: string; title: string; status: string; category: string; budget: number; created_at: string; latitude: number | null; longitude: number | null }>;
  const responseMetrics = data?.responseMetrics ?? { avgResponseHours: null, acceptanceRate: null, totalApplications: 0 };
  const cancellationRate = data?.cancellationRate ?? { total: 0, cancelled: 0, rate: null as number | null };
  const isIdVerified = data?.isIdVerified ?? false;
  const tierProfile = data?.tierProfile ?? null;
  const loading = isLoading && !data;

  // Geo for the "did N jobs nearby" badge (#31). Only enable the hook
  // when the viewer has explicitly opted in via the inline trigger, so
  // we never surprise-prompt for location just to render a profile.
  const viewerLoc = useUserLocation(showNearbyProof);
  // Count of this helper's completed jobs that fell within 25mi of the
  // viewer's current location. Only counts jobs with usable lat/lng;
  // older posts without coords are silently skipped.
  const NEARBY_RADIUS_MI = 25;
  const jobsNearbyCount = (() => {
    if (viewerLoc.status !== "ready") return null;
    let n = 0;
    for (const j of workedJobs) {
      if (j.status !== "completed") continue;
      if (typeof j.latitude !== "number" || typeof j.longitude !== "number") continue;
      if (haversineMiles(viewerLoc.lat, viewerLoc.lng, j.latitude, j.longitude) <= NEARBY_RADIUS_MI) {
        n += 1;
      }
    }
    return n;
  })();

  // Computed up-front so the loading skeleton can render the same
  // PageHeader (eyebrow/title/meta) as the loaded state — both only
  // depend on the route param + current user, not the fetched profile.
  const isOwnProfile = currentUserId === userId;

  // Whether the loaded header will render a rightSlot (Save + actions).
  // Mirrored as a placeholder in the skeleton / not-found states so the
  // header keeps the same layout (sticky action bar + title padding)
  // before and after the fetch resolves — no height jump.
  const headerHasActions = !isOwnProfile && !!currentUserId;
  const headerActionPlaceholder = headerHasActions ? (
    <div className="flex items-center gap-1" aria-hidden>
      <div className="h-10 w-10 rounded-ds-md bg-muted animate-pulse" />
      <div className="h-10 w-10 rounded-ds-md bg-muted animate-pulse" />
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-premium-page pb-safe-nav">
        <PageHeader
          eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
          title={isOwnProfile ? "Profile Review" : "Profile"}
          meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
          rightSlot={headerActionPlaceholder}
        />
        <main className="container mx-auto px-5 py-6">
          <div className="max-w-lg mx-auto space-y-5">
            <div className="rounded-2xl liquid-glass p-5 text-center space-y-3">
              <div className="w-24 h-24 rounded-ds-pill squircle bg-muted animate-pulse mx-auto" />
              <div className="h-6 w-40 bg-muted animate-pulse mx-auto rounded" />
              <div className="h-4 w-24 bg-muted animate-pulse mx-auto rounded" />
              <div className="h-4 w-64 bg-muted animate-pulse mx-auto rounded" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-ds-md liquid-glass p-3 space-y-2">
                  <div className="h-7 w-10 bg-muted animate-pulse mx-auto rounded" />
                  <div className="h-3 w-12 bg-muted animate-pulse mx-auto rounded" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-premium-page pb-safe-nav">
        <PageHeader
          eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
          title={isOwnProfile ? "Profile Review" : "Profile"}
          meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
          rightSlot={headerActionPlaceholder}
        />
        <main className="container mx-auto px-5 py-6">
          <div className="max-w-lg mx-auto flex">
            <ErrorState onRetry={() => refetch()} />
          </div>
        </main>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-premium-page pb-safe-nav">
        <PageHeader
          eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
          title={isOwnProfile ? "Profile Review" : "Profile"}
          meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
          rightSlot={headerActionPlaceholder}
        />
        <main className="container mx-auto px-5 py-6">
          <div className="max-w-lg mx-auto flex">
            <EmptyState
              variant="inline"
              icon={UserX}
              eyebrow="Profile unavailable"
              title="User not found"
              body="This profile may have been removed, or the link is no longer valid."
              action={
                <BarkPillButton onClick={() => navigate(-1)}>Go back</BarkPillButton>
              }
            />
          </div>
        </main>
      </div>
    );
  }

  const displayName = formatName(profile.full_name);
  const initials = (profile.full_name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const badges = computeBadges({ avgRating: stats.avgRating, reviewCount: stats.reviewCount, completedJobs: stats.completedJobs, helprTier: profile.subscription_tier || null });

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
        title={isOwnProfile ? "Profile Review" : "Profile"}
        meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
        rightSlot={
          !isOwnProfile && currentUserId ? (
            <div className="flex items-center gap-1">
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
            </div>
          ) : null
        }
      />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-lg mx-auto space-y-5">
          {/* Profile Card — brand-aligned hero. Avatar with tier ring,
              italic display name, italic serif meta and bio. */}
          <div
            className="rounded-2xl liquid-glass p-5 text-center space-y-3 relative overflow-hidden"
            style={{
              backgroundImage:
                "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
                "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
            }}
          >
            {/* Verified Helpr ribbon — visible top-right corner badge
                for ID-verified helpers. Promotes the trust signal from
                a small chip to a prominent marker posters see at first
                glance. Gold-warm so it reads as recognition, not status. */}
            {isIdVerified && (
              <div
                aria-label="Verified Helpr"
                className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full"
                style={{
                  background: "hsl(var(--gold-warm) / 0.14)",
                  border: "0.5px solid hsl(var(--gold-warm) / 0.36)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                    "0 1px 2px hsl(var(--gold-warm) / 0.12), " +
                    "0 4px 10px -3px hsl(var(--gold-warm) / 0.28)",
                }}
              >
                <ShieldCheck className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} strokeWidth={2.5} />
                <span
                  className="font-sans font-bold uppercase tracking-wider"
                  style={{ fontSize: "0.6rem", color: "hsl(var(--gold-warm))", letterSpacing: "0.16em" }}
                >
                  Verified
                </span>
              </div>
            )}
            <div className="relative inline-block">
              {profile.avatar_url ? (
                <img
                  loading="lazy"
                  decoding="async"
                  src={profile.avatar_url}
                  alt={`${displayName} profile picture`}
                  className="w-24 h-24 rounded-ds-pill squircle mx-auto object-cover"
                  style={{ boxShadow: "0 0 0 2px hsl(var(--bark) / 0.18)" }}
                />
              ) : (
                <div
                  className={cn(
                    // Was a flat `bg-primary/10` — swap to the
                    // deterministic warm-palette gradient hashed off the
                    // helper's user id so each profile has a recognizable
                    // signature when no avatar has been uploaded.
                    "w-24 h-24 rounded-ds-pill squircle bg-gradient-to-br text-[hsl(var(--ink-deep))] drop-shadow-sm flex items-center justify-center mx-auto text-ds-24 font-display italic font-bold",
                    avatarGradientFor(userId),
                  )}
                  style={{ boxShadow: "0 0 0 2px hsl(var(--bark) / 0.18)" }}
                >
                  {initials}
                </div>
              )}
              {isIdVerified && (
                <div
                  aria-label="ID verified"
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{
                    background: "hsl(var(--bark))",
                    border: "2px solid hsl(var(--parchment))",
                  }}
                >
                  <ShieldCheck className="w-4 h-4" style={{ color: "hsl(var(--parchment))" }} strokeWidth={2.5} />
                </div>
              )}
            </div>
            <div>
              <h1 className="text-page-title leading-tight">
                {displayName}
              </h1>
              {profile.location && (
                <p
                  className="font-serif italic flex items-center justify-center gap-1 mt-0.5"
                  style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.75)" }}
                >
                  <MapPin className="w-3 h-3" />{profile.location}
                </p>
              )}
              {/* Response Metrics inline */}
              {responseMetrics.totalApplications > 0 && (
                <div className="flex items-center justify-center gap-3 mt-2 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                  {responseMetrics.avgResponseHours !== null && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                        {responseMetrics.avgResponseHours < 1
                          ? `${Math.round(responseMetrics.avgResponseHours * 60)}m`
                          : responseMetrics.avgResponseHours < 24
                          ? `${responseMetrics.avgResponseHours.toFixed(1)}h`
                          : `${Math.round(responseMetrics.avgResponseHours / 24)}d`}
                      </span>
                      <span>avg reply</span>
                    </span>
                  )}
                  {responseMetrics.acceptanceRate !== null && (
                    <>
                      <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                          {responseMetrics.acceptanceRate.toFixed(0)}%
                        </span>
                        <span>accept rate</span>
                      </span>
                    </>
                  )}
                </div>
              )}
              {/* "Did N jobs nearby" social proof (#31). Two states:
                  - opt-in pill when viewer hasn't granted geo yet AND the
                    helper has at least one completed worked job with
                    coords (otherwise the count would be 0).
                  - rendered count once geolocation resolves. We always
                    show the count even when zero — a "0 jobs near you"
                    fact is a legitimate trust input. Hidden entirely on
                    your own profile so you don't see your own count. */}
              {!isOwnProfile && (() => {
                const hasNearbyEligibleJobs = workedJobs.some(
                  (j) => j.status === "completed" && typeof j.latitude === "number" && typeof j.longitude === "number",
                );
                if (!hasNearbyEligibleJobs) return null;
                if (!showNearbyProof) {
                  return (
                    <div className="mt-1.5 flex justify-center">
                      <button
                        onClick={() => setShowNearbyProof(true)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-11 font-medium transition-colors"
                        style={{
                          color: "hsl(var(--bark))",
                          background: "hsl(var(--bark) / 0.06)",
                          border: "0.5px solid hsl(var(--bark) / 0.18)",
                        }}
                      >
                        <MapPin className="w-3 h-3" />
                        Show jobs near you
                      </button>
                    </div>
                  );
                }
                if (viewerLoc.status === "loading") {
                  return (
                    <div className="mt-1.5 flex items-center justify-center gap-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>
                      <MapPin className="w-3 h-3" />
                      <span className="italic">Checking nearby…</span>
                    </div>
                  );
                }
                if (viewerLoc.status === "error") {
                  return (
                    <div className="mt-1.5 flex items-center justify-center gap-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>
                      <MapPin className="w-3 h-3" />
                      <span className="italic">Location unavailable</span>
                    </div>
                  );
                }
                if (jobsNearbyCount === null) return null;
                return (
                  <div className="mt-1.5 flex items-center justify-center gap-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                    <MapPin className="w-3 h-3" />
                    <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                      {jobsNearbyCount}
                    </span>
                    <span>{jobsNearbyCount === 1 ? "job" : "jobs"} within {NEARBY_RADIUS_MI}mi of you</span>
                  </div>
                );
              })()}
              {/* Cancellation rate (#30) — combined helper + poster jobs.
                  Only renders once the user has >=5 lifetime jobs so a
                  single early cancellation doesn't read as "100% cancel
                  rate". Color shifts olive→amber→sienna at 5%/15% so the
                  signal degrades gracefully rather than feeling punitive. */}
              {cancellationRate.rate !== null && (
                <div className="flex items-center justify-center gap-1 mt-1.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                  <span
                    className="font-display italic font-bold tabular-nums"
                    style={{
                      color:
                        cancellationRate.rate < 5
                          ? "hsl(var(--ink-deep))"
                          : cancellationRate.rate < 15
                          ? "hsl(var(--gold-warm))"
                          : "hsl(var(--burnt-sienna))",
                    }}
                  >
                    {cancellationRate.rate.toFixed(0)}%
                  </span>
                  <span>cancel rate</span>
                  <span style={{ color: "hsl(var(--olivewood) / 0.45)" }}>· {cancellationRate.cancelled}/{cancellationRate.total} jobs</span>
                </div>
              )}
              {profile.phone && (
                <p className="font-serif italic mt-1.5 flex items-center justify-center gap-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                  <Phone className="w-3 h-3" />{profile.phone}
                </p>
              )}
              {profile.bio && (
                <p
                  className="font-serif italic mt-3 leading-relaxed text-left"
                  style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep) / 0.88)" }}
                >
                  {profile.bio}
                </p>
              )}
              {profile.skills && (
                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {profile.skills.split(",").map(s => s.trim()).filter(Boolean).map((s, i) => (
                    <span
                      key={i}
                      className="text-[0.7rem] font-sans font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: "hsl(var(--bark) / 0.10)",
                        color: "hsl(var(--bark))",
                        border: "0.5px solid hsl(var(--bark) / 0.20)",
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {badges.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1 mt-3">
                  <HelperBadges badges={badges} />
                </div>
              )}
              <div className="pt-2 flex flex-wrap justify-center gap-1.5">
                {/* Verification ladder (#112) — sits with credentials
                    because both answer "should I trust this person?",
                    separate from the performance badges above. The
                    component self-hides at tier 0, so fresh signups
                    don't get a placeholder pill. */}
                <HelperTierBadge
                  profile={tierProfile}
                  stats={stats}
                  size="md"
                />
                <CredentialBadge credentials={profile as any} size="md" />
                <BusinessBadge userId={userId!} size="md" />
              </div>
            </div>
          </div>

          {/* Stats */}
          {(() => {
            const activeSection = showReviews ? "reviews" : showPostedJobs ? "posted" : showWorkedJobs ? "worked" : null;
            const hasSelection = activeSection !== null && !isOwnProfile;

            const reviewBtn = (
              <button
                key="reviews"
                onClick={() => {
                  setShowReviews(!showReviews);
                  setShowPostedJobs(false);
                  setShowWorkedJobs(false);
                }}
                className={`rounded-ds-md border bg-card p-3 text-center transition-all cursor-pointer hover:border-primary/30 hover:shadow-sm ${showReviews ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <Star className="w-3.5 h-3.5 text-primary fill-primary" />
                  <p className="text-ds-20 font-bold text-foreground">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}</p>
                </div>
                <p className="text-muted-foreground text-ds-11">{stats.reviewCount} Review{stats.reviewCount !== 1 ? "s" : ""}</p>
              </button>
            );

            const postedBtn = (
              <button
                key="posted"
                onClick={() => {
                  if (postedJobs.length > 0) {
                    setShowPostedJobs(!showPostedJobs);
                    setShowReviews(false);
                    setShowWorkedJobs(false);
                  }
                }}
                className={`rounded-ds-md border bg-card p-3 text-center transition-all ${postedJobs.length > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showPostedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <ClipboardList className="w-3.5 h-3.5 text-primary" />
                  <p className="text-ds-20 font-bold text-foreground">{postedJobs.length}</p>
                </div>
                <p className="text-muted-foreground text-ds-11">Posted</p>
              </button>
            );

            const workedBtn = (
              <button
                key="worked"
                onClick={() => {
                  if (workedJobs.length > 0) {
                    setShowWorkedJobs(!showWorkedJobs);
                    setShowReviews(false);
                    setShowPostedJobs(false);
                  }
                }}
                className={`rounded-ds-md border bg-card p-3 text-center transition-all ${workedJobs.length > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showWorkedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <Hammer className="w-3.5 h-3.5 text-primary" />
                  <p className="text-ds-20 font-bold text-foreground">{workedJobs.length}</p>
                </div>
                <p className="text-muted-foreground text-ds-11">Completed</p>
              </button>
            );

            if (isOwnProfile) {
              return (
                <div className="grid grid-cols-3 gap-2">
                  {reviewBtn}
                  {postedBtn}
                  {workedBtn}
                </div>
              );
            }

            // For other users: show only the selected button, or all if none selected
            if (hasSelection) {
              return (
                <div className="grid grid-cols-1 gap-2">
                  {activeSection === "reviews" && reviewBtn}
                  {activeSection === "posted" && postedBtn}
                  {activeSection === "worked" && workedBtn}
                </div>
              );
            }

            return (
              <div className="grid grid-cols-3 gap-2">
                {reviewBtn}
                {postedBtn}
                {workedBtn}
              </div>
            );
          })()}

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
          {showReviews && (() => {
            const PAGE_SIZE = 5;
            // Distinct categories that appear in this helper's reviews,
            // computed once per render. Sorted alphabetically with a
            // stable "other" bucket for nulls. Drives the filter chips.
            const distinctCategories = Array.from(
              new Set(reviews.map((r) => r.jobCategory).filter((c): c is string => !!c)),
            ).sort();
            const filteredReviews = reviews.filter((r) => {
              if (reviewCategoryFilter && r.jobCategory !== reviewCategoryFilter) return false;
              if (reviewRatingFilter && r.rating !== reviewRatingFilter) return false;
              return true;
            });
            const hasActiveFilter = reviewCategoryFilter !== null || reviewRatingFilter !== null;
            const visible = filteredReviews.slice(0, reviewVisibleCount);
            const hasMore = filteredReviews.length > visible.length;

            return (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* Filter row — only render when there's something to filter
                    (at least one category beyond "other" OR more than one
                    distinct rating). Avoids cluttering a 1-review profile. */}
                {reviews.length > 1 && (distinctCategories.length > 0 || new Set(reviews.map((r) => r.rating)).size > 1) && (
                  <div className="rounded-ds-md liquid-glass p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Filter</span>
                      {hasActiveFilter && (
                        <button
                          onClick={() => {
                            setReviewCategoryFilter(null);
                            setReviewRatingFilter(null);
                            setReviewVisibleCount(PAGE_SIZE);
                          }}
                          className="text-ds-11 underline text-muted-foreground hover:text-foreground"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {distinctCategories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {distinctCategories.map((cat) => {
                          const Icon = getCategoryIcon(cat);
                          const active = reviewCategoryFilter === cat;
                          return (
                            <button
                              key={cat}
                              onClick={() => {
                                setReviewCategoryFilter(active ? null : cat);
                                setReviewVisibleCount(PAGE_SIZE);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[0.7rem] font-sans font-semibold transition-colors"
                              style={{
                                color: active ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                                background: active ? "hsl(var(--bark))" : "hsl(var(--bark) / 0.08)",
                                border: `0.5px solid hsl(var(--bark) / ${active ? "0.6" : "0.18"})`,
                              }}
                            >
                              <Icon className="w-3 h-3" />
                              <span className="capitalize">{cat.replace(/_/g, " ")}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {[5, 4, 3, 2, 1].map((rating) => {
                        const count = reviews.filter((r) => r.rating === rating).length;
                        if (count === 0) return null;
                        const active = reviewRatingFilter === rating;
                        return (
                          <button
                            key={rating}
                            onClick={() => {
                              setReviewRatingFilter(active ? null : rating);
                              setReviewVisibleCount(PAGE_SIZE);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[0.7rem] font-sans font-semibold transition-colors tabular-nums"
                            style={{
                              color: active ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                              background: active ? "hsl(var(--bark))" : "hsl(var(--bark) / 0.08)",
                              border: `0.5px solid hsl(var(--bark) / ${active ? "0.6" : "0.18"})`,
                            }}
                          >
                            <Star className={`w-3 h-3 ${active ? "fill-current" : "fill-current"}`} />
                            {rating}
                            <span className="opacity-70">({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {filteredReviews.length > 0 ? (
                  <>
                    {visible.map((r, i) => (
                      <div key={i} className="rounded-ds-md liquid-glass p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((s) => (
                                <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
                              ))}
                            </div>
                            <span className="text-ds-11 font-medium text-foreground">{r.reviewerName}</span>
                          </div>
                          <span className="text-muted-foreground text-ds-11">{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                        {(r.punctuality || r.quality || r.communication) && (
                          <div className="grid grid-cols-3 gap-2">
                            {r.punctuality && (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Punctuality</span>
                                <div className="flex gap-0.5">
                                  {[1,2,3,4,5].map(s => <Star key={s} className={`w-2.5 h-2.5 ${s <= r.punctuality! ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />)}
                                </div>
                              </div>
                            )}
                            {r.quality && (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Quality</span>
                                <div className="flex gap-0.5">
                                  {[1,2,3,4,5].map(s => <Star key={s} className={`w-2.5 h-2.5 ${s <= r.quality! ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />)}
                                </div>
                              </div>
                            )}
                            {r.communication && (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Comms</span>
                                <div className="flex gap-0.5">
                                  {[1,2,3,4,5].map(s => <Star key={s} className={`w-2.5 h-2.5 ${s <= r.communication! ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />)}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <p className="text-muted-foreground text-ds-11">For: {r.jobTitle}</p>
                        {r.feedback && <p className="text-ds-13 text-foreground leading-relaxed">{r.feedback}</p>}
                      </div>
                    ))}
                    {hasMore && (
                      <button
                        onClick={() => setReviewVisibleCount((n) => n + PAGE_SIZE)}
                        className="w-full rounded-ds-md liquid-glass p-3 text-ds-13 font-medium text-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <ChevronDown className="w-4 h-4" />
                        Show {Math.min(PAGE_SIZE, filteredReviews.length - visible.length)} more
                        <span className="text-muted-foreground">({visible.length} of {filteredReviews.length})</span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="rounded-ds-md liquid-glass p-6 text-center">
                    <Star className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-ds-11 text-muted-foreground">
                      {hasActiveFilter ? "No reviews match this filter" : "No reviews yet"}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Posted Jobs expanded inline */}
          {showPostedJobs && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {postedJobs.length > 0 ? postedJobs.map((job) => (
                <div key={job.id} className="rounded-ds-md liquid-glass p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-ds-13 font-medium text-foreground truncate">{job.title}</p>
                    <p className="text-muted-foreground text-ds-11">{new Date(job.created_at).toLocaleDateString()} · {job.category.replace(/_/g, " ")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-ds-13 font-bold text-primary">${job.budget}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${jobStatusColorClasses(job.status)}`}>{job.status.replace("_", " ")}</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-ds-md liquid-glass p-6 text-center">
                  <ClipboardList className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-ds-11 text-muted-foreground">No posted jobs yet</p>
                </div>
              )}
            </div>
          )}

          {/* Worked Jobs expanded inline */}
          {showWorkedJobs && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {workedJobs.length > 0 ? workedJobs.map((job) => (
                <div key={job.id} className="rounded-ds-md liquid-glass p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-ds-13 font-medium text-foreground truncate">{job.title}</p>
                    <p className="text-muted-foreground text-ds-11">{new Date(job.created_at).toLocaleDateString()} · {job.category.replace(/_/g, " ")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-ds-13 font-bold text-primary">${job.budget}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${jobStatusColorClasses(job.status)}`}>{job.status.replace("_", " ")}</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-ds-md liquid-glass p-6 text-center">
                  <Hammer className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-ds-11 text-muted-foreground">No completed jobs yet</p>
                </div>
              )}
            </div>
          )}

          {profile.hourly_rate && (
            <div className="rounded-ds-md liquid-glass p-4 flex items-center gap-3">
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
        </div>
      </main>

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
    </div>
  );
};

export default UserProfile;
