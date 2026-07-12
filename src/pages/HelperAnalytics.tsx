import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchAnalytics } from "./helperAnalytics/fetchAnalytics";
import HeroSummary from "./helperAnalytics/HeroSummary";
import MonthlyGoalCard from "./helperAnalytics/MonthlyGoalCard";
import EarningsByMonthCard from "./helperAnalytics/EarningsByMonthCard";
import TopCategoriesCard from "./helperAnalytics/TopCategoriesCard";
import ProfileViewsCard from "./helperAnalytics/ProfileViewsCard";
import SuccessRateCard from "./helperAnalytics/SuccessRateCard";
import OnTimeArrivalCard from "./helperAnalytics/OnTimeArrivalCard";
import RepeatHireCard from "./helperAnalytics/RepeatHireCard";
import BestDaysCard from "./helperAnalytics/BestDaysCard";
import RatingsReviewsCard from "./helperAnalytics/RatingsReviewsCard";

// Helpers whose subscription tier gives access to analytics.
const ANALYTICS_TIERS = new Set(["pro", "elite", "business"]);

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

  const onUpgrade = () => navigate("/profile?tab=subscription");

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow="Helper dashboard"
        title="Earnings & Analytics"
        meta="Your last 6 months"
        width="lg"
        showBrand
        rightSlot={<NotificationPanel />}
      />

      <div className="container mx-auto px-5 py-6">
        <div className="max-w-lg lg:max-w-5xl xl:max-w-6xl mx-auto space-y-5">

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
          <HeroSummary analytics={analytics} isLoading={isLoadingData} />

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
          <EarningsByMonthCard
            analytics={analytics}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={onUpgrade}
          />

          {/* Top categories */}
          <TopCategoriesCard
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

          {/* Application success rate */}
          <SuccessRateCard
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

          {/* Best days of week */}
          <BestDaysCard
            analytics={analytics}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={onUpgrade}
          />

          {/* Ratings & reviews */}
          <RatingsReviewsCard
            analytics={analytics}
            hasAccess={hasAnalyticsAccess}
            isLoading={isLoadingData}
            onUpgrade={onUpgrade}
          />

          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default HelperAnalytics;
