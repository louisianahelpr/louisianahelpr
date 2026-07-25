import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatName } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { queryKeys } from "@/lib/queryKeys";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import type { ProfileReview, ProfileJob } from "./types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// The three trust-signal side queries below are deliberately soft-failing —
// a missing table/function must hide a badge, not brick the profile. But
// "not deployed yet" is the ONLY benign case: PGRST202 (function missing),
// PGRST205 / 42P01 (relation missing). Every other error — RLS regression,
// timeout, outage — has to stay observable, otherwise a real failure reads
// as "this user has no disputes / no credentials / no pet history", which is
// a trust claim we'd be making without knowing it's true.
const NOT_DEPLOYED_CODES = new Set(["PGRST202", "PGRST205", "42P01"]);
function isNotDeployed(err: { code?: string } | null | undefined): boolean {
  return !!err?.code && NOT_DEPLOYED_CODES.has(err.code);
}

// Shared review-enrichment mapper — identical in both the initial queryFn
// fetch and the loadMore pagination path. Lifted verbatim so behaviour is
// preserved; both call sites previously inlined this exact same shape.
function enrichReviewRows(
  rows: any[],
  nameMap: Map<any, string>,
  jobMap: Map<any, { title: string; category: string | null }>,
): ProfileReview[] {
  return rows.map((r: any) => {
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

/**
 * Encapsulates every Supabase fetch + derivation the UserProfile page needs:
 * the primary profile query (with all its trust-signal / stats derivation),
 * the three PGRST202-safe side queries (disputes, submitted credentials, pet
 * care), and the offset-paginated "load more reviews" flow. Extracted verbatim
 * from UserProfile.tsx — no behaviour, error handling, or query shape changed.
 */
export function useUserProfileData(userId: string | undefined, currentUserId: string | null) {
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
      // Primary path: the masked RPC. We deliberately do NOT throw on its
      // error — a missing function (PGRST202 before a migration is pushed)
      // or any transient RPC failure used to collapse the whole query into
      // <ErrorState> ("Something went wrong"), which retry could never
      // recover because retry just re-ran the same failing RPC. Treat an
      // error the same as an empty result and fall through to the direct
      // select below, which RLS already gates to approved rows (and the
      // owner's own row) — so the page loads instead of hard-failing.
      const profileRes = await supabase.rpc("get_safe_profiles", { user_ids: [userId!] });
      let prof = (profileRes.error ? null : profileRes.data?.[0] ?? null) as any;

      if (!prof) {
        prof = unwrap(
          await supabase
            .from("profiles")
            .select("user_id, full_name, avatar_url, bio, location, skills, hourly_rate, subscription_tier, portfolio_urls, created_at, background_check_status")
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

      const [reviewsRes, postedRes, workedRes, appsRes, idCheckRes, postedTotalRes, postedCancelledRes, workedTotalRes, workedCancelledRes, lastActiveRes, mutualRes, workedTimingRes, posterReviewsRes, repeatHireRes, credentialTierRes] = await Promise.all([
        // feedback_visible_at filter: anti-retaliation reveal — hidden until
        // both sides post or 14 days pass. set_review_visibility trigger
        // stamps this column on insert.
        supabase.from("reviews").select("id, rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id, response_text, response_at, jobs!inner(status)", { count: "exact" }).eq("reviewee_id", userId!).lte("feedback_visible_at", new Date().toISOString()).neq("jobs.status", "cancelled").order("created_at", { ascending: false }).limit(20),
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
          .select("id_document_url, approval_status, idv_status, stripe_account_id, background_check_status")
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
        // as a job poster (customer). `customer_id` is pulled through the
        // inner join so the poster/helper split below is decided by the
        // job's OWN authoritative owner column. It used to be decided by
        // membership in `postedJobs`, which carries a .limit(20) — so a
        // poster with 100+ jobs had their reputation computed from only
        // their 20 most recent. This query is deliberately unlimited (same
        // as the avgRating path it already feeds). Degrades gracefully to
        // empty on error.
        supabase
          .from("reviews")
          .select("rating, job_id, jobs!inner(status, customer_id)")
          .eq("reviewee_id", userId!)
          .lte("feedback_visible_at", new Date().toISOString())
          .neq("jobs.status", "cancelled"),
        // Repeat-hire % (#milestones) — % of unique customers who hired
        // this helper more than once. PGRST202-safe: function may not be
        // deployed on production yet; falls back to null (milestone hidden).
        supabase.rpc("get_user_repeat_hire_percent" as any, { p_user_id: userId! }),
        // Credential tier (0-3) — drives the "Licensed Pro" career milestone
        // (requires tier >= 2 = verified trade license). SECURITY DEFINER and
        // granted to `authenticated`, so it resolves for any viewed profile,
        // not just the viewer's own. Same RPC the Apply-gate uses in
        // useJobDetailData.ts. PGRST202-safe: falls back to 0.
        supabase.rpc("get_user_credential_tier", { p_user_id: userId! }),
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
      // Credential-tier RPC: same PGRST202-safe pattern, plus 42501
      // (insufficient privilege) — EXECUTE is granted to `authenticated` only,
      // so a signed-out visitor viewing a public profile hits that every time.
      // Both mean "no tier available", not "outage": tier 0 hides the badge.
      if (
        credentialTierRes.error &&
        credentialTierRes.error.code !== "PGRST202" &&
        credentialTierRes.error.code !== "42501"
      ) {
        report(credentialTierRes.error, {
          severity: "warning",
          tags: { area: "user_profile.credential_tier" },
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
        // `supabase.rpc(...)` returns a Postgrest builder — a thenable, NOT a
        // real Promise, so it has no `.catch`. Calling `.catch` on it throws
        // synchronously and rejects the whole queryFn (bricking every other
        // user's profile with "couldn't load this"). Wrap in Promise.resolve
        // to get a real Promise before swallowing.
        void Promise.resolve((supabase.rpc as any)("record_profile_view", { p_viewed_user_id: userId })).catch(() => {/* silent */});
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
        reviews = enrichReviewRows(reviewsRes.data, nameMap, jobMap);
      }

      // Poster-side reputation — determine which reviews were received
      // for jobs where this user was the customer (poster). The joined
      // `jobs.customer_id` answers that per row, so this covers the user's
      // ENTIRE posting history rather than the 20 rows `postedJobs` renders.
      // PostgREST returns a to-one embed as an object, but the generated
      // types occasionally infer an array — read both shapes defensively.
      // Only show when there are 3+ poster reviews (same minimum as the
      // helper-side chart) to avoid noisy stats on fresh accounts.
      const allReviewRows = (posterReviewsRes.data ?? []) as any[];
      const posterReviewRows = allReviewRows.filter((r) => {
        const job = Array.isArray(r?.jobs) ? r.jobs[0] : r?.jobs;
        return job?.customer_id === userId;
      });
      const posterRatings = posterReviewRows
        .map((r) => r.rating as number)
        .filter(Number.isFinite);
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
        backgroundCheckStatus: (idCheckRes.data?.background_check_status ?? "none") as string,
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
        // Credential tier 0-3 — 0 when the RPC errored/isn't deployed, which
        // simply withholds the "Licensed Pro" milestone rather than claiming it.
        credentialTier:
          credentialTierRes?.error || typeof credentialTierRes?.data !== "number"
            ? 0
            : credentialTierRes.data,
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
        // Table not deployed yet — hide the badge silently. Any other error
        // is a real failure: report it rather than let it pass for a count
        // we never actually read.
        if (error) {
          if (!isNotDeployed(error)) {
            report(error, {
              severity: "warning",
              tags: { area: "user_profile.dispute_count" },
              context: { viewed_user_id: userId },
            });
          }
          return null;
        }
        return { count: count ?? 0 };
      } catch (e) {
        report(e, {
          severity: "warning",
          tags: { area: "user_profile.dispute_count" },
          context: { viewed_user_id: userId },
        });
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
        // Same split as above: undeployed table = quiet, anything else is a
        // real failure and must be reported.
        if (error) {
          if (!isNotDeployed(error)) {
            report(error, {
              severity: "warning",
              tags: { area: "user_profile.submitted_credentials" },
              context: { viewed_user_id: userId },
            });
          }
          return null;
        }
        return { count: count ?? 0 };
      } catch (e) {
        report(e, {
          severity: "warning",
          tags: { area: "user_profile.submitted_credentials" },
          context: { viewed_user_id: userId },
        });
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
        // Undeployed pet_report_cards = hide the badge quietly. Any other
        // error (RLS, timeout) is reported before we degrade, so an outage
        // isn't indistinguishable from "never cared for a pet".
        // Check each leg on its own: a genuine failure on one must not be
        // excused by an undeployed code on the other.
        for (const [leg, err] of [
          ["pets", petsRes.error],
          ["reports", reportsRes.error],
        ] as const) {
          if (err && !isNotDeployed(err)) {
            report(err, {
              severity: "warning",
              tags: { area: `user_profile.pet_care_signal.${leg}` },
              context: { viewed_user_id: userId },
            });
          }
        }
        if (petsRes.error || reportsRes.error) return null;
        const distinctPets = new Set((petsRes.data ?? []).map((r: any) => r.pet_id)).size;
        return { distinctPets, reportCount: reportsRes.count ?? 0 };
      } catch (e) {
        report(e, {
          severity: "warning",
          tags: { area: "user_profile.pet_care_signal" },
          context: { viewed_user_id: userId },
        });
        return null;
      }
    },
  });

  const reviewsFromQuery = (data?.reviews ?? []) as ProfileReview[];
  // Local reviews state for optimistic updates after saving a response.
  const [localReviews, setLocalReviews] = useState<any[] | null>(null);
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
      const enriched = enrichReviewRows(moreRows, nameMap, jobMap);

      setLocalReviews((prev) => [...(prev ?? reviewsFromQuery), ...enriched]);
    } finally {
      setLoadingMoreReviews(false);
    }
  }, [reviews.length, userId, loadingMoreReviews, reviewsFromQuery]);

  const postedJobs = (data?.postedJobs ?? []) as ProfileJob[];
  const workedJobs = (data?.workedJobs ?? []) as ProfileJob[];
  // The "Completed" stat tile is a trust signal — it must count only jobs
  // actually finished as a helper, not every job taken. workedJobs includes
  // In Progress / Accepted rows, so filter to completed before counting or
  // listing under that label.
  const completedWorkedJobs = workedJobs.filter((j) => j.status === "completed");
  const responseMetrics = data?.responseMetrics ?? { avgResponseHours: null, acceptanceRate: null, totalApplications: 0 };
  const cancellationRate = data?.cancellationRate ?? { total: 0, cancelled: 0, rate: null as number | null };
  const mutualJobsCount = data?.mutualJobsCount ?? 0;
  const onTimeArrivalRate = data?.onTimeArrivalRate ?? null;
  const revisionFrequency = data?.revisionFrequency ?? null;
  const lastActiveAt = data?.lastActiveIso ? new Date(data.lastActiveIso) : null;
  const isIdVerified = data?.isIdVerified ?? false;
  const backgroundCheckStatus = data?.backgroundCheckStatus ?? "none";
  const tierProfile = data?.tierProfile ?? null;
  const posterReputation = data?.posterReputation ?? null;
  const postedTotalCount = data?.postedTotalCount ?? 0;
  const postedCancelledCount = data?.postedCancelledCount ?? 0;
  const loading = isLoading && !data;

  return {
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
    // Exported alongside reviewsHasMore so the pagination UI's "(x of y)"
    // denominator is the exact value the has-more check is derived from.
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
  };
}
