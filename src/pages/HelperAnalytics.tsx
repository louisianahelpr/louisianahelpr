import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Crown, TrendingUp, Target, Calendar, BarChart2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";

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

// ── Analytics data query ──────────────────────────────────────────────────────

async function fetchAnalytics(userId: string) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const iso6m = sixMonthsAgo.toISOString();

  const [profileRes, completedJobsRes, allAppsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("subscription_tier, full_name")
      .eq("user_id", userId)
      .maybeSingle(),
    // Completed jobs where this user was the helper — last 6 months.
    supabase
      .from("jobs")
      .select("id, budget, category, updated_at")
      .eq("helper_id", userId)
      .eq("status", "completed")
      .gte("updated_at", iso6m),
    // All applications this user ever submitted — for success rate.
    supabase
      .from("applications")
      .select("status")
      .eq("helper_id", userId),
  ]);

  if (profileRes.error) throw profileRes.error;

  const tier = (profileRes.data?.subscription_tier ?? "free") as string;
  const completedJobs = completedJobsRes.data ?? [];
  const allApps = allAppsRes.data ?? [];

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
      label: cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
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
  // Industry benchmark — fixed for now, future: fetch from platform_settings.
  const PLATFORM_AVERAGE_SUCCESS_RATE = 32;

  // ── Platform fee estimate ─────────────────────────────────────────────────
  const PLATFORM_FEE_PERCENT = 0.10;
  const platformFee = Math.round(totalEarnings * PLATFORM_FEE_PERCENT);
  const netEarnings = totalEarnings - platformFee;

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
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

const HelperAnalytics = () => {
  usePageTitle("Earnings & Analytics — Helpr");
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  const { data: analyticsData, isLoading: isLoadingData } = useQuery({
    queryKey: ["helperAnalytics", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: () => fetchAnalytics(user!.id),
  });

  const analytics = analyticsData;

  const hasAnalyticsAccess = analytics
    ? ANALYTICS_TIERS.has(analytics.tier)
    : false;

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow="Helper dashboard"
        title="Earnings & Analytics"
        meta="Your last 6 months"
      />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-lg mx-auto space-y-5">

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
                <div className="h-7 w-36 bg-muted animate-pulse rounded" />
                <div className="h-4 w-48 bg-muted animate-pulse rounded" />
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

          {/* Profile views placeholder */}
          <SectionCard
            title="Profile views"
            icon={<Star className="w-4 h-4" />}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={() => navigate("/profile?tab=subscription")}
          >
            <div className="text-center py-2">
              <p
                className="font-display italic font-bold"
                style={{ fontSize: "2.2rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
              >
                0
              </p>
              <p className="font-serif italic text-ds-12 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
                profile views this month
              </p>
              <p className="text-ds-10 text-muted-foreground mt-1">
                View tracking coming soon
              </p>
            </div>
          </SectionCard>

        </div>
      </main>
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
          <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
          <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
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
