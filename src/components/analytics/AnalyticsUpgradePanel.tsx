// What a helper WITHOUT the perk sees at /analytics.
//
// THE DECISION, stated plainly because the alternative was live:
//
//   * Not a 404. "Advanced Analytics" is printed on the Pro card; routing the
//     person who read that bullet to a Not Found page is a worse answer than
//     any page.
//   * Not a locked copy of the real dashboard. A grid of blurred tiles behind
//     padlocks is exactly what shipped here before — `HelperAnalyticsBody`,
//     deleted 2026-08-30 because "none of it was wired to a real Pro feature;
//     it only ever showed a lock icon and an upgrade CTA". Fake charts sold as
//     a preview of real ones are the thing this whole build is a reaction to.
//   * A real offer, priced with THEIR numbers. The one figure that makes the
//     case honestly is the commission they are already paying, which is data
//     they can read on their own Earnings tab. The server sends only those
//     money fields (`preview.jobs`) — no categories, no market, no funnel —
//     so the pitch is concrete and the perk stays behind the gate.
//
// When they have no completed jobs yet there is no honest saving to quote, and
// this says what unlocks instead of inventing a number.

import { useNavigate } from "react-router-dom";
import { TrendingUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import { TIER_PERKS, type SubscriptionTier } from "@/lib/subscriptionTiers";
import {
  feeAtPercent,
  helperGrossDollars,
  money,
  type AnalyticsPreviewJob,
} from "@/lib/helperAnalytics";
import { helperPlatformFeeDollars } from "@/lib/helperEarnings";

/** The cheapest tier whose perk row carries advancedAnalytics. */
const UPGRADE_TIER: SubscriptionTier = "pro";

const WHAT_YOU_GET = [
  "Earnings and platform fees month by month, with what your plan saved you",
  "Which job types pay you best — and how your rates compare to what's being posted",
  "Your application win rate, and how your speed stacks up against the helper who won",
  "When jobs get posted in your parish, hour by hour",
];

interface AnalyticsUpgradePanelProps {
  previewJobs: AnalyticsPreviewJob[];
  /** The caller's live commission rate, from their current tier. */
  currentFeePercent: number;
  windowLabel: string;
}

export function AnalyticsUpgradePanel({
  previewJobs,
  currentFeePercent,
  windowLabel,
}: AnalyticsUpgradePanelProps) {
  const navigate = useNavigate();
  const target = TIER_PERKS[UPGRADE_TIER];

  // Their real commission over the window, beside the same jobs at Pro's rate.
  // `helperPlatformFeeDollars` for the actual (it honours the stamped amount);
  // percent-derived for the counterfactual, which is the only way a
  // hypothetical rate can be applied at all.
  let paid = 0, atTarget = 0, gross = 0;
  for (const j of previewJobs) {
    paid += helperPlatformFeeDollars(j, currentFeePercent);
    atTarget += feeAtPercent(j, target.platformFeePercent);
    gross += helperGrossDollars(j);
  }
  const wouldSave = paid - atTarget;
  const monthlyPrice = target.price ?? 0;
  const showMath = previewJobs.length > 0 && gross > 0;

  return (
    <AnalyticsPanel
      title="Advanced Analytics"
      caption={`Included with ${target.name} · $${monthlyPrice}/month`}
      actions={
        <TrendingUp className="h-5 w-5" style={{ color: "hsl(var(--bark) / 0.6)" }} aria-hidden="true" />
      }
    >
      {showMath ? (
        <div
          className="rounded-ds-md px-3 py-3 text-ds-12 leading-snug space-y-1"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "0.5px solid hsl(var(--bark) / 0.18)",
            color: "hsl(var(--olivewood))",
          }}
        >
          <div>
            Over the last {windowLabel} you paid{" "}
            <span className="font-semibold tabular-nums">{money(paid)}</span> in platform fees on{" "}
            <span className="tabular-nums">{money(gross)}</span> of completed work.
          </div>
          <div>
            {wouldSave > 0.005 ? (
              <>
                On {target.name}&rsquo;s {target.platformFeePercent}% commission the same jobs would
                have cost{" "}
                <span className="font-semibold tabular-nums" style={{ color: "hsl(var(--bark))" }}>
                  {money(atTarget)}
                </span>{" "}
                — {money(wouldSave)} less.
              </>
            ) : (
              <>
                {target.name}&rsquo;s commission is {target.platformFeePercent}%, against the{" "}
                {currentFeePercent}% you pay now.
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="text-ds-12 leading-snug" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
          You haven&rsquo;t completed a job yet, so there is nothing here to measure. Finish your
          first job and this page starts filling in — on any plan, your earnings and fees stay on
          the Earnings tab.
        </p>
      )}

      <ul className="space-y-2 pt-1">
        {WHAT_YOU_GET.map((line) => (
          <li key={line} className="flex gap-2 text-ds-12 leading-snug">
            <Check
              className="h-4 w-4 mt-0.5 shrink-0"
              style={{ color: "hsl(var(--bark))" }}
              aria-hidden="true"
            />
            <span style={{ color: "hsl(var(--olivewood))" }}>{line}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        {/* Glossy because it is the primary action on this screen. The gradient
            lives in `.btn-grad-primary` (index.css) — never an inline
            `background` shorthand, which silently resets background-image. */}
        <Button
          className="btn-grad-primary !text-[hsl(var(--parchment))] flex-1 h-11 rounded-full font-semibold"
          onClick={() => navigate("/profile?tab=subscription")}
        >
          See {target.name} plans
        </Button>
        <Button
          variant="ghost"
          className="flex-1 h-11 rounded-full"
          onClick={() => navigate("/profile?tab=earnings")}
        >
          Go to Earnings
        </Button>
      </div>
    </AnalyticsPanel>
  );
}
