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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchAnalytics } from "@/pages/helperAnalytics/fetchAnalytics";
import EarningsByMonthCard from "@/pages/helperAnalytics/EarningsByMonthCard";
import { TIER_PERKS, tierFeePercent } from "@/lib/subscriptionTiers";
const ProfileStatsTrend = lazy(() => import("@/components/profile/ProfileStatsTrend"));
import TopCategoriesCard from "@/pages/helperAnalytics/TopCategoriesCard";
import ProfileViewsCard from "@/pages/helperAnalytics/ProfileViewsCard";
import SuccessRateCard from "@/pages/helperAnalytics/SuccessRateCard";
import OnTimeArrivalCard from "@/pages/helperAnalytics/OnTimeArrivalCard";
import RepeatHireCard from "@/pages/helperAnalytics/RepeatHireCard";
import BestDaysCard from "@/pages/helperAnalytics/BestDaysCard";
import { AnalyticsCard, ProUpsellHeader } from "@/pages/helperAnalytics/SectionCard";
import RatingsReviewsCard from "@/pages/helperAnalytics/RatingsReviewsCard";

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

  // Gate on the perk flag, not a hand-rolled tier list — TIER_PERKS is the
  // single authority on which tiers include advanced analytics, and
  // `analytics.tier` is already the expiry-aware effective tier
  // (fetchAnalytics resolves an expired paid tier to "free").
  const hasAnalyticsAccess = analytics
    ? TIER_PERKS[analytics.tier].advancedAnalytics
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
              title="We couldn't load your analytics."
              body="Your earnings are safe — this is just the dashboard failing to load. Tap Try again."
              onRetry={() => refetch()}
            />
          ) : (
          <>

          {/* NO HERO SUMMARY. It printed exactly two figures — lifetime
              take-home and jobs completed — and both are the Money view's
              "Net" tile, three taps away in the same tab. That was defensible
              when this dashboard was the standalone /analytics PAGE and its
              own comment said "nothing else on this dashboard states them";
              once it became a view of the Earnings tab, something else did.

              Nothing unique was lost: the hero had already been stripped of
              its one non-duplicate line (an estimated "$X after Helpr fee"
              that disagreed with the real ledger figure), which left it
              restating two numbers and nothing more. The dashboard opens on
              the trend chart now — the first thing here that is actually
              about trends. */}

          {/* NO KPI STRIP. A desktop-only 4-tile summary — avg rating,
              success rate, profile views, repeat hire — used to sit here,
              above the card grid. Every one of those four numbers is also a
              card below, so a Pro subscriber read each of them twice on one
              screen, and a free user read three of them ABOVE a blurred panel
              charging for the same figure ("Profile views · 0 · this month",
              then "Profile views — PRO — See how many posters viewed your
              profile this month"). The paywall was selling what the page had
              already given away three inches higher.

              The cards are the surviving rendering because they carry what the
              tiles could not: the platform-average comparison on success rate,
              the per-star breakdown on ratings, the empty-state copy, and the
              paywall itself. One rendering per metric, and desktop and phone
              now agree about what is free (owner: "needs a full upgrade and
              polish alot of the same info"). */}

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
                      /* Same tier-derived fallback the other earnings surfaces
                         use. `analytics.tier` is already expiry-resolved by
                         fetchAnalytics, so no separate expires_at is needed
                         here for the rate to be expiry-aware. */
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
