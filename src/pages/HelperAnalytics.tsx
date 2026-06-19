import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Crown, TrendingUp, Target, Calendar, BarChart2, Star, Clock, RefreshCw, Eye, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCategory } from "@/lib/format";

// Helpers whose subscription tier gives access to analytics.
const ANALYTICS_TIERS = new Set(["pro", "elite", "business"]);

// ── Utilities ────────────────────────────────────────────────────────────────

/** Format a dollar amount: $1,240 */
function fmtDollars(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Month label from a Date: "Jun" */
function shortMonth(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short" });
}

/** Day-of-week label from a number 0-6 (0 = Sunday) */
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Earnings goal (localStorage) ─────────────────────────────────────────────

const GOAL_KEY = "helpr:earnings_goal";

function useEarningsGoal() {
  const [goal, setGoalState] = useState<number | null>(() => {
    const raw = localStorage.getItem(GOAL_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });

  const saveGoal = (value: number | null) => {
    if (value === null || value <= 0) {
      localStorage.removeItem(GOAL_KEY);
      setGoalState(null);
    } else {
      localStorage.setItem(GOAL_KEY, String(value));
      setGoalState(value);
    }
  };

  return { goal, saveGoal };
}

// ── Analytics data query ──────────────────────────────────────────────────────

async function fetchAnalytics(userId: string) {
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
    // Platform-wide benchmarks (PGRST202 silently ignored — fallback values used).
    (supabase.rpc as any)("get_platform_benchmarks"),
    // Repeat hire percent — PGRST202 silently ignored (card hidden on error or < 3 jobs).
    (supabase.rpc as any)("get_user_repeat_hire_percent", { p_user_id: userId }),
    // Profile view count — PGRST202 silently falls back to 0 if not yet deployed.
    (supabase.rpc as any)("get_monthly_profile_view_count", { p_user_id: userId })
      .catch(() => ({ data: null, error: { code: "PGRST202" } })),
  ]);

  if (profileRes.error) throw profileRes.error;

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
  const PLATFORM_FEE_PERCENT = 0.10;
  const platformFee = Math.round(totalEarnings * PLATFORM_FEE_PERCENT);
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

// ── Component ─────────────────────────────────────────────────────────────────

const HelperAnalytics = () => {
  usePageTitle("Earnings & Analytics — Helpr");
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  const { goal, saveGoal } = useEarningsGoal();

  const {
    data: analyticsData,
    isLoading: isLoadingData,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["helperAnalytics", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: () => fetchAnalytics(user!.id),
  });

  const analytics = analyticsData;

  const hasAnalyticsAccess = analytics
    ? ANALYTICS_TIERS.has(analytics.tier)
    : false;

  // Current-month earnings: last entry in earningsMonths (always current month).
  const earningsMonthsArr = analytics?.earningsMonths ?? [];
  const currentMonthEarnings =
    earningsMonthsArr.length > 0
      ? earningsMonthsArr[earningsMonthsArr.length - 1].amount
      : 0;

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow="Helper dashboard"
        title="Earnings & Analytics"
        meta="Your last 6 months"
      />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-lg mx-auto space-y-5">

          {/* A failed fetch leaves `analytics` undefined, which would render
              $0 / 0 jobs everywhere and read as a brand-new helper rather
              than a broken load. Surface a recoverable error instead. */}
          {isError && !isLoadingData ? (
            <ErrorState
              variant="inline"
              title="Couldn't load your analytics."
              body="Your earnings are safe — this is just the dashboard failing to load. Tap Try again."
              onRetry={() => refetch()}
            />
          ) : (
          <>

          {/* ── Hero summary ─────────────────────────────────────────── */}
          <div
            className="rounded-2xl liquid-glass p-5 relative overflow-hidden"
            style={{
              backgroundImage:
                "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
                "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
            }}
          >
            {isLoadingData ? (
              <div className="space-y-2">
                <Skeleton className="h-7 w-36 rounded" />
                <Skeleton className="h-4 w-48 rounded" />
              </div>
            ) : (
              <>
                <p
                  className="font-display italic font-bold"
                  style={{ fontSize: "1.8rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
                >
                  {analytics ? fmtDollars(analytics.totalEarnings) : "$0"}
                  <span className="text-ds-14 font-normal ml-2 text-muted-foreground">gross earned</span>
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-ds-13">
                  <span style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                    <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                      {analytics?.completedCount ?? 0}
                    </span>{" "}
                    jobs completed
                  </span>
                  {analytics && analytics.netEarnings > 0 && (
                    <span style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                      <span className="font-semibold" style={{ color: "hsl(var(--bark))" }}>
                        {fmtDollars(analytics.netEarnings)}
                      </span>{" "}
                      after Helpr fee
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Monthly earnings goal ─────────────────────────────────── */}
          <MonthlyGoalCard
            goal={goal}
            onSaveGoal={saveGoal}
            currentMonthEarnings={currentMonthEarnings}
            isLoading={isLoadingData}
          />

          {/* ── Analytics cards (gated for free tier) ─────────────────── */}
          {/* We still render the cards so free-tier users can see what
              they're missing — but a blur overlay + upgrade CTA covers
              the content when access is denied. */}

          {/* Earnings by month bar chart */}
          <SectionCard
            title="Earnings by month"
            icon={<TrendingUp className="w-4 h-4" />}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={() => navigate("/profile?tab=subscription")}
          >
            {analytics && (
              <div className="flex items-end gap-2 h-28">
                {analytics.earningsMonths.map((m) => {
                  const heightPct = analytics.maxEarnings > 0
                    ? Math.max(4, Math.round((m.amount / analytics.maxEarnings) * 100))
                    : 4;
                  return (
                    <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-ds-10 font-semibold" style={{ color: "hsl(var(--bark))" }}>
                        {m.amount > 0 ? `$${Math.round(m.amount)}` : ""}
                      </span>
                      <div
                        className="w-full rounded-t-sm transition-all duration-500"
                        style={{
                          height: `${heightPct}%`,
                          minHeight: "4px",
                          background: m.amount > 0
                            ? "hsl(var(--burnt-sienna) / 0.80)"
                            : "hsl(var(--olivewood) / 0.15)",
                        }}
                      />
                      <span className="text-ds-10 text-muted-foreground">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Top categories */}
          <SectionCard
            title="Your best categories"
            icon={<BarChart2 className="w-4 h-4" />}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={() => navigate("/profile?tab=subscription")}
          >
            {analytics && (
              <div className="space-y-2.5">
                {analytics.topCategories.length > 0 ? (
                  analytics.topCategories.map((cat) => (
                    <div key={cat.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-ds-12 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                          {cat.label}
                        </span>
                        <span className="text-ds-12 font-bold tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>
                          {cat.pct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${cat.pct}%`,
                            background: "hsl(var(--burnt-sienna) / 0.70)",
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-ds-12 text-muted-foreground text-center py-2">
                    Complete jobs to see your top categories.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {/* Profile views */}
          <SectionCard
            title="Profile views"
            icon={<Eye className="w-4 h-4" />}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={() => navigate("/profile?tab=subscription")}
          >
            {analytics && (
              <div className="text-center py-2 space-y-1">
                <p
                  className="font-display italic font-bold"
                  style={{ fontSize: "2.2rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
                >
                  {analytics.profileViewCount}
                </p>
                <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                  profile views in the last 30 days
                </p>
                {analytics.profileViewCount === 0 && (
                  <p className="text-ds-11 text-muted-foreground">
                    Views are counted once per visitor per hour.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {/* Application success rate */}
          <SectionCard
            title="Application success rate"
            icon={<Target className="w-4 h-4" />}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={() => navigate("/profile?tab=subscription")}
          >
            {analytics && (
              <div className="text-center py-2 space-y-1">
                {analytics.successRate !== null ? (
                  <>
                    <p
                      className="font-display italic font-bold"
                      style={{ fontSize: "2.2rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
                    >
                      {analytics.successRate}%
                    </p>
                    <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                      of your applications lead to a hire
                    </p>
                    <p
                      className="text-ds-11 font-medium"
                      style={{
                        color: analytics.successRate >= analytics.PLATFORM_AVERAGE_SUCCESS_RATE
                          ? "hsl(var(--bark))"
                          : "hsl(var(--olivewood) / 0.6)",
                      }}
                    >
                      {analytics.successRate >= analytics.PLATFORM_AVERAGE_SUCCESS_RATE
                        ? `Above the Helpr average of ${analytics.PLATFORM_AVERAGE_SUCCESS_RATE}%`
                        : `Helpr average is ${analytics.PLATFORM_AVERAGE_SUCCESS_RATE}%`}
                    </p>
                    <p className="text-ds-11 text-muted-foreground">
                      Based on {analytics.totalApplications} application{analytics.totalApplications !== 1 ? "s" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-ds-12 text-muted-foreground py-2">
                    Apply to jobs to see your hire rate.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {/* On-time arrival rate — only shown when >= 5 jobs have check-in data */}
          {analytics?.onTimeRate !== null && analytics?.onTimeRate !== undefined && (
            <SectionCard
              title="On-time arrival"
              icon={<Clock className="w-4 h-4" />}
              hasAccess={hasAnalyticsAccess}
              isLoading={isLoadingData}
              onUpgrade={() => navigate("/profile?tab=subscription")}
            >
              {analytics && (
                <div className="text-center py-2 space-y-1">
                  <p
                    className="font-display italic font-bold"
                    style={{ fontSize: "2.2rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
                  >
                    {analytics.onTimeRate}%
                  </p>
                  <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                    of jobs you arrived on time or early
                  </p>
                  <p className="text-ds-11 text-muted-foreground">
                    Based on {analytics.timingJobCount} job{analytics.timingJobCount !== 1 ? "s" : ""} with check-in data
                  </p>
                </div>
              )}
            </SectionCard>
          )}

          {/* Repeat hire rate — only shown when RPC returns a value (>= 3 completed jobs) */}
          {analytics?.repeatHirePercent !== null && analytics?.repeatHirePercent !== undefined && (
            <SectionCard
              title="Repeat hire rate"
              icon={<RefreshCw className="w-4 h-4" />}
              hasAccess={hasAnalyticsAccess}
              isLoading={isLoadingData}
              onUpgrade={() => navigate("/profile?tab=subscription")}
            >
              {analytics && (
                <div className="text-center py-2 space-y-1">
                  <p
                    className="font-display italic font-bold"
                    style={{ fontSize: "2.2rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
                  >
                    {analytics.repeatHirePercent}%
                  </p>
                  <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                    of clients hired you more than once
                  </p>
                  {analytics.repeatHirePercent >= 30 && (
                    <p className="text-ds-11 font-medium" style={{ color: "hsl(var(--bark))" }}>
                      Clients keep coming back — great sign
                    </p>
                  )}
                </div>
              )}
            </SectionCard>
          )}

          {/* Best days of week */}
          <SectionCard
            title="Best days to work"
            icon={<Calendar className="w-4 h-4" />}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={() => navigate("/profile?tab=subscription")}
          >
            {analytics && (
              <div>
                {analytics.sortedDow[0].count > 0 ? (
                  <>
                    <p className="text-ds-13 font-semibold mb-3" style={{ color: "hsl(var(--ink-deep))" }}>
                      You close most jobs on{" "}
                      <span style={{ color: "hsl(var(--burnt-sienna))" }}>
                        {analytics.sortedDow[0].label}
                      </span>
                      {analytics.sortedDow[1].count > 0 && (
                        <>
                          {" > "}
                          <span style={{ color: "hsl(var(--bark))" }}>{analytics.sortedDow[1].label}</span>
                        </>
                      )}
                      {analytics.sortedDow[2].count > 0 && (
                        <>
                          {" > "}
                          <span className="text-muted-foreground">{analytics.sortedDow[2].label}</span>
                        </>
                      )}
                    </p>
                    <div className="flex items-end gap-1.5 h-16">
                      {DOW_LABELS.map((day) => {
                        const count = analytics.sortedDow.find((d) => d.label === day)?.count ?? 0;
                        const maxCount = Math.max(...analytics.sortedDow.map((d) => d.count), 1);
                        const heightPct = Math.max(6, Math.round((count / maxCount) * 100));
                        return (
                          <div key={day} className="flex-1 flex flex-col items-center gap-1">
                            <div
                              className="w-full rounded-t-sm"
                              style={{
                                height: `${heightPct}%`,
                                minHeight: "4px",
                                background: count > 0
                                  ? "hsl(var(--bark) / 0.70)"
                                  : "hsl(var(--olivewood) / 0.12)",
                              }}
                            />
                            <span className="text-[9px] text-muted-foreground">{day.slice(0, 2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-ds-12 text-muted-foreground text-center py-2">
                    Complete jobs to see your best working days.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {/* Ratings & reviews */}
          <SectionCard
            title="Ratings & reviews"
            icon={<Star className="w-4 h-4" />}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={() => navigate("/profile?tab=subscription")}
          >
            {analytics && (
              <div className="py-1">
                {analytics.reviewCount > 0 ? (
                  <>
                    {/* Average rating headline */}
                    <div className="flex items-end gap-3 mb-4">
                      <p
                        className="font-display italic font-bold leading-none"
                        style={{ fontSize: "2.8rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
                      >
                        {analytics.avgRating!.toFixed(1)}
                      </p>
                      <div className="pb-1">
                        {/* Star row */}
                        <div className="flex gap-0.5 mb-0.5">
                          {[1, 2, 3, 4, 5].map((s) => {
                            const filled = analytics.avgRating! >= s;
                            const half = !filled && analytics.avgRating! >= s - 0.5;
                            return (
                              <Star
                                key={s}
                                className="w-3.5 h-3.5"
                                style={{
                                  color: filled || half
                                    ? "hsl(var(--burnt-sienna))"
                                    : "hsl(var(--olivewood) / 0.25)",
                                  fill: filled ? "hsl(var(--burnt-sienna))" : "none",
                                }}
                              />
                            );
                          })}
                        </div>
                        <p className="text-ds-11 text-muted-foreground">
                          {analytics.reviewCount} review{analytics.reviewCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {/* Per-star breakdown bars */}
                    <div className="space-y-1.5 mb-3">
                      {[5, 4, 3, 2, 1].map((star) => {
                        const count = analytics.starBuckets[star] ?? 0;
                        const pct = analytics.reviewCount > 0
                          ? Math.round((count / analytics.reviewCount) * 100)
                          : 0;
                        return (
                          <div key={star} className="flex items-center gap-2">
                            <span
                              className="text-ds-11 font-semibold tabular-nums w-4 text-right"
                              style={{ color: "hsl(var(--ink-deep))" }}
                            >
                              {star}
                            </span>
                            <Star
                              className="w-3 h-3 flex-shrink-0"
                              style={{
                                color: "hsl(var(--burnt-sienna) / 0.6)",
                                fill: "hsl(var(--burnt-sienna) / 0.6)",
                              }}
                            />
                            <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${pct}%`,
                                  background: star >= 4
                                    ? "hsl(var(--burnt-sienna) / 0.75)"
                                    : star === 3
                                    ? "hsl(var(--bark) / 0.55)"
                                    : "hsl(var(--olivewood) / 0.45)",
                                }}
                              />
                            </div>
                            <span
                              className="text-ds-11 tabular-nums w-5 text-left"
                              style={{ color: "hsl(var(--olivewood) / 0.65)" }}
                            >
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Benchmark comparison */}
                    <p
                      className="text-ds-11 font-medium text-center"
                      style={{
                        color:
                          analytics.avgRating! >= analytics.PLATFORM_AVERAGE_RATING
                            ? "hsl(var(--bark))"
                            : "hsl(var(--olivewood) / 0.6)",
                      }}
                    >
                      {analytics.avgRating! >= analytics.PLATFORM_AVERAGE_RATING
                        ? `Above the Helpr average of ${analytics.PLATFORM_AVERAGE_RATING}`
                        : `Helpr average is ${analytics.PLATFORM_AVERAGE_RATING}`}
                    </p>
                  </>
                ) : (
                  <p className="text-ds-12 text-muted-foreground text-center py-2">
                    Complete jobs to earn your first review.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          </>
          )}
        </div>
      </main>
    </div>
  );
};

// ── MonthlyGoalCard ───────────────────────────────────────────────────────────

interface MonthlyGoalCardProps {
  goal: number | null;
  onSaveGoal: (value: number | null) => void;
  currentMonthEarnings: number;
  isLoading: boolean;
}

const MonthlyGoalCard = ({
  goal,
  onSaveGoal,
  currentMonthEarnings,
  isLoading,
}: MonthlyGoalCardProps) => {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input whenever editing becomes true.
  useEffect(() => {
    if (editing) {
      setInputValue(goal !== null ? String(goal) : "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editing, goal]);

  const pct = goal && goal > 0
    ? Math.min(100, Math.round((currentMonthEarnings / goal) * 100))
    : 0;
  const goalMet = goal !== null && pct >= 100;

  function handleSave() {
    const n = Number(inputValue.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) {
      onSaveGoal(Math.round(n));
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setEditing(false);
  }

  function handleClearGoal() {
    onSaveGoal(null);
    setEditing(false);
  }

  return (
    <div
      className="rounded-2xl liquid-glass p-5 relative overflow-hidden"
      style={{
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.4), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
      }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span style={{ color: "hsl(var(--burnt-sienna))" }}>
            <Flame className="w-4 h-4" />
          </span>
          <h2
            className="font-serif italic uppercase text-ds-9"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Monthly goal
          </h2>
        </div>
        {goal !== null && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-ds-11 font-medium underline underline-offset-2"
            style={{ color: "hsl(var(--olivewood) / 0.6)" }}
          >
            Edit
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-2 w-full rounded-full mt-3" />
        </div>
      ) : editing ? (
        /* ── Inline goal editor ─────────────────────────────────── */
        <div className="space-y-3">
          <label
            htmlFor="earnings-goal-input"
            className="text-ds-12 font-medium"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Set your monthly earnings target
          </label>
          <div className="flex items-center gap-2">
            <span className="text-ds-16 font-semibold" style={{ color: "hsl(var(--olivewood) / 0.5)" }}>
              $
            </span>
            <input
              id="earnings-goal-input"
              ref={inputRef}
              type="number"
              min="1"
              step="1"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. 1000"
              className="flex-1 rounded-xl px-3 py-2 text-ds-16 font-semibold outline-none border"
              style={{
                background: "hsl(var(--parchment) / 0.5)",
                borderColor: "hsl(var(--olivewood) / 0.20)",
                color: "hsl(var(--ink-deep))",
              }}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded-xl py-2 text-ds-13 font-semibold"
              style={{
                background: "hsl(var(--burnt-sienna))",
                color: "hsl(var(--parchment))",
              }}
            >
              Save goal
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 rounded-xl py-2 text-ds-13 font-semibold"
              style={{
                background: "hsl(var(--olivewood) / 0.10)",
                color: "hsl(var(--olivewood) / 0.75)",
              }}
            >
              Cancel
            </button>
          </div>
          {goal !== null && (
            <button
              type="button"
              onClick={handleClearGoal}
              className="text-ds-11 underline underline-offset-2 w-full text-center pt-1"
              style={{ color: "hsl(var(--olivewood) / 0.45)" }}
            >
              Remove goal
            </button>
          )}
        </div>
      ) : goal === null ? (
        /* ── No goal set — subtle prompt ───────────────────────── */
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full text-left"
        >
          <p
            className="font-serif italic text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.55)" }}
          >
            Set a monthly earnings goal{" "}
            <span style={{ color: "hsl(var(--burnt-sienna) / 0.80)" }}>→</span>
          </p>
        </button>
      ) : goalMet ? (
        /* ── Goal met! ──────────────────────────────────────────── */
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p
              className="font-display italic font-bold"
              style={{ fontSize: "1.4rem", color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
            >
              Goal reached!
            </p>
            <span style={{ fontSize: "1.2rem" }}>🎉</span>
          </div>
          <p className="text-ds-12 font-medium" style={{ color: "hsl(var(--bark) / 0.80)" }}>
            You've earned{" "}
            <span className="font-bold">{fmtDollars(currentMonthEarnings)}</span>{" "}
            this month — {pct > 100 ? `${pct - 100}% beyond` : "hitting"} your{" "}
            {fmtDollars(goal)} target. Incredible work!
          </p>
          {/* A thin fully-filled bar for context */}
          <div
            className="h-2 rounded-full mt-1"
            style={{ background: "hsl(var(--bark) / 0.45)" }}
          />
        </div>
      ) : (
        /* ── Progress bar ───────────────────────────────────────── */
        <div className="space-y-2">
          <div className="flex items-end justify-between">
            <p
              className="font-display italic font-bold"
              style={{ fontSize: "1.4rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
            >
              {fmtDollars(currentMonthEarnings)}
            </p>
            <p className="text-ds-12 font-medium tabular-nums" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
              of {fmtDollars(goal)} goal
            </p>
          </div>
          {/* Progress bar */}
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background:
                  pct >= 75
                    ? "hsl(var(--bark) / 0.70)"
                    : "hsl(var(--burnt-sienna) / 0.65)",
              }}
            />
          </div>
          <p className="text-ds-11 font-medium" style={{ color: "hsl(var(--olivewood) / 0.60)" }}>
            {pct}% of {fmtDollars(goal)} goal this month
          </p>
        </div>
      )}
    </div>
  );
};

// ── SectionCard helper ────────────────────────────────────────────────────────

interface SectionCardProps {
  title: string;
  icon: React.ReactNode;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
  children: React.ReactNode;
}

const SectionCard = ({
  title,
  icon,
  hasAccess,
  isLoading,
  onUpgrade,
  children,
}: SectionCardProps) => {
  return (
    <div
      className="rounded-2xl liquid-glass p-5 relative overflow-hidden"
      style={{
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.4), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span style={{ color: "hsl(var(--burnt-sienna))" }}>{icon}</span>
        <h2
          className="font-serif italic uppercase text-ds-9"
          style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
        >
          {title}
        </h2>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-4 w-1/2 rounded" />
        </div>
      ) : (
        children
      )}

      {/* Upgrade gate — blurs the content when the user is on free tier */}
      {!hasAccess && !isLoading && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            background: "hsla(var(--parchment) / 0.85)",
            backdropFilter: "blur(8px)",
            borderRadius: "inherit",
          }}
        >
          <Crown className="w-6 h-6 mb-2" style={{ color: "hsl(var(--bark))" }} />
          <p
            className="font-display italic font-bold text-ds-16 text-center"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Pro feature
          </p>
          <p
            className="font-serif italic text-ds-12 mb-3 text-center max-w-[200px] mt-1"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            Upgrade to Helper Pro to unlock earnings insights
          </p>
          <button
            type="button"
            onClick={onUpgrade}
            className="font-sans font-semibold text-ds-13 underline underline-offset-2"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Upgrade →
          </button>
        </div>
      )}
    </div>
  );
};

export default HelperAnalytics;
