import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { formatCategory } from "@/lib/format";
import { shortMonth, DOW_LABELS } from "./analyticsUtils";
import { tierFeePercent, toSubscriptionTier } from "@/lib/subscriptionTiers";
import {
  helperPlatformFeeDollars,
  helperTakeHomeDollars,
  type HelperEarningsJob,
} from "@/lib/helperEarnings";

export async function fetchAnalytics(userId: string) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const iso6m = sixMonthsAgo.toISOString();

  const [profileRes, completedJobsRes, allAppsRes, ratingsRes, benchRes, repeatHireRes, profileViewsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("subscription_tier, subscription_expires_at, full_name")
      .eq("user_id", userId)
      .maybeSingle(),
    // Completed jobs where this user was the helper — last 6 months.
    // Include timing fields for on-time arrival rate.
    supabase
      .from("jobs")
      // The money columns are NOT optional here. `budget` alone cannot answer
      // "what did this helpr earn": a group job's budget is shared by
      // `helpers_needed` people, the commission was frozen per job
      // (`platform_fee_amount` / `helper_fee_percent`), and the urgent bonus
      // passes through on top. Selecting them is what lets
      // helperTakeHomeDollars resolve the real figure — see helperEarnings.ts.
      .select(
        "id, budget, platform_fee_amount, helper_fee_percent, urgent_fee, is_group_job, helpers_needed, category, updated_at, helper_arrived_at, date_needed, start_time",
      )
      .eq("helper_id", userId)
      .eq("status", "completed")
      .gte("updated_at", iso6m),
    // All applications this user ever submitted — for success rate.
    supabase
      .from("applications")
      .select("status")
      .eq("helper_id", userId),
    // All reviews where this user was the reviewee (rated as a helper).
    supabase
      .from("reviews")
      .select("rating, created_at")
      .eq("reviewee_id", userId)
      .order("created_at", { ascending: false }),
    // Platform-wide benchmarks — fallback values used on any failure. The
    // .catch() matters: an optional RPC that *rejects* (transport error, or a
    // Postgres exception inside the function) would otherwise fail the whole
    // Promise.all and brick the page with the error state. Normalizing the
    // rejection into the resolved {error} shape routes it through the existing
    // per-card fallback instead. Wrap in Promise.resolve() first: the supabase
    // query builder is a thenable, not a real Promise, so it has no .catch().
    Promise.resolve((supabase.rpc as any)("get_platform_benchmarks")).catch(() => ({
      data: null,
      error: { code: "PGRST202" },
    })),
    // Repeat hire percent — card hidden on error or < 3 jobs.
    Promise.resolve((supabase.rpc as any)("get_user_repeat_hire_percent", { p_user_id: userId })).catch(() => ({
      data: null,
      error: { code: "PGRST202" },
    })),
    // Profile view count — falls back to 0 if not yet deployed or on failure.
    Promise.resolve((supabase.rpc as any)("get_monthly_profile_view_count", { p_user_id: userId }))
      .catch(() => ({ data: null, error: { code: "PGRST202" } })),
  ]);

  if (profileRes.error) throw profileRes.error;
  // completedJobs is the PRIMARY data source for the /analytics page — a
  // silent fallback-to-empty would misreport "0 completed jobs" on a
  // transient fetch failure. Throw so the page shows its error state.
  if (completedJobsRes.error) throw completedJobsRes.error;
  // Applications feed the success-rate card — same treatment: throw so a
  // dropped fetch doesn't show "0% success rate" that isn't real.
  if (allAppsRes.error) throw allAppsRes.error;

  // EFFECTIVE tier, expiry-aware: an expired paid tier resolves to "free"
  // even before the expire-subscriptions cron nulls the column — the same
  // convention tierFeePercent uses. Consumers (analytics gate, fee
  // fallback) can therefore read `tier` directly without re-checking
  // expiry.
  const rawTier = profileRes.data?.subscription_tier ?? null;
  const tierExpiresAt = profileRes.data?.subscription_expires_at ?? null;
  const tierExpired = tierExpiresAt ? new Date(tierExpiresAt).getTime() < Date.now() : false;
  const tier = toSubscriptionTier(tierExpired ? "free" : (rawTier ?? "").toLowerCase());
  const completedJobs = completedJobsRes.data ?? [];
  const allApps = allAppsRes.data ?? [];
  // Ratings are non-critical — degrade to empty so the rest of the
  // analytics still renders, but observably (never drop the error).
  if (ratingsRes.error) {
    report(ratingsRes.error, { severity: "warning", tags: { source: "fetchAnalytics.ratings" } });
  }
  const allRatings = ratingsRes.error ? [] : (ratingsRes.data ?? []);

  // ── Earnings by month ─────────────────────────────────────────────────────
  // TAKE-HOME, from the one shared definition (helperEarnings.ts) that every
  // other earnings surface uses. This used to add up `job.budget` verbatim,
  // which was wrong three ways at once on the same row: it ignored the roster
  // split on a group job, ignored the fee frozen on the job, and ignored the
  // urgent bonus. A 3-helpr $300 job that transferred ~$88 to this helpr was
  // charted as $300.
  //
  // The fallback percent is the helper's OWN tier rate, expiry-aware, and is
  // consulted only for legacy rows that carry neither a stamped fee nor a
  // frozen percent — exactly as WorkRecord and the Earnings tab do it.
  const feeFallbackPercent = tierFeePercent(
    profileRes.data?.subscription_tier ?? null,
    profileRes.data?.subscription_expires_at ?? null,
  );
  const earningsByMonth: Record<string, number> = {};
  const today = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    earningsByMonth[`${d.getFullYear()}-${d.getMonth()}`] = 0;
  }
  let totalEarnings = 0;
  let platformFee = 0;
  for (const job of completedJobs) {
    const takeHome = helperTakeHomeDollars(job as HelperEarningsJob, feeFallbackPercent);
    const d = new Date(job.updated_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key in earningsByMonth) {
      earningsByMonth[key] += takeHome;
    }
    totalEarnings += takeHome;
    platformFee += helperPlatformFeeDollars(job as HelperEarningsJob, feeFallbackPercent);
  }
  // Cents, not sub-cent floats: the ledger this sits above is cents-exact.
  platformFee = Math.round(platformFee * 100) / 100;

  const earningsMonths = Object.entries(earningsByMonth).map(([key, amount]) => {
    const [year, month] = key.split("-").map(Number);
    return { label: shortMonth(new Date(year, month, 1)), amount };
  });
  const maxEarnings = Math.max(...earningsMonths.map((m) => m.amount), 1);

  // ── Top categories ────────────────────────────────────────────────────────
  const catCounts: Record<string, number> = {};
  for (const job of completedJobs) {
    catCounts[job.category] = (catCounts[job.category] ?? 0) + 1;
  }
  const topCategories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, count]) => ({
      label: formatCategory(cat),
      count,
      pct: completedJobs.length > 0 ? Math.round((count / completedJobs.length) * 100) : 0,
    }));

  // ── Best day of week ──────────────────────────────────────────────────────
  const dowCounts: number[] = Array(7).fill(0);
  for (const job of completedJobs) {
    const dow = new Date(job.updated_at).getDay();
    dowCounts[dow]++;
  }
  const sortedDow = DOW_LABELS.map((label, i) => ({ label, count: dowCounts[i] }))
    .sort((a, b) => b.count - a.count);

  // ── Application success rate ───────────────────────────────────────────────
  const accepted = allApps.filter((a) => a.status === "accepted").length;
  const successRate = allApps.length > 0
    ? Math.round((accepted / allApps.length) * 100)
    : null;
  // Live platform benchmark — falls back to 32 if RPC not yet deployed (PGRST202).
  const benchRow = Array.isArray(benchRes.data) ? benchRes.data[0] : benchRes.data;
  const PLATFORM_AVERAGE_SUCCESS_RATE = benchRes.error || !benchRow
    ? 32
    : (benchRow.avg_application_success_rate ?? 32);

  // ── Platform fee ──────────────────────────────────────────────────────────
  // Summed PER JOB above rather than by applying today's tier rate to a total.
  // Applying one current rate to six months of history restates jobs that were
  // charged a different (frozen) commission — a helpr who upgraded last week
  // would see every older job recomputed at the new rate.
  //
  // `netEarnings` is retained as the take-home total under its old name so the
  // two figures still add up: gross-to-this-helpr = netEarnings + platformFee.
  const netEarnings = totalEarnings;
  const grossEarnings = totalEarnings + platformFee;

  // ── On-time arrival rate ─────────────────────────────────────────────────
  // Requires at least 5 jobs with both helper_arrived_at and date_needed.
  // Grace window: arrived within 10 minutes of scheduled start counts as on-time.
  const timingRows = completedJobs.filter((j: any) => j.helper_arrived_at && j.date_needed);
  let onTimeRate: number | null = null;
  if (timingRows.length >= 5) {
    const onTime = timingRows.filter((j: any) => {
      const arrived = new Date(j.helper_arrived_at).getTime();
      const iso = j.start_time ? `${j.date_needed}T${j.start_time}` : `${j.date_needed}T00:00:00`;
      const scheduled = new Date(iso).getTime();
      return !isNaN(scheduled) && !isNaN(arrived) && arrived - scheduled <= 10 * 60_000;
    }).length;
    onTimeRate = Math.round((onTime / timingRows.length) * 100);
  }

  // ── Repeat hire percent ───────────────────────────────────────────────────
  // Hide the card entirely if the RPC errored (PGRST202 graceful fallback).
  const repeatHirePercent: number | null = repeatHireRes?.error
    ? null
    : (typeof repeatHireRes?.data === "number" ? repeatHireRes.data : null);

  // ── Ratings & reviews ────────────────────────────────────────────────────
  // Per-star buckets 1–5.
  const starBuckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  for (const r of allRatings) {
    const star = Math.min(5, Math.max(1, Math.round(Number(r.rating))));
    starBuckets[star] = (starBuckets[star] ?? 0) + 1;
    ratingSum += star;
  }
  const reviewCount = allRatings.length;
  const avgRating = reviewCount > 0 ? ratingSum / reviewCount : null;
  // Live platform benchmark — falls back to 4.2 if RPC not yet deployed (PGRST202).
  const PLATFORM_AVERAGE_RATING = benchRes.error || !benchRow
    ? 4.2
    : (benchRow.avg_helper_rating ?? 4.2);

  const profileViewCount =
    profileViewsRes.error || profileViewsRes.data === null
      ? 0
      : typeof profileViewsRes.data === "number"
      ? profileViewsRes.data
      : 0;

  return {
    tier,
    totalEarnings,
    platformFee,
    netEarnings,
    grossEarnings,
    completedCount: completedJobs.length,
    earningsMonths,
    maxEarnings,
    topCategories,
    sortedDow,
    successRate,
    totalApplications: allApps.length,
    PLATFORM_AVERAGE_SUCCESS_RATE,
    // Ratings
    avgRating,
    reviewCount,
    starBuckets,
    PLATFORM_AVERAGE_RATING,
    // Trust signals
    onTimeRate,
    timingJobCount: timingRows.length,
    repeatHirePercent,
    profileViewCount,
  };
}

export type Analytics = Awaited<ReturnType<typeof fetchAnalytics>>;
