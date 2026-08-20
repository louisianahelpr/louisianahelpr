/**
 * HelperAnalyticsBody — the analytics dashboard itself, with no page chrome.
 *
 * Extracted from HelperAnalytics.tsx (2026-08-19) so the SAME dashboard can
 * render in two places without being built twice: the standalone /analytics
 * route (which still owns the PageHeader + document-scroll wrapper), and the
 * merged Profile "Earnings & payouts" tab, where analytics is one section of
 * one screen rather than a separate destination with its own header.
 *
 * It renders no heading and no outer max-width — the host supplies both.
 */
import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Eye, Star, Target, Clock, Repeat } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAnalytics, type Analytics } from "@/pages/helperAnalytics/fetchAnalytics";
import HeroSummary from "@/pages/helperAnalytics/HeroSummary";
import EarningsByMonthCard from "@/pages/helperAnalytics/EarningsByMonthCard";
import { tierFeePercent } from "@/lib/subscriptionTiers";
const ProfileStatsTrend = lazy(() => import("@/components/profile/ProfileStatsTrend"));
import TopCategoriesCard from "@/pages/helperAnalytics/TopCategoriesCard";
import ProfileViewsCard from "@/pages/helperAnalytics/ProfileViewsCard";
import SuccessRateCard from "@/pages/helperAnalytics/SuccessRateCard";
import OnTimeArrivalCard from "@/pages/helperAnalytics/OnTimeArrivalCard";
import RepeatHireCard from "@/pages/helperAnalytics/RepeatHireCard";
import BestDaysCard from "@/pages/helperAnalytics/BestDaysCard";
import { AnalyticsCard, ProUpsellHeader } from "@/pages/helperAnalytics/SectionCard";
import RatingsReviewsCard from "@/pages/helperAnalytics/RatingsReviewsCard";

// Helpers whose subscription tier gives access to analytics.
const ANALYTICS_TIERS = new Set(["pro", "elite", "business"]);

// The monthly earnings goal is NOT here. This page used to carry a second
// "Monthly goal" card — its own editor, its own progress bar, its own wording
// ("earnings goal" vs the wallet's "earning goal") — over the same
// `helpr:earnings_goal` localStorage value the Earnings tab writes. Two
// controls for one setting, and worse, two different answers: this page's
// progress was computed from GROSS budget bucketed by `updated_at`, while
// Profile → My earnings uses net take-home (`helperTakeHomeDollars`) bucketed
// by `helper_completed_at`, so the identical goal read at two different
// percentages depending on which screen you were on. The goal lives on the
// wallet screen, next to the money it is measured against — see
// `src/components/profile/MonthlyGoalCard.tsx`.

// ── KPI tile (desktop-only strip) ────────────────────────────────────────────
//
// Small at-a-glance stat tile used above the card grid on lg+ screens. Values
// come straight from the same `Analytics` payload the cards below consume —
// this is a summary surface, not a second data fetch. The tile stays visually
// aligned with SectionCard (liquid-glass, same shadow) so the strip reads as
// part of the same dashboard rather than a bolted-on header.

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  isLoading: boolean;
}

const KpiTile = ({ label, value, sub, icon, isLoading }: KpiTileProps) => {
  return (
    <div
      className="rounded-2xl liquid-glass p-4"
      style={{
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.4), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: "hsl(var(--burnt-sienna))" }}>{icon}</span>
        <h3
          className="font-serif italic uppercase text-ds-9"
          style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
        >
          {label}
        </h3>
      </div>
      {isLoading ? (
        <Skeleton className="h-7 w-20 rounded" />
      ) : (
        <>
          <p
            className="font-display italic font-bold tabular-nums text-ds-24"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            {value}
          </p>
          {sub && (
            <p className="text-ds-11 mt-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {sub}
            </p>
          )}
        </>
      )}
    </div>
  );
};

// Build the 4 tiles shown in the desktop KPI strip. Kept as a small helper so
// the JSX below stays readable; picks the four metrics with the highest
// at-a-glance value (rating, success rate, profile views, and — depending on
// what data exists — on-time or repeat-hire).
function buildKpis(a: Analytics | undefined) {
  const rating = a?.avgRating;
  const success = a?.successRate;
  const views = a?.profileViewCount;
  // Prefer on-time rate when available (needs >=5 timed jobs); fall back to
  // repeat-hire (needs >=3 completed jobs); if neither is available, show
  // completed jobs count so the tile is never a "—".
  const trustTile =
    a?.onTimeRate !== null && a?.onTimeRate !== undefined
      ? {
          label: "On-time",
          value: `${a.onTimeRate}%`,
          sub: `${a.timingJobCount} timed job${a.timingJobCount === 1 ? "" : "s"}`,
          icon: <Clock className="w-4 h-4" />,
        }
      : a?.repeatHirePercent !== null && a?.repeatHirePercent !== undefined
      ? {
          label: "Repeat hire",
          value: `${a.repeatHirePercent}%`,
          sub: "posters who rebook",
          icon: <Repeat className="w-4 h-4" />,
        }
      : {
          label: "Completed",
          value: String(a?.completedCount ?? 0),
          sub: "last 6 months",
          icon: <Repeat className="w-4 h-4" />,
        };

  return [
    {
      label: "Avg rating",
      value: rating !== null && rating !== undefined ? rating.toFixed(1) : "—",
      sub: a?.reviewCount ? `${a.reviewCount} review${a.reviewCount === 1 ? "" : "s"}` : "no reviews yet",
      icon: <Star className="w-4 h-4" />,
    },
    {
      label: "Success rate",
      value: success !== null && success !== undefined ? `${success}%` : "—",
      sub: a?.totalApplications ? `${a.totalApplications} application${a.totalApplications === 1 ? "" : "s"}` : "no applications yet",
      icon: <Target className="w-4 h-4" />,
    },
    {
      label: "Profile views",
      value: String(views ?? 0),
      sub: "this month",
      icon: <Eye className="w-4 h-4" />,
    },
    trustTile,
  ];
}
export const HelperAnalyticsBody = () => {
  const navigate = useNavigate();
  const { user } = useCurrentUser();

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

  // How many locked panels the free tier will actually see. Counted rather
  // than hardcoded because two of them (on-time arrival, repeat-hire) only
  // render once the underlying RPC has enough history to return a value — so a
  // literal "7" would over-promise for a newer helper. The five always-present
  // panels are earnings-by-month, top categories, best days, success rate and
  // profile views; ratings & reviews makes six.
  const lockedInsightCount =
    6 +
    (analytics?.onTimeRate !== null && analytics?.onTimeRate !== undefined ? 1 : 0) +
    (analytics?.repeatHirePercent !== null && analytics?.repeatHirePercent !== undefined ? 1 : 0);

  const onUpgrade = () => navigate("/profile?tab=subscription");
  return (
    <>
          {/* A failed fetch leaves `analytics` undefined, which would render
              $0 / 0 jobs everywhere and read as a brand-new helper rather
              than a broken load. Surface a recoverable error instead —
              rendered as a single centered card rather than the full grid
              so the failure reads clearly. */}
          {isError && !isLoadingData ? (
            <ErrorState
              variant="inline"
              title="Couldn't load your analytics."
              body="Your earnings are safe — this is just the dashboard failing to load. Tap Try again."
              onRetry={() => refetch()}
            />
          ) : (
          <>

          {/* ── Header: the hero is full-width above the grid ───────────
              Page-level context, not an analytics tile, so it stays
              full-width at every breakpoint. */}
          <HeroSummary analytics={analytics} isLoading={isLoadingData} />

          {/* ── KPI strip (desktop-only) ────────────────────────────────
              On lg+ we surface a 4-tile at-a-glance summary above the
              detail-card grid so the page reads as a real dashboard
              instead of a scroll of stacked cards. Hidden below lg to
              preserve the existing mobile stack exactly — the same
              numbers already live in the detail cards on that layout. */}
          <div className="hidden lg:grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {buildKpis(analytics).map((k) => (
              <KpiTile
                key={k.label}
                label={k.label}
                value={k.value}
                sub={k.sub}
                icon={k.icon}
                isLoading={isLoadingData}
              />
            ))}
          </div>

          {/* ── Analytics cards (gated for free tier) ─────────────────── */}
          {/* We still render the cards so free-tier users can see what
              they're missing — but a blur overlay + upgrade CTA covers
              the content when access is denied.

              Grid: single column at mobile (unchanged), 2-col at lg,
              3-col at xl. The earnings chart is the most visual card,
              so it spans the full row width at every desktop breakpoint
              — a bar chart squeezed into a third-column tile becomes
              unreadable. Ratings & reviews also spans 2 cols at xl
              because its per-star bars need horizontal room to breathe. */}
          {/* ONE upgrade action for the page, not one per locked panel.
              Free tier used to get five identical "Unlock →" cards in a
              column — the shape of an ad break. Each locked panel is now a
              single scannable row (see SectionCard) and this states the offer
              once, above them. The upgrade path is more prominent than it was,
              not less; it is just no longer repeated five times. */}
          {!hasAnalyticsAccess && !isLoadingData && (
            <div className="mt-6">
              <ProUpsellHeader onUpgrade={onUpgrade} count={lockedInsightCount} />
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 lg:gap-8">

            {/* Activity trend — relocated from the Profile landing, where a
                self-fetching chart of your own job volume was identity-page
                furniture. Self-fetches, so it needs only the user id.
                Wrapped in AnalyticsCard — the same shell SectionCard uses —
                so this section reads as one more panel in the stack rather
                than a labelled strip on the bare page. */}
            {user?.id && (
              <div className="lg:col-span-2 xl:col-span-3">
                <Suspense fallback={null}>
                  <AnalyticsCard>
                    <ProfileStatsTrend
                      helperId={user.id}
                      /* Same tier-derived fallback the Profile landing used, so
                         "earned" still agrees with the other earnings surfaces. */
                      feeFallbackPercent={tierFeePercent(analytics?.tier ?? null)}
                    />
                  </AnalyticsCard>
                </Suspense>
              </div>
            )}

            {/* Earnings by month bar chart — wide time-series */}
            <div className="lg:col-span-2 xl:col-span-3">
              <EarningsByMonthCard
                analytics={analytics}
                hasAccess={hasAnalyticsAccess}
                isLoading={isLoadingData}
                onUpgrade={onUpgrade}
              />
            </div>

            {/* Top categories */}
            <TopCategoriesCard
              analytics={analytics}
              hasAccess={hasAnalyticsAccess}
              isLoading={isLoadingData}
              onUpgrade={onUpgrade}
            />

            {/* Best days of week */}
            <BestDaysCard
              analytics={analytics}
              hasAccess={hasAnalyticsAccess}
              isLoading={isLoadingData}
              onUpgrade={onUpgrade}
            />

            {/* Application success rate */}
            <SuccessRateCard
              analytics={analytics}
              hasAccess={hasAnalyticsAccess}
              isLoading={isLoadingData}
              onUpgrade={onUpgrade}
            />

            {/* Profile views */}
            <ProfileViewsCard
              analytics={analytics}
              hasAccess={hasAnalyticsAccess}
              isLoading={isLoadingData}
              onUpgrade={onUpgrade}
            />

            {/* On-time arrival rate — only shown when >= 5 jobs have check-in data */}
            {analytics?.onTimeRate !== null && analytics?.onTimeRate !== undefined && (
              <OnTimeArrivalCard
                analytics={analytics}
                hasAccess={hasAnalyticsAccess}
                isLoading={isLoadingData}
                onUpgrade={onUpgrade}
              />
            )}

            {/* Repeat hire rate — only shown when RPC returns a value (>= 3 completed jobs) */}
            {analytics?.repeatHirePercent !== null && analytics?.repeatHirePercent !== undefined && (
              <RepeatHireCard
                analytics={analytics}
                hasAccess={hasAnalyticsAccess}
                isLoading={isLoadingData}
                onUpgrade={onUpgrade}
              />
            )}

            {/* Ratings & reviews — per-star bars need horizontal room at xl */}
            <div className="xl:col-span-2">
              <RatingsReviewsCard
                analytics={analytics}
                hasAccess={hasAnalyticsAccess}
                isLoading={isLoadingData}
                onUpgrade={onUpgrade}
              />
            </div>

          </div>

          </>
          )}
    </>
  );
};

export default HelperAnalyticsBody;
