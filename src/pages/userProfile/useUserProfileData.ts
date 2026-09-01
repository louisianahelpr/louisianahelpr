import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatName } from "@/lib/utils";
import { formatCategory } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { queryKeys } from "@/lib/queryKeys";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { pickRequestedProfile } from "@/lib/safeProfiles";
import type { ProfileReview, ProfileJob, ReplyLatency } from "./types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// The trust-signal side queries below are deliberately soft-failing —
// a missing table/function must hide a badge, not brick the profile. But
// "not deployed yet" is the ONLY benign case: PGRST202 (function missing),
// PGRST205 / 42P01 (relation missing). Every other error — RLS regression,
// timeout, outage — has to stay observable, otherwise a real failure reads
// as "this user has no credentials / no pet history", which is a trust claim
// we'd be making without knowing it's true. (The dispute-count query that
// used to sit alongside these was removed for exactly that reason — see the
// note further down: RLS made its answer meaningless, not just fragile.)
const NOT_DEPLOYED_CODES = new Set(["PGRST202", "PGRST205", "42P01"]);
function isNotDeployed(err: { code?: string } | null | undefined): boolean {
  return !!err?.code && NOT_DEPLOYED_CODES.has(err.code);
}

/* ───────────────────────────────────────────────────────────────────────────
   PUBLIC STATS — the numbers a STRANGER is allowed to be told.

   Measured on prod 2026-09-01 with a purpose-built auth user holding zero
   shared history with anybody, querying through PostgREST as themselves:

     jobs                            → []      applications              → []
     profiles (another member's row) → []      reviews + jobs!inner(…)   → []
     reviews with NO join            → 5 rows

   So every stat this hook derived below — review count, average rating, job
   counts, cancellation rate, on-time rate, revision rate, the trust flags —
   was structurally 0/false for every visitor, while `get_user_repeat_hire_
   percent` (SECURITY DEFINER) kept answering truthfully. The two collided on
   one card: profile 6bdc1f67 rendered "New · No reviews yet" beside "100%
   Clients who rebooked". A visitor read both as measurements. One was.

   `get_public_profile_stats` / `get_public_profile_reviews` (migration
   20260901002325) compute those numbers server-side where the rows are
   readable, with every sample floor enforced in SQL. When they answer, they
   WIN over the client-side derivations below — for the owner too, so there is
   one set of numbers rather than two that disagree. When they don't answer
   (PGRST202 in the merge→`db push` window) the client derivations stand,
   which is exactly today's behaviour.
   ─────────────────────────────────────────────────────────────────────────── */
type PublicProfileStatsRow = {
  user_id: string;
  review_count: number | null;
  avg_rating: number | string | null;
  poster_review_count: number | null;
  poster_avg_rating: number | string | null;
  completed_jobs_as_helper: number | null;
  completed_jobs_total: number | null;
  posted_jobs_total: number | null;
  jobs_total: number | null;
  cancelled_jobs: number | null;
  cancellation_rate: number | string | null;
  on_time_sample: number | null;
  on_time_rate: number | string | null;
  revision_sample: number | null;
  revision_rate: number | string | null;
  repeat_client_sample: number | null;
  repeat_hire_percent: number | string | null;
  approval_status: string | null;
  is_id_verified: boolean | null;
  has_stripe_account: boolean | null;
  is_background_checked: boolean | null;
  has_pending_credentials: boolean | null;
};

type PublicProfileReviewRow = {
  id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewer_name: string | null;
  job_category: string | null;
  response_text: string | null;
  response_at: string | null;
  total_count: number | string | null;
};

/**
 * Postgres `numeric` crosses PostgREST as a STRING ("4.57"), and `Number(null)`
 * is `0` — which is the precise shape of the bug this whole change exists to
 * kill. Unknown stays `null` all the way to the render site so the UI can say
 * "not enough history yet" instead of printing a zero nobody measured.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
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
      reviewerName: nameMap.get(r.reviewer_id) || "a neighbor",
      jobTitle: j?.title || "a task",
      jobCategory: j?.category ?? null,
      response_text: r.response_text ?? null,
      response_at: r.response_at ?? null,
    };
  });
}

/**
 * Encapsulates every Supabase fetch + derivation the UserProfile page needs:
 * the primary profile query (with all its trust-signal / stats derivation),
 * the PGRST202-safe side queries (submitted credentials, pet care), and the
 * offset-paginated "load more reviews" flow.
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
      //
      // Do NOT take row [0] blind. `get_safe_profiles` matches EITHER
      // `profiles.user_id` OR `profiles.id` (deliberately — see
      // 20260817230000_get_safe_profiles_resolve_by_profile_id.sql; Messages
      // needs it because messages.sender_id has no FK and prod stores profile
      // ids there). Those are two key spaces over one table, so a single uuid
      // can be person A's user_id AND person B's id at the same time. On prod
      // today 6bdc1f67-...a6147 is Audit Helper's auth id and ALSO Eli
      // Thibodeaux's profiles.id — so asking for the helper who applied to your
      // job returned Eli's name, avatar, bio and trust record. This is the
      // vetting screen; showing the wrong human here is the worst thing it can
      // do, and it did it silently: no error, no empty result.
      //
      // So re-match what came back against what we asked for. A dropped row
      // falls through to the self-select / not-found path below, which is the
      // right outcome: an honest "profile unavailable" beats a wrong identity.
      const profileRes = await supabase.rpc("get_safe_profiles", { user_ids: [userId!] });
      const profileRows = (profileRes.error ? [] : profileRes.data ?? []) as Array<
        { user_id?: string | null; profile_id?: string | null }
      >;
      let prof = pickRequestedProfile(profileRows, userId) as any;

      if (!prof && profileRows.length > 0) {
        // Rows came back and not one of them answers the id we asked for. That
        // is a data-integrity fact worth seeing, not a quiet miss.
        report(new Error("get_safe_profiles returned only non-matching rows"), {
          severity: "warning",
          tags: {
            source: "useUserProfileData",
            requestedUserId: userId ?? "",
            returnedUserIds: profileRows.map((r) => r?.user_id ?? "null").join(","),
          },
        });
      }

      if (!prof) {
        prof = unwrap(
          await supabase
            .from("profiles")
            .select("user_id, full_name, avatar_url, bio, location, skills, subscription_tier, portfolio_urls, created_at, background_check_status")
            .eq("user_id", userId!)
            .maybeSingle(),
        );
      }

      if (!prof) {
        return { profile: null as Profile | null };
      }

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

      // The uuid in the URL may be a `profiles.id` rather than an auth
      // `user_id` (Messages links do this — see the long note above). `prof`
      // has already been re-matched against what we asked for, so its
      // `user_id` is the authoritative identity of the human on screen. The
      // new stats RPCs are keyed off THAT, not off the raw route param, so
      // they can never aggregate a different person's record onto this page.
      const targetUserId = ((prof as { user_id?: string | null }).user_id ?? userId) as string;

      /* Reply latency is the OWNER's own number and the RPC that computes it
         takes no argument — it reads auth.uid(), so it cannot be pointed at
         anyone else. Skip the round trip entirely on a visitor's view rather
         than fire a call whose answer is structurally an empty sample. Both
         key spaces are accepted because the route param may be a
         `profiles.id` (Messages links do that — see the note above). */
      const wantsReplyLatency =
        !!currentUserId && (currentUserId === targetUserId || currentUserId === userId);

      const [reviewsRes, postedRes, workedRes, idCheckRes, postedTotalRes, postedCancelledRes, workedTotalRes, workedCancelledRes, lastActiveRes, mutualRes, workedTimingRes, posterReviewsRes, repeatHireRes, credentialTierRes, existingThreadRes, appliedToMineRes, publicStatsRes, publicReviewsRes, replyLatencyRes] = await Promise.all([
        // feedback_visible_at filter: anti-retaliation reveal — hidden until
        // both sides post or 14 days pass. set_review_visibility trigger
        // stamps this column on insert.
        supabase.from("reviews").select("id, rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id, response_text, response_at, jobs!inner(status)", { count: "exact" }).eq("reviewee_id", userId!).lte("feedback_visible_at", new Date().toISOString()).neq("jobs.status", "cancelled").order("created_at", { ascending: false }).limit(20),
        supabase.from("jobs").select("id, title, status, category, budget, created_at").eq("customer_id", userId!).order("created_at", { ascending: false }).limit(20),
        supabase.from("jobs").select("id, title, status, category, budget, created_at").eq("helper_id", userId!).order("created_at", { ascending: false }).limit(20),
        // Verification-ladder inputs (#112): grab the trust signals while
        // we're already touching this row. `get_safe_profiles` doesn't
        // expose these, but the profiles RLS policy already permits SELECT
        // on any approved row (that's the same gate `id_document_url`
        // relies on), so a direct select is fine.
        supabase
          .from("profiles")
          .select("id_document_url, approval_status, stripe_identity_verified, stripe_account_id, background_check_status")
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
        /* CAN THIS VIEWER OPEN A THREAD WITH THIS PERSON?
           House rule (owner): "shouldnt be able to message the poster. poster
           must message them first." A helpr may not cold-message somebody
           whose job they are hoping to get; the poster opens the conversation.

           Two queries, and either one is a yes:

           1. A message already exists in either direction. Once a thread is
              open the rule has been satisfied — whoever started it, both sides
              can reply, and hiding the button then would strand a live
              conversation behind a profile you can no longer reach it from.
           2. This person has APPLIED to one of the viewer's jobs. That is the
              poster's own inbound pile, and reaching out to a candidate is
              precisely the move the rule exists to protect.

           `mutualJobsCount` (already fetched above) is the third yes: a job you
           have actually worked together on. */
        wantsMutual
          ? supabase
              .from("messages")
              .select("id", { count: "exact", head: true })
              .or(
                `and(sender_id.eq.${currentUserId},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUserId})`,
              )
          : Promise.resolve({ data: null, error: null, count: 0 } as any),
        wantsMutual
          ? supabase
              .from("applications")
              .select("id, jobs!inner(customer_id)", { count: "exact", head: true })
              .eq("helper_id", userId!)
              .eq("jobs.customer_id", currentUserId!)
          : Promise.resolve({ data: null, error: null, count: 0 } as any),
        // THE PUBLIC AGGREGATES. Granted to anon AND authenticated — a
        // signed-out visitor is the truest stranger there is, and a count and
        // a mean identify nobody.
        supabase.rpc("get_public_profile_stats" as any, { p_user_ids: [targetUserId] }),
        // THE PUBLIC REVIEW LIST. Replaces the `reviews … jobs!inner(status)`
        // select above, whose inner join runs through a table RLS hides from
        // every visitor — which is why it returned zero rows for all of them
        // while a bare `reviews` select returned five. Granted to
        // `authenticated` only, deliberately: that is the exact audience the
        // `reviews` SELECT policy already allows, so the join is fixed without
        // widening who can read a review by one person.
        supabase.rpc("get_public_profile_reviews" as any, {
          p_user_id: targetUserId,
          p_limit: 20,
          p_offset: 0,
        }),
        /* TYPICAL REPLY TIME — the owner's own, measured from real message
           threads. This replaces `avg(applications.updated_at - created_at)`,
           which measured the POSTER's latency and published it under the
           helper's name; see 20260901005108 for the prod rows that prove it.
           Self-only by construction (no argument, reads auth.uid()), so a
           visitor never fires it. */
        wantsReplyLatency
          ? supabase.rpc("get_my_reply_latency" as any)
          : Promise.resolve({ data: null, error: null } as any),
      ]);

      // These five feed secondary stats (reviews, job counts, response
      // metrics, trust signals) — a failure should degrade gracefully to
      // empty rather than brick the whole profile over the critical name/bio
      // we already have. But don't silently swallow: report so a real outage
      // is observable instead of looking like "this user has 0 reviews".
      for (const [label, res] of [
        ["reviews", reviewsRes], ["posted_jobs", postedRes], ["worked_jobs", workedRes],
        ["trust_signals", idCheckRes],
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
      /* PUBLIC-STATS RPCs — the same PGRST202-safe split every other RPC on
         this page uses, with one addition. `get_public_profile_reviews` is
         granted to `authenticated` only, so a signed-out visitor gets 42501
         on every single call; that is the designed outcome, not an outage, and
         reporting it would bury Sentry in noise from the marketing traffic.
         Anything else — RLS regression, timeout, a broken function body — must
         stay observable, because a silently-swallowed failure here reads as
         "this person has no record", which is a trust claim we would be making
         without knowing it is true. */
      // `get_public_profile_stats` / `get_public_profile_reviews` are not in the
      // generated `Database` types until the migration lands and types are
      // regenerated, so the two results are read through an explicit shape.
      type RpcResult = { data?: unknown; error?: { code?: string } | null };
      const statsRes = publicStatsRes as RpcResult;
      const reviewsRpcRes = publicReviewsRes as RpcResult;

      const replyRpcRes = replyLatencyRes as RpcResult;

      for (const [label, res, benign] of [
        ["public_stats", statsRes, ["PGRST202"]],
        ["public_reviews", reviewsRpcRes, ["PGRST202", "42501"]],
        // Same split: PGRST202 is the deploy-lag window, 42501 is a signed-out
        // caller hitting an `authenticated`-only grant. Neither is an outage.
        ["reply_latency", replyRpcRes, ["PGRST202", "42501"]],
      ] as const) {
        const err = res.error;
        if (err && !benign.includes(err.code as never)) {
          report(err, {
            severity: "warning",
            tags: { area: `user_profile.${label}` },
            context: { viewed_user_id: targetUserId },
          });
        }
      }

      /* Re-match the aggregate row against the person we are actually showing.
         `get_public_profile_stats` resolves BOTH `profiles.user_id` and
         `profiles.id` (same contract as get_safe_profiles), and on prod a
         single uuid is already one member's auth id and a different member's
         profile id. Taking row [0] blind is how the wrong human's trust record
         lands on a vetting screen; it happened once already and was silent. */
      const publicStats: PublicProfileStatsRow | null = statsRes.error
        ? null
        : ((statsRes.data ?? []) as PublicProfileStatsRow[]).find(
            (r) => r?.user_id === targetUserId,
          ) ?? null;

      const hasPublicReviewRpc = !reviewsRpcRes.error && Array.isArray(reviewsRpcRes.data);
      const publicReviewRows: PublicProfileReviewRow[] = hasPublicReviewRpc
        ? (reviewsRpcRes.data as PublicProfileReviewRow[])
        : [];

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
      /* THE HEADLINE NUMBERS. The RPC wins whenever it answered — for the
         owner as well as for a visitor, so the page cannot show one person two
         different averages depending on who is looking. The client-side
         derivation underneath is the PGRST202 fallback and is left byte-for-
         byte as it was, so the deploy-lag window behaves exactly like today.
         `avgRating` keeps its `0`-means-none contract because `computeBadges`
         and `computeHelperTier` are written against it; nothing renders that 0
         — every display site gates on `reviewCount > 0` first. */
      const stats = {
        completedJobs: int(publicStats?.completed_jobs_total) ?? completedCount,
        avgRating:
          num(publicStats?.avg_rating) ??
          (publicStats
            ? 0
            : allRatings.length > 0
            ? allRatings.reduce((a: number, b: number) => a + b, 0) / allRatings.length
            : 0),
        reviewCount: int(publicStats?.review_count) ?? reviewsRes.count ?? allRatings.length,
      };

      // Cancellation-rate metric (#30) — separate posted-side vs worked-side
      // rates so the badge can read "the right" rate for the audience. We
      // compute the combined rate inline at the render site. A minimum
      // sample size of 5 prevents "1 of 1 cancelled = 100%" cliffs on
      // fresh accounts.
      const clientTotalJobsCount = (postedTotalRes.count ?? 0) + (workedTotalRes.count ?? 0);
      const clientTotalCancelledCount =
        (postedCancelledRes.count ?? 0) + (workedCancelledRes.count ?? 0);
      // The >= 5 floor now lives in SQL (one rule, not two), so `rate` arrives
      // already NULL below it. The counts come back too, so the card can still
      // say WHY it is withholding — "after 5 jobs" — instead of just vanishing.
      const totalJobsCount = int(publicStats?.jobs_total) ?? clientTotalJobsCount;
      const totalCancelledCount = int(publicStats?.cancelled_jobs) ?? clientTotalCancelledCount;
      const cancellationRate = {
        total: totalJobsCount,
        cancelled: totalCancelledCount,
        rate: publicStats
          ? num(publicStats.cancellation_rate)
          : totalJobsCount >= 5
          ? (totalCancelledCount / totalJobsCount) * 100
          : null,
      };

      // Mutual jobs (#1) — silently degrade to 0 if the count read errored
      // (RLS, unexpected schema). The badge hides itself at 0.
      const mutualJobsCount = wantsMutual ? (mutualRes?.count ?? 0) : 0;
      /* See the two queries above. TRUE when there is no viewer to gate
         (own profile / signed out) because the button is not rendered in those
         cases anyway, and false-by-default there would make the gate look like
         it had fired when it never ran. An errored count reads as 0 — deny —
         because the failure we care about is opening a channel the rule says
         should stay shut. */
      const canMessage = wantsMutual
        ? mutualJobsCount > 0 ||
          (existingThreadRes?.count ?? 0) > 0 ||
          (appliedToMineRes?.count ?? 0) > 0
        : true;
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

      /* Server-side wins. Two things the SQL gets right that the block above
         could not:
           1. It sees the whole completed history. The select above carries a
              .limit(50) — an artefact of paging a table, not a decision about
              what the rate should mean.
           2. Timezone. `new Date("2026-07-01T09:00:00")` resolves in the
              VIEWER's zone, so the same helper was on time in Baton Rouge and
              five hours late in London. The RPC pins America/Chicago, which is
              the zone `date_needed` + `start_time` were written in.
         Sample sizes come back alongside so the card can say "after 5 jobs"
         rather than silently dropping a cell. */
      const onTimeSample = int(publicStats?.on_time_sample) ?? timingRows.length;
      const revisionSample = int(publicStats?.revision_sample) ?? timingRows.length;
      if (publicStats) {
        onTimeArrivalRate = num(publicStats.on_time_rate);
        revisionFrequency = num(publicStats.revision_rate);
      }

      /* ── TYPICAL REPLY TIME ────────────────────────────────────────────
         Was: `avg(applications.updated_at - applications.created_at)` over the
         ACCEPTED applications this member submitted, labelled "Avg. reply
         time" on their own profile. Neither end of that subtraction is a reply
         and only one end is theirs — `created_at` is them applying, and
         `updated_at` is a last-touch column that RLS lets only the POSTER
         write. Prod, 2026-09-01: three different helpers on three different
         jobs shared one `updated_at` to the microsecond (a bulk maintenance
         write), and the card rendered the distance to it as 22d / 17d / 3d of
         "reply time".

         Now: the median gap between the other party's message and this
         member's answer, over real threads, computed by
         `get_my_reply_latency()`. Median rather than mean because one
         overnight gap moved a real member's mean from 47m to 6.6h. NULL below
         five replies — the floor the cancellation, on-time and revision rates
         already use — and NULL, never 0, while the RPC is undeployed.

         The old sibling metric, "Accept rate", is not replaced. It is deleted;
         see the note in AtAGlanceCard.tsx. */
      const replyRow = (Array.isArray(replyRpcRes.data) ? replyRpcRes.data[0] : null) as
        | { reply_sample?: number | string | null; median_reply_minutes?: number | string | null }
        | null;
      const replyLatency: ReplyLatency = {
        medianReplyMinutes: replyRow ? num(replyRow.median_reply_minutes) : null,
        replySample: replyRow ? int(replyRow.reply_sample) ?? 0 : 0,
        // Only true when the RPC actually answered. A visitor (never called)
        // and a deploy-lag PGRST202 both land here as `false`, so the card
        // stays silent instead of claiming a measurement it does not have.
        measured: !replyRpcRes.error && !!replyRow,
      };

      let reviews: any[] = [];
      /* PREFERRED PATH: the DEFINER function. It already applied the reveal
         window and the cancelled-job exclusion in SQL, masked the reviewer's
         name by the same approved-and-not-banned rule get_safe_profiles uses,
         and returned the job's CATEGORY rather than its title — titles are
         free text and routinely carry a street or a surname, and a sibling
         lane spent today closing an address leak. It also saves the two
         follow-up round trips the fallback needs, one of which (`jobs`
         .select(title, category)) returns nothing for a visitor anyway, which
         is why every review on a stranger's view read "For: a task". */
      if (hasPublicReviewRpc) {
        reviews = publicReviewRows.map((r) => ({
          id: r.id,
          rating: r.rating,
          punctuality: r.punctuality ?? null,
          quality: r.quality ?? null,
          communication: r.communication ?? null,
          feedback: r.feedback,
          created_at: r.created_at,
          reviewerName: r.reviewer_name ? formatName(r.reviewer_name) : "a neighbor",
          jobTitle: r.job_category ? formatCategory(r.job_category) : "a task",
          jobCategory: r.job_category ?? null,
          response_text: r.response_text ?? null,
          response_at: r.response_at ?? null,
        })) as ProfileReview[];
      } else if (reviewsRes.data && reviewsRes.data.length > 0) {
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
      // Same 3-review floor, now enforced in SQL: `poster_avg_rating` arrives
      // already NULL below it, so there is one rule instead of two that can
      // drift apart.
      const publicPosterAvg = publicStats ? num(publicStats.poster_avg_rating) : null;
      const publicPosterCount = int(publicStats?.poster_review_count) ?? 0;
      const posterReputation = publicStats
        ? publicPosterAvg !== null
          ? { reviewCount: publicPosterCount, avgRating: publicPosterAvg }
          : null
        : posterRatings.length >= 3
        ? {
            reviewCount: posterRatings.length,
            avgRating: posterRatings.reduce((a, b) => a + b, 0) / posterRatings.length,
          }
        : null;

      return {
        profile: {
          ...(prof as Profile),
          /* ProfileHeaderCard reads `background_check_status` straight off the
             profile object, and `get_safe_profiles` does not return it — so
             the Background-Checked badge was permanently dark on every
             visitor's view of every profile. Only the AFFIRMATIVE verdict is
             published: 'pending' and 'failed' are negative safety claims about
             a named individual and stay with the owner, whose own row RLS
             already lets them read (that value survives the `??` below). */
          ...(publicStats?.is_background_checked
            ? { background_check_status: "verified" }
            : {}),
        } as Profile,
        reviews,
        stats,
        /* PAGINATION denominator — the number of reviews this viewer can
           actually LOAD, which is not the same as `stats.reviewCount`, the
           number that exist. A signed-out visitor is told the true count (5)
           but cannot read the prose, so conflating the two would render a
           "Load more" button that loads nothing forever. */
        reviewsTotalCount: hasPublicReviewRpc
          ? int(publicReviewRows[0]?.total_count) ?? publicReviewRows.length
          : reviewsRes.count ?? 0,
        /* FALSE only for a viewer with no session: review prose is granted to
           `authenticated`, exactly as the `reviews` RLS policy already was.
           The card uses this to say "sign in to read them" instead of the flat
           lie "No reviews yet". */
        canReadReviewText: hasPublicReviewRpc || !reviewsRes.error,
        // Sample sizes behind each gated rate, so the UI can distinguish
        // "measured 0%" from "not enough history yet" and say which.
        statSamples: {
          jobs: totalJobsCount,
          onTime: onTimeSample,
          revisions: revisionSample,
          repeatClients: int(publicStats?.repeat_client_sample) ?? 0,
          posterReviews: publicStats ? publicPosterCount : posterRatings.length,
          hasServerStats: !!publicStats,
        },
        postedJobs,
        workedJobs,
        replyLatency,
        cancellationRate,
        mutualJobsCount,
        canMessage,
        onTimeArrivalRate,
        revisionFrequency,
        // Serialize so React Query's cache survives a window reload (Date
        // objects don't round-trip JSON). Re-hydrate at the call site.
        lastActiveIso: lastActiveAt ? lastActiveAt.toISOString() : null,
        // Was `!!id_document_url` — i.e. merely HAVING UPLOADED A FILE earned
        // a public "Verified Helpr" ribbon shown to strangers, even though
        // nobody reviews the upload. Now it is Stripe's identity verdict.
        // See supabase/functions/_shared/stripeIdentity.ts.
        // `idCheckRes` is a direct `profiles` select, which RLS permits on
        // your OWN row only — measured: zero rows for any other member. So
        // this was permanently false for every visitor. The RPC computes it
        // server-side; the direct read stays as the PGRST202 fallback.
        isIdVerified:
          publicStats?.is_id_verified ?? idCheckRes.data?.stripe_identity_verified === true,
        // Owner-only surface (the purchase CTA). Deliberately NOT sourced from
        // the RPC: the raw status is never published, only the 'verified' bit.
        backgroundCheckStatus: (idCheckRes.data?.background_check_status ?? "none") as string,
        // Verification-ladder inputs — passed straight through to
        // HelperTierBadge, which was therefore tier 0 (badge hidden) on every
        // visitor's view for the same RLS reason.
        tierProfile: {
          approval_status: publicStats?.approval_status ?? idCheckRes.data?.approval_status ?? null,
          stripe_identity_verified:
            publicStats?.is_id_verified ?? idCheckRes.data?.stripe_identity_verified ?? null,
          /* The ladder only ever truthiness-tests this (`if
             (!profile.stripe_account_id) return false` in src/lib/helperTier.ts),
             so the RPC publishes a boolean and the real acct_… identifier never
             leaves the database. The sentinel is a presence marker, not an id —
             do not start reading it as one. */
          stripe_account_id: publicStats
            ? publicStats.has_stripe_account
              ? "connected"
              : null
            : idCheckRes.data?.stripe_account_id ?? null,
        },
        posterReputation,
        postedTotalCount: int(publicStats?.posted_jobs_total) ?? postedTotalRes.count ?? 0,
        postedCancelledCount: postedCancelledRes.count ?? 0,
        // Jobs completed AS A HELPER. `completedWorkedJobs.length` counts a
        // .limit(20) page of rows a visitor cannot read at all — it was 0 for
        // every stranger and capped at 20 for everybody else.
        completedAsHelperCount: int(publicStats?.completed_jobs_as_helper),
        /* Repeat-hire % — now gated at 3 distinct completed-job clients.
           Ungated, ONE returning customer published a boldfaced "100% Clients
           who rebooked", which is the half of the contradiction that was
           technically true and still misleading. Below the floor this is null
           and the cell does not render. Falls back to the older ungated RPC
           only while the new one is undeployed. */
        repeatHirePercent: publicStats
          ? num(publicStats.repeat_hire_percent)
          : repeatHireRes?.error
          ? null
          : typeof repeatHireRes?.data === "number"
          ? repeatHireRes.data
          : null,
        // Credential tier 0-3 — 0 when the RPC errored/isn't deployed, which
        // simply withholds the "Licensed Pro" milestone rather than claiming it.
        credentialTier:
          credentialTierRes?.error || typeof credentialTierRes?.data !== "number"
            ? 0
            : credentialTierRes.data,
        // `helper_credentials` is RLS-scoped to the owner, so the amber
        // "Verification in progress" chip could only ever appear on your own
        // profile. Published as a bare boolean — no vendor, no document, no
        // dates, just "something is with a reviewer".
        hasPendingCredentials: publicStats?.has_pending_credentials ?? null,
      };
    },
  });

  /* THE DISPUTE-COUNT QUERY IS GONE (2026-08-31).

     It fetched `job_disputes` filtered on `opened_by = <viewed user>` and
     exposed `hasCleanRecord = count === 0`, which UserProfile rendered as a
     green "No disputes on record" line.

     Two things were wrong with it, either one fatal:

       1. RLS. `job_disputes`'s SELECT policy ("Job parties and admins can view
          job_disputes", 20260612190000_dispute_revision.sql) only returns rows
          for jobs the CALLER was a party to. A visitor can never see a
          stranger's disputes, so the count came back 0 for everyone and the
          affirmative safety claim rendered on every profile in the app,
          truthfully or not.
       2. Semantics. It counted disputes this person OPENED — not disputes
          opened AGAINST them, which is what a reader takes the badge to mean.

     A truthful version needs a SECURITY DEFINER aggregate RPC (the shape
     `helper_repeat_hire_percent` already uses). Until that exists we claim
     nothing rather than claim it wrongly. */

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
  // Server answer first (works for a visitor), own-row count second (the
  // PGRST202 fallback, and the only thing that ever worked before).
  const hasSubmittedCredentials =
    data?.hasPendingCredentials ?? (submittedCredentialsData?.count ?? 0) > 0;

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

      /* Page through the DEFINER function first — same source as page 1, so
         page 2 cannot contain a review page 1 filtered out (the cancelled-job
         exclusion applies to both), and it works for a viewer who cannot read
         `reviews` directly. PGRST202/42501 falls through to the direct select
         below, which is the pre-existing path, untouched. */
      const rpcPage = (await supabase.rpc("get_public_profile_reviews" as any, {
        p_user_id: userId,
        p_limit: 20,
        p_offset: from,
      })) as { data?: unknown; error?: { code?: string } | null };
      if (!rpcPage.error && Array.isArray(rpcPage.data)) {
        const rows = rpcPage.data as PublicProfileReviewRow[];
        if (rows.length === 0) return;
        setLocalReviews((prev) => [
          ...(prev ?? reviewsFromQuery),
          ...rows.map((r) => ({
            id: r.id,
            rating: r.rating,
            punctuality: r.punctuality ?? null,
            quality: r.quality ?? null,
            communication: r.communication ?? null,
            feedback: r.feedback,
            created_at: r.created_at,
            reviewerName: r.reviewer_name ? formatName(r.reviewer_name) : "a neighbor",
            jobTitle: r.job_category ? formatCategory(r.job_category) : "a task",
            jobCategory: r.job_category ?? null,
            response_text: r.response_text ?? null,
            response_at: r.response_at ?? null,
          })),
        ]);
        return;
      }
      if (rpcPage.error && rpcPage.error.code !== "PGRST202" && rpcPage.error.code !== "42501") {
        report(rpcPage.error, {
          severity: "warning",
          tags: { area: "user_profile.load_more_reviews_rpc" },
          context: { viewed_user_id: userId },
        });
      }

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
  /* THE COUNT and THE LIST are different things, and conflating them is what
     made a stranger see "0 jobs completed" on a helper with a dozen. The list
     is a .limit(20) page of rows RLS hides from visitors; the count is a
     server-side aggregate. Render the count, list what you can load. */
  const completedWorkedCount = data?.completedAsHelperCount ?? completedWorkedJobs.length;
  const canReadReviewText = data?.canReadReviewText ?? true;
  const statSamples = data?.statSamples ?? {
    jobs: 0,
    onTime: 0,
    revisions: 0,
    repeatClients: 0,
    posterReviews: 0,
    hasServerStats: false,
  };
  const replyLatency: ReplyLatency =
    data?.replyLatency ?? { medianReplyMinutes: null, replySample: 0, measured: false };
  const cancellationRate = data?.cancellationRate ?? { total: 0, cancelled: 0, rate: null as number | null };
  const mutualJobsCount = data?.mutualJobsCount ?? 0;
  // Deny while the fetch is still in flight: the Message button appearing and
  // then vanishing a beat later is worse than it arriving a beat late, and
  // this gate exists to keep a channel shut.
  const canMessage = data?.canMessage ?? false;
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
    completedWorkedCount,
    canReadReviewText,
    statSamples,
    replyLatency,
    cancellationRate,
    mutualJobsCount,
    canMessage,
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
