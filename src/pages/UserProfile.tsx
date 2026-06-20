import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
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
import { ProfileStatsGrid } from "./userProfile/ProfileStatsGrid";
import { RatingBreakdown } from "./userProfile/RatingBreakdown";
import { PosterReputationCard } from "./userProfile/PosterReputationCard";
import { ReviewsSection } from "./userProfile/ReviewsSection";
import { JobsList } from "./userProfile/JobsList";

import ReportDialog from "@/components/ReportDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import SaveHelperButton from "@/components/SaveHelperButton";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentAuthUser } = useCurrentUser();
  const currentUserId = currentAuthUser?.id ?? null;

  const [showReviews, setShowReviews] = useState(searchParams.get("tab") === "reviews");

  // Handle Stripe subscription checkout return
  useEffect(() => {
    const pro = searchParams.get("pro");
    if (!pro) return;
    if (pro === "success") {
      toast.success("You're now upgraded — welcome to your new plan!");
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
  // Local reviews state for optimistic updates after saving a response.
  const [localReviews, setLocalReviews] = useState<any[] | null>(null);

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
      // Mutual-jobs lookup (#1) — only fires when there's a viewer signed
      // in AND they aren't viewing themselves. Looks for completed-or-
      // active jobs where the viewer + viewed user worked together in
      // either direction. Soft-fails to 0 (graceful badge hide) if RLS
      // blocks the row read.
      const wantsMutual = !!currentUserId && currentUserId !== userId;

      const [reviewsRes, postedRes, workedRes, appsRes, idCheckRes, postedTotalRes, postedCancelledRes, workedTotalRes, workedCancelledRes, lastActiveRes, mutualRes, workedTimingRes, posterReviewsRes, repeatHireRes] = await Promise.all([
        // feedback_visible_at filter: anti-retaliation reveal — hidden until
        // both sides post or 14 days pass. set_review_visibility trigger
        // stamps this column on insert.
        supabase.from("reviews").select("id, rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id, response_text, response_at", { count: "exact" }).eq("reviewee_id", userId!).lte("feedback_visible_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(20),
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
        // Last-active timestamp (#28) — separate RPC because login_history
        // is RLS-locked to owner/admin. Returns max(created_at) only. Wrap
        // in a soft fetch so PGRST202 ("RPC not deployed yet") just hides
        // the badge instead of bricking the whole profile load.
        supabase.rpc("get_user_last_active", { user_ids: [userId!] }),
        // Mutual jobs (#1) — viewer has worked with this user before?
        // Counts every job where the two of them are paired in either
        // direction. We only need a count, so head:true keeps it cheap.
        // The .or() handles both directions in a single round-trip.
        wantsMutual
          ? supabase
              .from("jobs")
              .select("id", { count: "exact", head: true })
              .or(
                `and(customer_id.eq.${currentUserId},helper_id.eq.${userId}),and(customer_id.eq.${userId},helper_id.eq.${currentUserId})`,
              )
          : Promise.resolve({ data: null, error: null, count: 0 } as any),
        // Worked-side timing fields (#6) — drives on-time arrival rate +
        // revision frequency stats. Pulled separately from the inline-
        // rendered list because we want the broader history (50 rows),
        // not just the most recent 20 truncated for the card UI.
        supabase
          .from("jobs")
          .select("status, date_needed, start_time, helper_on_the_way_at, helper_arrived_at, revision_count")
          .eq("helper_id", userId!)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(50),
        // Poster-side reputation — reviews left for this user in their role
        // as a job poster (customer). We look up jobs posted by this user,
        // then fetch reviews where the reviewee is this user AND the job is
        // in that set. Degrades gracefully to empty on error.
        supabase
          .from("reviews")
          .select("rating, job_id")
          .eq("reviewee_id", userId!)
          .lte("feedback_visible_at", new Date().toISOString()),
        // Repeat-hire % (#milestones) — % of unique customers who hired
        // this helper more than once. PGRST202-safe: function may not be
        // deployed on production yet; falls back to null (milestone hidden).
        supabase.rpc("get_user_repeat_hire_percent" as any, { p_user_id: userId! }),
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
        ["worked_timing", workedTimingRes], ["poster_reviews", posterReviewsRes],
      ] as const) {
        if (res.error) {
          report(res.error, {
            severity: "warning",
            tags: { area: `user_profile.${label}` },
            context: { viewed_user_id: userId },
          });
        }
      }
      // Last-active RPC gets a softer error path: PGRST202 (function not
      // deployed yet) is expected between merge and `supabase db push`, so
      // hide the badge without polluting Sentry. Any OTHER error still
      // reports so a real outage stays observable.
      if (lastActiveRes.error && lastActiveRes.error.code !== "PGRST202") {
        report(lastActiveRes.error, {
          severity: "warning",
          tags: { area: "user_profile.last_active" },
          context: { viewed_user_id: userId },
        });
      }
      // Repeat-hire % RPC: same PGRST202-safe pattern — expected between
      // merge and `supabase db push`. Any other error stays observable.
      if (repeatHireRes.error && repeatHireRes.error.code !== "PGRST202") {
        report(repeatHireRes.error, {
          severity: "warning",
          tags: { area: "user_profile.repeat_hire_percent" },
          context: { viewed_user_id: userId },
        });
      }
      const lastActiveAt =
        lastActiveRes.data?.[0]?.last_active_at
          ? new Date(lastActiveRes.data[0].last_active_at)
          : null;

      // Fire-and-forget — don't await; PGRST202 is silently swallowed inside
      // record_profile_view (returns false on any error). Self-view guard is
      // enforced in the SQL function; double-guard here to avoid the RPC call.
      if (userId !== currentUserId) {
        void (supabase.rpc as any)("record_profile_view", { p_viewed_user_id: userId }).catch(() => {/* silent */});
      }

      const postedJobs = postedRes.data || [];
      const workedJobs = workedRes.data || [];
      const allJobs = [...postedJobs, ...workedJobs];
      const completedCount = new Set(allJobs.filter(j => j.status === "completed").map(j => j.id)).size;
      // Use posterReviewsRes (no-limit) for accurate avgRating + reviewCount.
      // reviewsRes has a .limit(20) now — its .data can't reliably compute
      // the average across all reviews.
      const allRatings = (posterReviewsRes?.data?.map((r: any) => r.rating) ?? []).filter(Number.isFinite) as number[];
      const stats = {
        completedJobs: completedCount,
        avgRating: allRatings.length > 0 ? allRatings.reduce((a: number, b: number) => a + b, 0) / allRatings.length : 0,
        reviewCount: reviewsRes.count ?? allRatings.length,
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

      // Mutual jobs (#1) — silently degrade to 0 if the count read errored
      // (RLS, unexpected schema). The badge hides itself at 0.
      const mutualJobsCount = wantsMutual ? (mutualRes?.count ?? 0) : 0;
      if (wantsMutual && mutualRes?.error) {
        report(mutualRes.error, {
          severity: "warning",
          tags: { area: "user_profile.mutual_jobs" },
          context: { viewer_id: currentUserId, viewed_user_id: userId },
        });
      }

      // Derived completion stats (#6). On-time arrival = of completed jobs
      // with both `helper_arrived_at` AND `date_needed`+`start_time`, how
      // often did the helper arrive on or before the scheduled start.
      // Revision frequency = share of completed jobs with revision_count>0.
      // Both gate on minimum sample size of 5 to avoid sample-of-1 cliffs.
      let onTimeArrivalRate: number | null = null;
      let revisionFrequency: number | null = null;
      const timingRows = (workedTimingRes?.data || []) as Array<{
        date_needed: string;
        start_time: string | null;
        helper_arrived_at: string | null;
        revision_count: number | null;
      }>;
      if (timingRows.length >= 5) {
        const withRevision = timingRows.filter((j) => (j.revision_count ?? 0) > 0).length;
        revisionFrequency = (withRevision / timingRows.length) * 100;

        // Build a scheduled-start Date from date_needed + start_time. If
        // start_time is null, treat the start of date_needed as the target.
        // Drop rows that can't yield a comparable timestamp.
        const arrivalSample = timingRows.filter((j) => !!j.helper_arrived_at && !!j.date_needed);
        if (arrivalSample.length >= 5) {
          const onTime = arrivalSample.filter((j) => {
            const arrived = new Date(j.helper_arrived_at!).getTime();
            const scheduledIso = j.start_time
              ? `${j.date_needed}T${j.start_time}`
              : `${j.date_needed}T00:00:00`;
            const scheduled = new Date(scheduledIso).getTime();
            if (isNaN(scheduled) || isNaN(arrived)) return false;
            // 10-min grace — "on time" is a humane window, not a stopwatch.
            return arrived - scheduled <= 10 * 60_000;
          }).length;
          onTimeArrivalRate = (onTime / arrivalSample.length) * 100;
        }
      }

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
            id: r.id,
            rating: r.rating,
            punctuality: r.punctuality ?? null,
            quality: r.quality ?? null,
            communication: r.communication ?? null,
            feedback: r.feedback,
            created_at: r.created_at,
            reviewerName: nameMap.get(r.reviewer_id) || "User",
            jobTitle: j?.title || "Job",
            jobCategory: j?.category ?? null,
            response_text: r.response_text ?? null,
            response_at: r.response_at ?? null,
          };
        });
      }

      // Poster-side reputation — determine which reviews were received
      // for jobs where this user was the customer (poster). We resolve
      // job_id → customer_id by checking against postedJobs. Reviews
      // whose job_id maps to a job the user posted are "poster reviews".
      // Only show when there are 3+ poster reviews (same minimum as the
      // helper-side chart) to avoid noisy stats on fresh accounts.
      const postedJobIdSet = new Set(postedJobs.map((j) => j.id));
      const allReviewRows = (posterReviewsRes.data || []) as Array<{ rating: number; job_id: string }>;
      const posterReviewRows = allReviewRows.filter((r) => postedJobIdSet.has(r.job_id));
      const posterRatings = posterReviewRows.map((r) => r.rating);
      const posterReputation = posterRatings.length >= 3
        ? {
            reviewCount: posterRatings.length,
            avgRating: posterRatings.reduce((a, b) => a + b, 0) / posterRatings.length,
          }
        : null;

      return {
        profile: prof as Profile,
        reviews,
        stats,
        // Total count from the count-query on the limited reviews fetch.
        // Used on the render side to know whether there are more pages.
        reviewsTotalCount: reviewsRes.count ?? 0,
        postedJobs,
        workedJobs,
        responseMetrics,
        cancellationRate,
        mutualJobsCount,
        onTimeArrivalRate,
        revisionFrequency,
        // Serialize so React Query's cache survives a window reload (Date
        // objects don't round-trip JSON). Re-hydrate at the call site.
        lastActiveIso: lastActiveAt ? lastActiveAt.toISOString() : null,
        isIdVerified: !!idCheckRes.data?.id_document_url,
        // Verification-ladder inputs — passed straight through to
        // HelperTierBadge. Null-safe if the row read was blocked.
        tierProfile: {
          approval_status: idCheckRes.data?.approval_status ?? null,
          idv_status: idCheckRes.data?.idv_status ?? null,
          stripe_account_id: idCheckRes.data?.stripe_account_id ?? null,
        },
        posterReputation,
        postedTotalCount: postedTotalRes.count ?? 0,
        postedCancelledCount: postedCancelledRes.count ?? 0,
        // Repeat-hire % — null when the RPC isn't deployed yet (PGRST202)
        // or when the helper has no completed jobs yet.
        repeatHirePercent: repeatHireRes?.error ? null : (typeof repeatHireRes?.data === "number" ? repeatHireRes.data : null),
      };
    },
  });

  // "No disputes on record" trust signal — check whether any dispute
  // has been opened by this user via the new job_disputes table.
  // Wrapped in a separate query so a PGRST202 (table not yet deployed)
  // just hides the badge rather than blocking the whole profile load.
  const { data: disputeCheckData } = useQuery({
    queryKey: ["user_dispute_count", userId],
    enabled: !!userId && !!data?.profile,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from("job_disputes")
          .select("id", { count: "exact", head: true })
          .eq("opened_by", userId!);
        // PGRST202 = table not deployed yet — hide badge silently.
        if (error) return null;
        return { count: count ?? 0 };
      } catch {
        return null;
      }
    },
  });
  // Derive the clean-record flag: null = query not done or failed
  // (hide the badge), 0 = no disputes opened by this user (show signal).
  const hasCleanRecord = disputeCheckData?.count === 0;

  // Check for submitted credentials awaiting vendor verification — shows
  // an amber "Verification in progress" indicator on the profile.
  // Separate query so a PGRST202 (table not yet deployed) silently hides
  // the indicator rather than blocking the whole profile load.
  const { data: submittedCredentialsData } = useQuery({
    queryKey: ["user_submitted_credentials", userId],
    enabled: !!userId && !!data?.profile,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from("helper_credentials")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId!)
          .eq("status", "submitted");
        if (error) return null;
        return { count: count ?? 0 };
      } catch {
        return null;
      }
    },
  });
  const hasSubmittedCredentials = (submittedCredentialsData?.count ?? 0) > 0;

  // Pet care trust signal — count of distinct pets cared for + report cards
  // sent by this user. PGRST202-safe: silently hides badge if tables aren't
  // deployed yet.
  const { data: petCareSignal } = useQuery({
    queryKey: ["user_pet_care_signal", userId],
    enabled: !!userId && !!data?.profile,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        const [petsRes, reportsRes] = await Promise.all([
          supabase
            .from("pet_report_cards")
            .select("pet_id", { count: "exact" })
            .eq("helper_id", userId!),
          supabase
            .from("pet_report_cards")
            .select("id", { count: "exact", head: true })
            .eq("helper_id", userId!),
        ]);
        if (petsRes.error?.code === "PGRST202" || reportsRes.error?.code === "PGRST202") return null;
        if (petsRes.error || reportsRes.error) return null;
        const distinctPets = new Set((petsRes.data ?? []).map((r: any) => r.pet_id)).size;
        return { distinctPets, reportCount: reportsRes.count ?? 0 };
      } catch {
        return null;
      }
    },
  });

  const profile = (data?.profile ?? null) as Profile | null;
  const reviewsFromQuery = (data?.reviews ?? []) as Array<{ id: string; rating: number; punctuality: number | null; quality: number | null; communication: number | null; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string; jobCategory: string | null; response_text: string | null; response_at: string | null }>;
  // Sync localReviews whenever the query result changes (new fetch).
  // localReviews is used for optimistic updates after saving a response.
  useEffect(() => {
    setLocalReviews(reviewsFromQuery);
  }, [data?.reviews]);
  const reviews = (localReviews ?? reviewsFromQuery) as typeof reviewsFromQuery;
  const stats = data?.stats ?? { completedJobs: 0, avgRating: 0, reviewCount: 0 };

  // Pagination state for "load more reviews".
  const reviewsTotalCount = data?.reviewsTotalCount ?? stats.reviewCount;
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const reviewsHasMore = reviews.length < reviewsTotalCount;

  // Fetches the next page of reviews and appends them to localReviews.
  // Uses offset-based pagination against the same query as the queryFn.
  const loadMoreReviews = useCallback(async () => {
    if (!userId || loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      const from = reviews.length;
      const to = from + 19;
      const { data: moreRows, error } = await supabase
        .from("reviews")
        .select("id, rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id, response_text, response_at")
        .eq("reviewee_id", userId)
        .lte("feedback_visible_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        // PGRST202 or any other error — silently skip, don't append.
        report(error, { severity: "warning", tags: { area: "user_profile.load_more_reviews" }, context: { viewed_user_id: userId } });
        return;
      }

      if (!moreRows || moreRows.length === 0) return;

      // Enrich with reviewer names + job titles (same pattern as queryFn).
      const reviewerIds = [...new Set(moreRows.map((r: any) => r.reviewer_id))] as string[];
      const jobIds = [...new Set(moreRows.map((r: any) => r.job_id))] as string[];
      const [profilesRes2, jobsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: reviewerIds }),
        supabase.from("jobs").select("id, title, category").in("id", jobIds),
      ]);
      const nameMap = new Map(profilesRes2.data?.map((p: any) => [p.user_id, formatName(p.full_name)]) || []);
      const jobMap = new Map(jobsRes.data?.map((j: any) => [j.id, { title: j.title, category: j.category as string | null }]) || []);
      const enriched = moreRows.map((r: any) => {
        const j = jobMap.get(r.job_id);
        return {
          id: r.id,
          rating: r.rating,
          punctuality: r.punctuality ?? null,
          quality: r.quality ?? null,
          communication: r.communication ?? null,
          feedback: r.feedback,
          created_at: r.created_at,
          reviewerName: nameMap.get(r.reviewer_id) || "User",
          jobTitle: j?.title || "Job",
          jobCategory: j?.category ?? null,
          response_text: r.response_text ?? null,
          response_at: r.response_at ?? null,
        };
      });

      setLocalReviews((prev) => [...(prev ?? reviewsFromQuery), ...enriched]);
    } finally {
      setLoadingMoreReviews(false);
    }
  }, [reviews.length, userId, loadingMoreReviews, reviewsFromQuery]);
  const postedJobs = (data?.postedJobs ?? []) as Array<{ id: string; title: string; status: string; category: string; budget: number; created_at: string; latitude: number | null; longitude: number | null }>;
  const workedJobs = (data?.workedJobs ?? []) as Array<{ id: string; title: string; status: string; category: string; budget: number; created_at: string; latitude: number | null; longitude: number | null }>;
  const responseMetrics = data?.responseMetrics ?? { avgResponseHours: null, acceptanceRate: null, totalApplications: 0 };
  const cancellationRate = data?.cancellationRate ?? { total: 0, cancelled: 0, rate: null as number | null };
  const mutualJobsCount = data?.mutualJobsCount ?? 0;
  const onTimeArrivalRate = data?.onTimeArrivalRate ?? null;
  const revisionFrequency = data?.revisionFrequency ?? null;
  const lastActiveAt = data?.lastActiveIso ? new Date(data.lastActiveIso) : null;
  const isIdVerified = data?.isIdVerified ?? false;
  const tierProfile = data?.tierProfile ?? null;
  const posterReputation = data?.posterReputation ?? null;
  const postedTotalCount = data?.postedTotalCount ?? 0;
  const postedCancelledCount = data?.postedCancelledCount ?? 0;
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

  // Active-cohort label (#5). Cohort-based copy ("Active today" / "Active
  // this week") instead of exact "2h ago" — a privacy nudge so a viewer
  // can't pattern-match someone's online routine. Same two visual states
  // as before: "live" (green pulse) within 10 minutes, muted olivewood
  // otherwise. Returns null beyond 7 days so stale presence doesn't
  // mislead. The "Active now" label stays because it's already a coarse
  // 10-minute bucket, not a real-time indicator.
  const lastActiveLabel = (() => {
    if (!lastActiveAt) return null;
    const ms = Date.now() - lastActiveAt.getTime();
    if (ms < 0) return null; // clock skew safeguard
    if (ms < 10 * 60_000) return { text: "Active now", isLive: true };
    if (ms < 24 * 60 * 60_000) return { text: "Active today", isLive: false };
    if (ms < 7 * 24 * 60 * 60_000) return { text: "Active this week", isLive: false };
    return null;
  })();

  // Save or update the reviewee's public response to a review they received.
  const handleSaveResponse = async (reviewId: string) => {
    if (!responseText.trim()) return;
    try {
      const { error } = await (supabase.rpc as any)("respond_to_review", {
        _review_id: reviewId,
        _response_text: responseText.trim(),
      });
      if (error) {
        if (error.code === "PGRST202") {
          toast.error("Feature not yet deployed — please try again later.");
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
    }
  };

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
        title={isOwnProfile ? "Profile Review" : "Profile"}
        meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
        rightSlot={
          !isOwnProfile && currentUserId ? (
            <div className="flex items-center gap-1">
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
            </div>
          ) : null
        }
      />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-lg mx-auto space-y-5">
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

          {/* Stats */}
          <ProfileStatsGrid
            stats={stats}
            postedJobsCount={postedJobs.length}
            workedJobsCount={workedJobs.length}
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

          {/* Career milestones — earned badges based on job count, rating,
              and credential tier. Shows next-milestone progress on own profile.
              credential_tier: 2 = verified license (license_status=verified). */}
          {(() => {
            const credentialTier = (data as any)?.credentialTier ??
              (profile as any)?.license_status === "verified" ? 2 : 0;
            const milestoneStats = {
              completedJobs: stats.completedJobs,
              avgRating: stats.avgRating,
              repeatHirePercent: data?.repeatHirePercent ?? 0,
              credentialTier,
            };
            return (
              <CareerMilestones
                stats={milestoneStats}
                showProgress={isOwnProfile}
              />
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
              reviewsHasMore={reviewsHasMore}
              loadMoreReviews={loadMoreReviews}
              loadingMoreReviews={loadingMoreReviews}
            />
          )}

          {/* Posted Jobs expanded inline */}
          {showPostedJobs && <JobsList jobs={postedJobs} variant="posted" />}

          {/* Worked Jobs expanded inline */}
          {showWorkedJobs && <JobsList jobs={workedJobs} variant="worked" />}

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
