import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle,
  Star,
  Share2,
  Printer,
  Briefcase,
  Calendar,
  DollarSign,
  Award,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuthReady } from "@/hooks/useAuthReady";
import { unwrap } from "@/lib/supabaseResult";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { categoryLabels } from "@/components/activity/activityConstants";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { JobCardSkeleton } from "@/components/SkeletonLoaders";
import { ErrorState } from "@/components/ui/ErrorState";
import { shareNative } from "@/lib/nativeShare";
import HelprMark from "@/components/HelprMark";
import type { Database } from "@/integrations/supabase/types";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { helperTakeHomeDollars, sumHelperTakeHomeDollars } from "@/lib/helperEarnings";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface WorkRecordData {
  profile: {
    full_name: string | null;
    approval_status: string;
    idv_status: string | null;
    created_at: string;
  };
  completedJobs: Job[];
  /**
   * LAST-RESORT fee % for legacy rows that carry neither a stamped
   * `platform_fee_amount` nor a frozen `helper_fee_percent`. Derived from the
   * helper's subscription tier at fetch time. Never applied to a job that
   * recorded its own fee — see `helperEarnings.ts`.
   */
  feeFallbackPercent: number;
  totalEarnings: number;
  avgRating: number | null;
  reviewCount: number;
  topCategories: string[];
  dateRange: { first: string; last: string } | null;
}

function formatMonthYear(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const WorkRecord = () => {
  usePageTitle("Work Record — Helpr");
  const navigate = useNavigate();
  const { user } = useAuthReady();
  const userId = user?.id;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["work-record", userId],
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async (): Promise<WorkRecordData> => {
      if (!userId) throw new Error("Not authenticated");

      // Fetch profile + the helper's subscription tier. The tier rate is ONLY
      // the fallback for legacy rows with no recorded fee — expiry is read too
      // so a lapsed paid tier reverts to the free rate, exactly as
      // /wrapped and /profile resolve it.
      const profileRes = await supabase
        .from("profiles")
        .select("full_name, approval_status, idv_status, created_at, subscription_tier, subscription_expires_at")
        .eq("user_id", userId)
        .single();
      const profileRow = unwrap(profileRes) as {
        full_name: string | null;
        approval_status: string;
        idv_status: string | null;
        created_at: string;
        subscription_tier: string | null;
        subscription_expires_at: string | null;
      };
      const profile = {
        full_name: profileRow.full_name,
        approval_status: profileRow.approval_status,
        idv_status: profileRow.idv_status,
        created_at: profileRow.created_at,
      };
      const feeFallbackPercent = tierFeePercent(
        profileRow.subscription_tier,
        profileRow.subscription_expires_at,
      );

      // Fetch completed jobs where this user was the helper
      const jobsRes = await supabase
        .from("jobs")
        .select("*")
        .eq("helper_id", userId)
        .eq("status", "completed")
        .order("created_at", { ascending: false });
      const completedJobs = unwrap(jobsRes) as Job[];

      // Fetch reviews received as helper
      const reviewsRes = await supabase
        .from("reviews")
        .select("rating")
        .eq("reviewee_id", userId);
      const reviews = unwrap(reviewsRes) as { rating: number }[];

      const reviewCount = reviews.length;
      const avgRating =
        reviewCount > 0
          ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10
          : null;

      // Total earnings, resolved PER JOB by the shared helper: the fee stamped
      // at payout wins, then the % frozen on the row, then (legacy rows only)
      // the tier rate — plus the net urgent bonus the helper was actually
      // paid. This is an official employment/earnings document, so it must
      // report what each job really paid, not today's tier applied backwards.
      const totalEarnings = sumHelperTakeHomeDollars(completedJobs, feeFallbackPercent);

      // Top categories by frequency
      const catCounts = new Map<string, number>();
      for (const j of completedJobs) {
        const cat = j.category ?? "other";
        catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
      }
      const topCategories = Array.from(catCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([cat]) => cat);

      // Date range
      let dateRange: { first: string; last: string } | null = null;
      if (completedJobs.length > 0) {
        const sorted = [...completedJobs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        dateRange = {
          first: sorted[0].created_at,
          last: sorted[sorted.length - 1].created_at,
        };
      }

      return {
        profile,
        completedJobs,
        feeFallbackPercent,
        totalEarnings,
        avgRating,
        reviewCount,
        topCategories,
        dateRange,
      };
    },
  });

  const recentJobs = useMemo(() => (data?.completedJobs ?? []).slice(0, 10), [data]);
  const loading = isLoading && !data;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // There is NO public work-record route or share token: /work-record is
  // ProtectedRoute-wrapped and always renders the VIEWER's own record, so the
  // old `${origin}/work-record` link sent the recipient to their own record —
  // or a login wall — never the sharer's. Rather than invent a token/route,
  // share the record's verifiable claims as self-contained text plus the same
  // verification address the document footer prints, and point the link at the
  // Helpr homepage (a page that really does exist and really is about Helpr).
  //
  // The dollar figure is deliberately NOT in the share text: a share sheet can
  // land anywhere, and the original text disclosed only a job count. Anyone who
  // needs income verification uses Print (→ Save as PDF), which carries the
  // full document.
  async function handleShare() {
    if (!data) return;
    const jobs = data.completedJobs.length;
    const period = data.dateRange
      ? ` (${formatMonthYear(data.dateRange.first)} – ${formatMonthYear(data.dateRange.last)})`
      : "";
    const lines = [
      `Helpr Work Record — ${data.profile.full_name ?? "Helpr Member"}`,
      `${jobs} job${jobs === 1 ? "" : "s"} completed on Helpr${period}`,
      data.avgRating !== null
        ? `${data.avgRating.toFixed(1)}★ average across ${data.reviewCount} review${data.reviewCount === 1 ? "" : "s"}`
        : null,
      data.profile.idv_status === "verified" ? "ID verified by Helpr" : null,
      "Verify this record: admin@louisianahelpr.com",
    ].filter((l): l is string => !!l);

    await shareNative({
      title: "My Helpr Work Record",
      text: lines.join("\n"),
      url: window.location.origin,
      dialogTitle: "Share my Helpr Work Record",
    });
  }

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        title="Work Record"
        eyebrow="Employment & Earnings"
        onBack={() => navigate("/profile")}
        showBrand
        rightSlot={<NotificationPanel />}
        // Mirrors the body container below (max-w-5xl, px-4 → lg:px-8 → xl:px-12).
        width="5xl-p4"
      />

      <div className="mx-auto max-w-5xl px-4 lg:px-8 xl:px-12 pb-10 space-y-5 mt-2">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <JobCardSkeleton key={i} />)}
          </div>
        )}

        {isError && !loading && (
          <ErrorState
            title="Couldn't load your work record"
            body="Check your connection and try again."
            onRetry={() => refetch()}
          />
        )}

        {!loading && !isError && data && (
          <>
            {/* Official Document Card */}
            <div
              className="rounded-ds-lg overflow-hidden print:shadow-none"
              style={{
                background: "hsl(var(--parchment) / 0.90)",
                border: "1px solid hsl(var(--olivewood) / 0.15)",
                boxShadow:
                  "inset 0 1px 1px rgba(255,255,255,0.6), " +
                  "0 2px 8px hsl(var(--olivewood) / 0.06), " +
                  "0 10px 28px -8px hsl(var(--olivewood) / 0.10)",
              }}
            >
              {/* Document header */}
              <div
                className="px-5 pt-5 pb-4"
                style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.10)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <HelprMark size="md" />
                    <h2
                      className="font-display italic font-bold mt-3 text-ds-20 leading-tight"
                      style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
                    >
                      Employment &amp; Earnings Record
                    </h2>
                    <p className="font-serif italic text-ds-12 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                      Generated {today}
                    </p>
                  </div>
                  <div
                    className="shrink-0 w-14 h-14 rounded-ds-lg flex items-center justify-center"
                    style={{ background: "hsl(var(--bark) / 0.10)" }}
                  >
                    <Award className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} />
                  </div>
                </div>
              </div>

              {/* Identity section */}
              <div
                className="px-5 py-4 space-y-2"
                style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.10)" }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      Issued to
                    </p>
                    <p className="text-ds-14 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                      {data.profile.full_name ?? "Helpr Member"}
                    </p>
                  </div>
                  <div>
                    <p className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      ID Verified
                    </p>
                    <p className="text-ds-13 font-semibold inline-flex items-center gap-1">
                      {data.profile.idv_status === "verified" ? (
                        <>
                          <CheckCircle className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
                          <span style={{ color: "hsl(var(--bark))" }}>Verified</span>
                        </>
                      ) : (
                        <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>Pending</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      Member since
                    </p>
                    <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
                      {formatMonthYear(data.profile.created_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      Platform
                    </p>
                    <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
                      Helpr (Louisiana)
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary stats */}
              <div
                className="px-5 py-4"
                style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.10)" }}
              >
                <p
                  className="font-serif italic uppercase text-ds-9 mb-3"
                  style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
                >
                  Work Summary
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {/* Jobs completed */}
                  <StatBlock
                    icon={<Briefcase className="w-4 h-4" />}
                    label="Jobs Completed"
                    value={String(data.completedJobs.length)}
                  />
                  {/* Total earnings */}
                  <StatBlock
                    icon={<DollarSign className="w-4 h-4" />}
                    label="Total Earnings"
                    value={formatCurrency(data.totalEarnings)}
                    sub="after platform fee"
                  />
                  {/* Date range */}
                  <StatBlock
                    icon={<Calendar className="w-4 h-4" />}
                    label="Active Period"
                    value={
                      data.dateRange
                        ? `${formatMonthYear(data.dateRange.first)} – ${formatMonthYear(data.dateRange.last)}`
                        : "—"
                    }
                  />
                  {/* Rating */}
                  <StatBlock
                    icon={<Star className="w-4 h-4" />}
                    label="Avg Rating"
                    value={
                      data.avgRating !== null
                        ? `${data.avgRating.toFixed(1)} ★ (${data.reviewCount})`
                        : "No reviews yet"
                    }
                  />
                </div>

                {/* Top categories */}
                {data.topCategories.length > 0 && (
                  <div className="mt-4">
                    <p className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Top Categories
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.topCategories.map((cat) => {
                        const Icon = getCategoryIcon(cat);
                        const label = categoryLabels[cat] ?? "Other";
                        return (
                          <span
                            key={cat}
                            className="inline-flex items-center gap-1 text-ds-11 font-medium px-2.5 py-1 rounded-full"
                            style={{
                              background: "hsl(var(--bark) / 0.10)",
                              color: "hsl(var(--bark))",
                              border: "1px solid hsl(var(--bark) / 0.15)",
                            }}
                          >
                            <Icon className="w-3 h-3" />
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Recent job history table */}
              {recentJobs.length > 0 && (
                <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.10)" }}>
                  <p
                    className="font-serif italic uppercase text-ds-9 mb-3"
                    style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
                  >
                    Recent Jobs
                  </p>
                  <div className="space-y-2">
                    {/* Table header */}
                    <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-1">
                      <span className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground">Job</span>
                      <span className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground text-right">Earned</span>
                      <span className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground text-right">Date</span>
                    </div>
                    {recentJobs.map((job, idx) => {
                      // Same per-job resolution as the Total Earnings figure
                      // above, so a row can never disagree with the summary.
                      const earned = helperTakeHomeDollars(job, data.feeFallbackPercent);
                      const label = categoryLabels[job.category ?? "other"] ?? "Other";
                      return (
                        <div
                          key={job.id}
                          className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2.5 rounded-ds-md"
                          style={{
                            background: idx % 2 === 0 ? "hsl(var(--parchment) / 0.5)" : "transparent",
                          }}
                        >
                          <div className="min-w-0">
                            <p className="text-ds-12 font-semibold truncate" style={{ color: "hsl(var(--ink-deep))" }}>
                              {job.title}
                            </p>
                            <p className="text-ds-10 text-muted-foreground">{label}</p>
                          </div>
                          <span className="text-ds-12 font-medium tabular-nums shrink-0" style={{ color: "hsl(var(--bark))" }}>
                            {formatCurrency(earned)}
                          </span>
                          <span className="text-ds-11 text-muted-foreground tabular-nums shrink-0 text-right">
                            {new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* No jobs empty state inside the document */}
              {data.completedJobs.length === 0 && (
                <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
                  <Briefcase className="w-8 h-8 text-muted-foreground/50" />
                  <p className="text-ds-13 text-muted-foreground font-serif italic">
                    No completed helper jobs yet. Once you complete your first job, your work record will fill in automatically.
                  </p>
                  <BarkPillButton onClick={() => navigate("/dashboard")} className="mt-1">
                    Browse jobs
                  </BarkPillButton>
                </div>
              )}

              {/* Document footer */}
              <div
                className="px-5 py-4 text-center"
                style={{ background: "hsl(var(--bark) / 0.04)" }}
              >
                <p
                  className="font-serif italic text-ds-11 leading-relaxed"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  This record was generated from Helpr&rsquo;s verified job history on {today}.
                  Helpr is a Louisiana-based labor marketplace.
                  For verification inquiries:{" "}
                  <a
                    href="mailto:admin@louisianahelpr.com"
                    className="underline"
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    admin@louisianahelpr.com
                  </a>
                </p>
              </div>
            </div>

            {/* Share CTA */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => { void handleShare(); }}
                className="flex-1 flex items-center justify-center gap-2 rounded-ds-lg py-3.5 text-ds-14 font-semibold active:scale-[0.99] transition-all"
                style={{
                  background: "hsl(var(--bark) / 0.10)",
                  border: "1px solid hsl(var(--bark) / 0.30)",
                  color: "hsl(var(--bark))",
                }}
              >
                <Share2 className="w-4 h-4" />
                Share summary
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center justify-center gap-2 rounded-ds-lg py-3.5 px-5 text-ds-14 font-semibold active:scale-[0.99] transition-all"
                style={{
                  background: "transparent",
                  border: "1px solid hsl(var(--bark) / 0.32)",
                  color: "hsl(var(--bark))",
                }}
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

interface StatBlockProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

function StatBlock({ icon, label, value, sub }: StatBlockProps) {
  return (
    <div
      className="rounded-ds-md px-3 py-2.5"
      style={{
        background: "hsl(var(--parchment) / 0.55)",
        border: "1px solid hsl(var(--olivewood) / 0.08)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color: "hsl(var(--bark))" }}>{icon}</span>
        <span className="text-ds-10 font-sans font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="text-ds-15 font-bold leading-tight" style={{ color: "hsl(var(--ink-deep))" }}>
        {value}
      </p>
      {sub && (
        <p className="text-ds-10 text-muted-foreground mt-0.5">{sub}</p>
      )}
    </div>
  );
}

export default WorkRecord;
