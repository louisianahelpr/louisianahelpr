import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Gift, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuthReady } from "@/hooks/useAuthReady";
import { shareNative } from "@/lib/nativeShare";
import { report } from "@/lib/errorLogger";
import { formatCategory, wrappedSeasonLabel } from "@/lib/format";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { netUrgentFeeDollars } from "@/lib/stripeFees";

const YEAR = new Date().getFullYear();
// "Wrapped" in December, "so far" the rest of the year (see LH-39).
const SEASON = wrappedSeasonLabel();

// $15/hr proxy for converting earnings → approximate hours worked
const HOURLY_PROXY = 15;

interface WrappedStats {
  jobsPosted: number;
  totalSpent: number;
  jobsCompleted: number;
  totalEarned: number;
  uniquePeople: number;
  topCategory: string | null;
  bestRating: number | null;
  reviewsGiven: number;
  reviewsReceived: number;
  approxHours: number;
  /** True when at least one (but not every) stat query failed, so the
   *  numbers below are an undercount rather than the whole year. */
  incomplete: boolean;
}

async function fetchWrappedStats(userId: string): Promise<WrappedStats> {
  const yearStart = `${YEAR}-01-01T00:00:00.000Z`;
  const yearEnd = `${YEAR}-12-31T23:59:59.999Z`;

  const [postedRes, completedRes, reviewsGivenRes, reviewsReceivedRes, profileRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, budget, category, helper_id")
      .eq("customer_id", userId)
      .gte("created_at", yearStart)
      .lte("created_at", yearEnd),
    supabase
      .from("jobs")
      .select("id, budget, category, customer_id, helper_fee_percent, platform_fee_amount, urgent_fee, helpers_needed, is_group_job")
      .eq("helper_id", userId)
      .eq("status", "completed")
      .gte("created_at", yearStart)
      .lte("created_at", yearEnd),
    supabase
      .from("reviews")
      .select("id, rating")
      .eq("reviewer_id", userId)
      .gte("created_at", yearStart)
      .lte("created_at", yearEnd),
    supabase
      .from("reviews")
      .select("id, rating")
      .eq("reviewee_id", userId)
      .gte("created_at", yearStart)
      .lte("created_at", yearEnd),
    supabase
      .from("profiles")
      .select("subscription_tier, subscription_expires_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  for (const [label, res] of [
    ["posted", postedRes],
    ["completed", completedRes],
    ["reviews_given", reviewsGivenRes],
    ["reviews_received", reviewsReceivedRes],
    ["profile", profileRes],
  ] as const) {
    if (res.error) {
      report(res.error, {
        severity: "warning",
        tags: { area: `helpr_wrapped.${label}` },
        context: { user_id: userId },
      });
    }
  }

  // The four stat queries above are the page's whole substance — `profile`
  // only supplies a fee-percent fallback. If EVERY one of them failed this
  // isn't a quiet year, it's an outage: throw so React Query flags isError
  // and the page can offer a retry instead of telling someone with a full
  // year of history "No activity yet". If only some failed, hand back an
  // `incomplete` flag so the render side can say the numbers are partial
  // rather than presenting an undercount as the truth.
  const coreErrors = [
    postedRes.error,
    completedRes.error,
    reviewsGivenRes.error,
    reviewsReceivedRes.error,
  ].filter((e): e is NonNullable<typeof e> => !!e);

  if (coreErrors.length === 4) {
    throw new Error(coreErrors[0].message || "Couldn't load your Helpr year.");
  }

  const posted = postedRes.data ?? [];
  const completed = completedRes.data ?? [];
  const reviewsGiven = reviewsGivenRes.data ?? [];
  const reviewsReceived = reviewsReceivedRes.data ?? [];

  // Total spent = sum of budgets on posted jobs (proxy)
  const totalSpent = posted.reduce((acc, j) => acc + (j.budget ?? 0), 0);
  // Total earned = helper take-home (net of the platform fee), so the same
  // $75 job reads the same here as on analytics/work-record/Earnings. Prefer
  // the stamped platform_fee_amount; for legacy/seed rows without one, derive
  // the fee from the helper's tier (matching every other earnings surface).
  const feeFallbackPct = tierFeePercent(
    profileRes.data?.subscription_tier ?? null,
    profileRes.data?.subscription_expires_at ?? null,
  );
  const totalEarned = completed.reduce((acc, j) => {
    const budget = j.budget ?? 0;
    // Nullish, not `||`: a genuinely-stamped $0 fee (a comped/promo job) must
    // be trusted verbatim, not mistaken for an unstamped legacy row.
    const fee = j.platform_fee_amount ?? (budget * (j.helper_fee_percent ?? feeFallbackPct)) / 100;
    return acc + (budget - fee + netUrgentFeeDollars(j.urgent_fee));
  }, 0);

  // Unique people worked with — union of helper_ids from posted jobs (who accepted)
  // and customer_ids from completed helper jobs
  const peopleWorkedWith = new Set<string>([
    ...posted.map((j) => j.helper_id).filter(Boolean) as string[],
    ...completed.map((j) => j.customer_id).filter(Boolean) as string[],
  ]);

  // Top category by count across both sides
  const categoryCount: Record<string, number> = {};
  for (const j of [...posted, ...completed]) {
    if (j.category) categoryCount[j.category] = (categoryCount[j.category] ?? 0) + 1;
  }
  const topCategory =
    Object.keys(categoryCount).sort((a, b) => (categoryCount[b] ?? 0) - (categoryCount[a] ?? 0))[0] ?? null;

  // Best rating received
  const receivedRatings = reviewsReceived.map((r) => r.rating).filter((r): r is number => typeof r === "number");
  const bestRating = receivedRatings.length > 0 ? Math.max(...receivedRatings) : null;

  // Approximate hours WORKED — derived from earnings only ÷ $15/hr. This
  // sublabel sits on the "earned" card, so it must reflect the helper's own
  // labor; folding in `totalSpent` (money they paid OTHERS to do jobs) inflated
  // the figure into implausible territory (Cowork audit: "~194 hrs").
  const approxHours = Math.round(totalEarned / HOURLY_PROXY);

  return {
    jobsPosted: posted.length,
    totalSpent,
    jobsCompleted: completed.length,
    totalEarned,
    uniquePeople: peopleWorkedWith.size,
    topCategory,
    bestRating,
    reviewsGiven: reviewsGiven.length,
    reviewsReceived: reviewsReceived.length,
    approxHours,
    incomplete: coreErrors.length > 0,
  };
}

interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
}

const StatCard = ({ label, value, sublabel }: StatCardProps) => (
  <div
    className="rounded-ds-md p-4 text-center space-y-1 flex flex-col items-center justify-center"
    style={{
      background: "rgba(255,255,255,0.28)",
      backdropFilter: "blur(12px) saturate(150%)",
      WebkitBackdropFilter: "blur(12px) saturate(150%)",
      border: "0.5px solid rgba(255,255,255,0.5)",
      boxShadow:
        "inset 0 1px 1px 0 rgba(255,255,255,0.6), 0 2px 8px -2px hsl(var(--olivewood) / 0.12)",
    }}
  >
    <p
      className="text-ds-28 font-display italic font-bold tabular-nums leading-none"
      style={{ color: "hsl(var(--ink-deep))" }}
    >
      {value}
    </p>
    <p className="text-[0.7rem] font-sans font-semibold uppercase tracking-wider leading-tight" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      {label}
    </p>
    {sublabel && (
      <p className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--burnt-sienna) / 0.65)" }}>
        {sublabel}
      </p>
    )}
  </div>
);

const HelprWrapped = () => {
  usePageTitle(SEASON.isYearEnd ? `Helpr Wrapped ${YEAR}` : `Your ${YEAR} so far — Helpr`);
  const navigate = useNavigate();
  const { user, isReady } = useAuthReady();

  // Guard: redirect to /login once auth resolves with no user.
  // Must be an effect — can't call navigate() before all hooks.
  useEffect(() => {
    if (isReady && !user) {
      navigate("/login", { replace: true });
    }
  }, [isReady, user, navigate]);

  const { data: stats, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["helpr-wrapped", user?.id, YEAR],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: () => fetchWrappedStats(user!.id),
  });

  const handleShare = async () => {
    const helpedCount = (stats?.jobsPosted ?? 0) + (stats?.jobsCompleted ?? 0);
    const earned = stats?.totalEarned ?? 0;
    await shareNative({
      title: `My ${YEAR} on Helpr`,
      text: `I helped ${helpedCount} neighbor${helpedCount !== 1 ? "s" : ""} and earned $${earned.toLocaleString()} on @LouisianaHelpr this year! 🎉`,
      url: "https://www.louisianahelpr.com",
      dialogTitle: SEASON.isYearEnd ? "Share your Helpr Wrapped" : "Share your Helpr year",
    });
  };

  // Stat cards to render — only show if value > 0
  const statCards: StatCardProps[] = [];

  if (!isLoading && stats) {
    const helpersHired = stats.jobsPosted;
    const jobsDone = stats.jobsCompleted;

    if (helpersHired > 0) {
      statCards.push({
        value: String(helpersHired),
        label: helpersHired === 1 ? "job posted" : "jobs posted",
      });
    }
    if (jobsDone > 0) {
      statCards.push({
        value: String(jobsDone),
        label: jobsDone === 1 ? "neighbor helped" : "neighbors helped",
      });
    }
    if (stats.totalEarned > 0) {
      statCards.push({
        value: `$${stats.totalEarned.toLocaleString()}`,
        label: "earned",
        sublabel: stats.approxHours > 0 ? `~${stats.approxHours} hrs` : undefined,
      });
    }
    if (stats.totalSpent > 0 && stats.totalEarned === 0) {
      statCards.push({
        value: `$${stats.totalSpent.toLocaleString()}`,
        label: "invested in community",
      });
    }
    if (stats.uniquePeople > 0) {
      statCards.push({
        value: String(stats.uniquePeople),
        label: stats.uniquePeople === 1 ? "person worked with" : "people worked with",
      });
    }
    if (stats.topCategory) {
      statCards.push({
        value: formatCategory(stats.topCategory),
        label: "top category",
      });
    }
    if (stats.bestRating !== null && stats.bestRating > 0) {
      statCards.push({
        value: `${stats.bestRating.toFixed(1)}★`,
        label: "best rating",
      });
    }
    if (stats.reviewsReceived > 0) {
      statCards.push({
        value: String(stats.reviewsReceived),
        label: stats.reviewsReceived === 1 ? "review received" : "reviews received",
      });
    }
  }

  const hasActivity = statCards.length > 0;

  // "No activity yet" is a claim about the user's year — only make it when
  // we actually know. A hard failure (every stat query down), or a partial
  // failure that left us with nothing to show, both render as a retryable
  // error instead. `incomplete` alongside real cards is footnoted below.
  const loadFailed = isError || (!!stats?.incomplete && !hasActivity);

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow="Louisiana Helpr"
        title={`Your ${SEASON.title}`}
        showBrand
        rightSlot={<NotificationPanel />}
      />

      <div className="px-5 py-6 flex flex-col items-center">
        <div
          className="w-full max-w-[420px] rounded-ds-lg overflow-hidden"
          style={{
            background: "linear-gradient(135deg, hsl(var(--bark) / 0.08) 0%, hsl(var(--burnt-sienna) / 0.08) 100%)",
            border: "0.5px solid hsl(var(--bark) / 0.18)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255,255,255,0.45), " +
              "0 4px 24px -6px hsl(var(--olivewood) / 0.18), " +
              "0 24px 48px -12px hsl(var(--olivewood) / 0.12)",
          }}
        >
          {/* Header band */}
          <div
            className="px-6 pt-8 pb-4 text-center"
            style={{
              backgroundImage:
                "radial-gradient(80% 60% at 50% 0%, hsl(var(--burnt-sienna) / 0.10) 0%, transparent 100%)",
            }}
          >
            <Gift
              className="w-10 h-10 mx-auto mb-3"
              style={{ color: "hsl(var(--burnt-sienna) / 0.75)" }}
            />
            {/* h2, not h1: the canonical PageHeader above already renders the
                page's <h1> ("Your {SEASON.title}"). Two h1s saying nearly the
                same thing ("Your 2026 so far" / "Your 2026 on Helpr.") is a
                heading-structure defect — the hero keeps its display size but
                sits correctly under the page title. */}
            <h2
              className="text-ds-28 font-display italic font-bold leading-tight"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Your {YEAR} on Helpr.
            </h2>
            <p
              className="mt-1 font-serif italic text-ds-13"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Louisiana Helpr Community
            </p>
          </div>

          {/* Stats grid */}
          <div className="px-5 pb-5">
            {isLoading || !isReady ? (
              <div className="grid grid-cols-2 gap-2.5">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="rounded-ds-md p-4 h-20 animate-pulse"
                    style={{ background: "rgba(255,255,255,0.20)" }}
                  />
                ))}
              </div>
            ) : loadFailed ? (
              <div className="flex py-2">
                <ErrorState
                  variant="inline"
                  title={`Couldn't load your ${YEAR}.`}
                  body="Your jobs, earnings and reviews are all still there — we just couldn't add them up right now. Tap Try again."
                  onRetry={() => void refetch()}
                  retryDisabled={isFetching}
                />
              </div>
            ) : !hasActivity ? (
              <div className="text-center py-6 space-y-2">
                <p className="text-ds-15 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                  No activity yet in {YEAR}
                </p>
                <p className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Post a job or help a neighbor to start building your story.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  {statCards.map((card, i) => (
                    <StatCard key={i} {...card} />
                  ))}
                </div>
                {/* Part of the year failed to load — say so rather than let
                    an undercount pass for the full picture. */}
                {stats?.incomplete && (
                  <p
                    className="text-center text-ds-11 font-serif italic"
                    style={{ color: "hsl(var(--burnt-sienna) / 0.85)" }}
                  >
                    Some of your {YEAR} didn't load, so these numbers may be low.{" "}
                    <button
                      type="button"
                      onClick={() => void refetch()}
                      disabled={isFetching}
                      className="underline underline-offset-2 disabled:opacity-60"
                    >
                      Try again
                    </button>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Share button */}
          {hasActivity && (
            <div className="px-5 pb-7 space-y-3">
              <Button
                variant="hero"
                size="lg"
                className="w-full squircle"
                onClick={handleShare}
              >
                <Share2 className="w-4 h-4 mr-2" />
                {SEASON.isYearEnd ? "Share your Wrapped" : "Share your year"}
              </Button>
              <p
                className="text-center text-ds-11 font-serif italic"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                <a
                  href="/wrapped"
                  onClick={(e) => e.preventDefault()}
                  className="underline underline-offset-2 hover:opacity-80 transition-opacity"
                  style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }}
                  aria-label="Share your Helpr Wrapped with others"
                >
                  See yours
                </a>{" "}
                — share with the community
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HelprWrapped;
