// Advanced Analytics, the Pro/Elite perk — a Profile tab body.
//
// WHY IT IS ITS OWN THING AND NOT THE EARNINGS TAB. It was merged into the
// Earnings tab on 2026-08-19 ("there is one Earnings & Analytics, not two"),
// and that merge was right at the time: the old /analytics rendered the SAME
// body as the Earnings tab under a different title. This is not that page
// coming back. The Earnings tab answers "what did I make and where is the
// money"; this one answers "how do I make more", and half of its content —
// market rates and the posting clock — is data the Earnings tab structurally
// cannot show, because a helper cannot read other people's jobs at all. The
// perk bullet on the $10 card now points at something.
//
// SHELL: none of its own. Until 2026-09-02 this was the standalone route
// `/analytics`, reached only from Profile's Earnings tab — a Profile tab
// wearing a route's clothes, and the odd one out among its siblings because it
// was the document-scroll kind (`min-h-screen bg-premium-page pb-safe-nav` +
// PageHeader) rather than an AppPage. It now renders the canonical tab body:
// `space-y-4` under a ProfileTabHeader. Profile.tsx owns the AppShell, the
// viewport lock, the scroll container and the safe-area inset, so a
// `min-h-screen` / `pb-safe-nav` / page background here would fight it.
//
// NO SECOND MEASURE OR GUTTER either: Profile.tsx already wraps every tab in
// `container mx-auto px-5 lg:px-8 xl:px-12` > `page-measure mx-auto`, which is
// why `Body` below carries only the column's gap.

import { useState } from "react";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarChart3 } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import {
  ANALYTICS_RANGES,
  DEFAULT_ANALYTICS_RANGE,
  RANGE_LABELS,
  isPendingDeploy,
  useHelperAnalytics,
  type AnalyticsRange,
} from "@/hooks/useHelperAnalytics";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AnalyticsUpgradePanel } from "@/components/analytics/AnalyticsUpgradePanel";
import { ApplicationsPanel } from "@/components/analytics/ApplicationsPanel";
import { CategoryPanel } from "@/components/analytics/CategoryPanel";
import { DemandPanel } from "@/components/analytics/DemandPanel";
import { EarningsFeePanel } from "@/components/analytics/EarningsFeePanel";

/** The one body wrapper, shared by every state so the column never resizes.
 *  Gap only — the measure and the gutters belong to Profile.tsx's tab
 *  container (see the SHELL note at the top of this file). */
function Body({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 items-stretch">{children}</div>;
}

/**
 * The 90d / 12mo / 24mo window. Renders the app's shared segmented control —
 * this used to be a local copy of the same markup, and it was one of the two
 * (of four) that already wore the canonical olive gloss.
 */
function RangeToggle({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (v: AnalyticsRange) => void;
}) {
  return (
    <SegmentedControl
      ariaLabel="Time range"
      className="w-fit"
      options={ANALYTICS_RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }))}
      value={value}
      onChange={onChange}
    />
  );
}

export default function HelperAnalytics({ onBack }: { onBack?: () => void }) {
  usePageTitle("Analytics");
  const { user, profile, isLoading: userLoading } = useCurrentUser();
  const [range, setRange] = useState<AnalyticsRange>(DEFAULT_ANALYTICS_RANGE);
  const { data, isLoading, isError, refetch, isFetching } = useHelperAnalytics(user?.id, range);

  // The commission to apply to a legacy row that predates the per-job
  // `helper_fee_percent` column — the helper's own tier rate, exactly as the
  // Earnings tab derives it, so the two screens agree on those rows too.
  const feeFallbackPercent = tierFeePercent(
    profile?.subscription_tier ?? "free",
    profile?.subscription_expires_at ?? null,
  );

  // Every state — loading, error, pending-deploy, upgrade, loaded — returns
  // through `wrap`, so the tab shell is written once and no early return can
  // ship its own competing wrapper.
  const wrap = (inner: React.ReactNode) => (
    <div className="space-y-4">
      <ProfileTabHeader title="Analytics" onBack={onBack} />
      <Body>{inner}</Body>
    </div>
  );

  if (userLoading || isLoading) {
    return wrap(
      <>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl liquid-glass p-5 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </>,
    );
  }

  if (isError) {
    return wrap(
      <ErrorState
        variant="inline"
        title="We couldn't load your analytics."
        body="Nothing is wrong with your earnings — we just couldn't reach the numbers. Tap Try again."
        onRetry={() => void refetch()}
        retryDisabled={isFetching}
      />,
    );
  }

  // The migration has merged but db-deploy hasn't finished. Say so, rather than
  // rendering an empty dashboard that reads as "you have no history".
  if (isPendingDeploy(data)) {
    return wrap(
      <EmptyState
        variant="inline"
        icon={BarChart3}
        title="Analytics is coming online"
        body="This page is being switched on right now. Give it a minute and pull to refresh — your earnings are unaffected."
        action={
          <button
            type="button"
            onClick={() => void refetch()}
            className="btn-grad-primary !text-[hsl(var(--parchment))] h-11 px-5 rounded-full font-semibold text-ds-13"
          >
            Try again
          </button>
        }
      />,
    );
  }

  if (!data) {
    return wrap(
      <ErrorState
        variant="inline"
        title="We couldn't load your analytics."
        onRetry={() => void refetch()}
        retryDisabled={isFetching}
      />,
    );
  }

  const windowLabel = RANGE_LABELS[range];

  // ENTITLEMENT COMES FROM THE SERVER, not from `profile.subscription_tier`.
  // The client copy of the tier is a convenience; `data.entitled` is the
  // database's answer, and it is the one that decides what renders — because
  // it is also the one that decided what was sent.
  if (!data.entitled) {
    // ABSENT `preview` means the server could not identify the caller (a torn
    // or expired session), NOT that they have no history. `?? []` here made the
    // upgrade panel tell a helper with years of completed work that they had
    // never finished a job — the `{data: [], error: null}` mistake wearing a
    // different hat, and on the one page written to stop it.
    if (!data.preview) {
      return wrap(
        <ErrorState
          variant="inline"
          title="We couldn't confirm your session."
          body="Sign-in looks stale, so we can't tell you what your plan includes yet. Tap Try again."
          onRetry={() => void refetch()}
          retryDisabled={isFetching}
        />,
      );
    }
    return wrap(
      <AnalyticsUpgradePanel
        previewJobs={data.preview.jobs}
        currentFeePercent={feeFallbackPercent}
        windowLabel={windowLabel}
      />,
    );
  }

  const jobs = data.jobs ?? [];
  const applications = data.applications ?? [];
  const hasAnyHistory = jobs.length > 0 || applications.length > 0;

  return wrap(
    <>
      <div className="flex justify-end">
        <RangeToggle value={range} onChange={setRange} />
      </div>

      {!hasAnyHistory && (
        <EmptyState
          variant="inline"
          icon={BarChart3}
          title="Nothing to measure yet"
          // The second sentence is CONDITIONAL, and that is the whole point.
          // The first draft always promised "the market panel below already
          // works" — and on prod today it does not, because the posting
          // population is below its floor. A page built to stop this app
          // printing claims it cannot keep does not get to open with one.
          body={
            data.market?.demand
              ? "Apply for a job and finish one, and this page starts answering where your money comes from. The posting clock below already works."
              : "Apply for a job and finish one, and this page starts answering where your money comes from and when to be looking."
          }
        />
      )}

      {hasAnyHistory && (
        <>
          <EarningsFeePanel
            jobs={jobs}
            feeFallbackPercent={feeFallbackPercent}
            windowLabel={windowLabel}
          />
          <CategoryPanel
            jobs={jobs}
            feeFallbackPercent={feeFallbackPercent}
            floors={data.floors}
            market={data.market}
            windowLabel={windowLabel}
          />
          <ApplicationsPanel
            applications={applications}
            headToHead={data.head_to_head}
            floors={data.floors}
            windowLabel={windowLabel}
          />
        </>
      )}

      <DemandPanel market={data.market} floors={data.floors} />
    </>,
  );
}
