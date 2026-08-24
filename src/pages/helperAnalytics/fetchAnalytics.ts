import { supabase } from "@/integrations/supabase/client";
import { formatCategory } from "@/lib/format";
import { shortMonth, DOW_LABELS } from "./analyticsUtils";
import { TIER_PERKS, type SubscriptionTier } from "@/lib/subscriptionTiers";

export async function fetchAnalytics(userId: string) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const iso6m = sixMonthsAgo.toISOString();

  const [profileRes, completedJobsRes, allAppsRes, ratingsRes, benchRes, repeatHireRes, profileViewsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("subscription_tier, full_name")
      .eq("user_id", userId)
      .maybeSingle(),
    // Completed jobs where this user was the helper — last 6 months.
    // Include timing fields for on-time arrival rate.
    supabase
      .from("jobs")
      .select("id, budget, category, updated_at, helper_arrived_at, date_needed, start_time")
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

  const tier = (profileRes.data?.subscription_tier ?? "free") as string;
  const completedJobs = completedJobsRes.data ?? [];
  const allApps = allAppsRes.data ?? [];
  // Surface any ratings fetch error; fall back to empty array on error so the
  // rest of the analytics still renders (non-critical).
  const allRatings = ratingsRes.error ? [] : (ratingsRes.data ?? []);

  // ── Earnings by month ─────────────────────────────────────────────────────
  const earningsByMonth: Record<string, number> = {};
  const today = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    earningsByMonth[`${d.getFullYear()}-${d.getMonth()}`] = 0;
  }
  let totalEarnings = 0;
  for (const job of completedJobs) {
    const d = new Date(job.updated_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key in earningsByMonth) {
      earningsByMonth[key] += job.budget ?? 0;
    }
    totalEarnings += job.budget ?? 0;
  }

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

  // ── Platform fee estimate ─────────────────────────────────────────────────
  // Derived from the helper's actual subscription tier (fetched above at line
  // 58) so a Free helper sees 12%, Pro 10%, Elite 8%, Business 6%. Previously
  // hardcoded to 0.10 → Free helpers saw net earnings computed under Pro's
  // fee. TIER_PERKS is the single source of truth for the fee ladder.
  const tierKey = tier as SubscriptionTier;
  const platformFeePercent =
    (TIER_PERKS[tierKey] ?? TIER_PERKS.free).platformFeePercent / 100;
  // CENTS, not whole dollars. `Math.round(gross * pct)` rounded the FEE to the
  // nearest dollar, so on a single $260 job the 12% fee became $31 instead of
  // $31.20 and net came out $229 — while the payout ledger on the same screen,
  // reading the real Stripe transfer, said $228.80. Not a formatting
  // difference: the two surfaces were computing different money. Rounding to
  // cents makes the estimate agree with the ledger it sits above.
  const platformFee = Math.round(totalEarnings * platformFeePercent * 100) / 100;
  const netEarnings = totalEarnings - platformFee;

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
