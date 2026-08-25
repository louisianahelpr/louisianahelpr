import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, Gift, Briefcase, Zap, Info } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPriceExact } from "@/lib/format";
import { instantPayoutFeeLabel, instantPayoutMinLabel } from "@/lib/instantPayoutFee";
import {
  FORM_1099K_GROSS_THRESHOLD_DOLLARS,
  FORM_1099K_TRANSACTION_THRESHOLD,
  form1099kGrossLabel,
} from "@/lib/moneyLimits";
import { helperTakeHomeDollars, sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import { stripeProcessingCostCents } from "@/lib/stripeFees";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { toast } from "@/hooks/use-toast";
import { EarningsExport } from "@/components/EarningsExport";
import InstantPayoutDialog from "@/components/InstantPayoutDialog";
import ProUpgradeSheet from "@/components/ProUpgradeSheet";
import { safeStorage } from "@/lib/safeStorage";
import { EarningsBreakdownCharts } from "@/components/profile/EarningsBreakdownCharts";
import { PayoutCelebration } from "@/components/wallet/PayoutCelebration";
import { EarningsForecastCard } from "@/components/profile/EarningsForecastCard";
import { HelperScheduleStrip } from "@/components/profile/HelperScheduleStrip";
import { HelperStreakBadge } from "@/components/profile/HelperStreakBadge";
import { MonthlyGoalCard } from "@/components/profile/MonthlyGoalCard";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHelperMilestones } from "@/hooks/useHelperMilestones";
import type { EarningsTabProps } from "@/components/profile/earningsTab/types";
import { buildPayoutsCsv } from "@/components/profile/earningsTab/earningsTabHelpers";
import { useEarningsData } from "@/components/profile/earningsTab/useEarningsData";
import { EarningsToolsMenu } from "@/components/profile/earningsTab/EarningsToolsMenu";
import { ThresholdBanner } from "@/components/profile/earningsTab/ThresholdBanner";
import { WalletCard } from "@/components/profile/earningsTab/WalletCard";
import { PayoutHistory } from "@/components/profile/earningsTab/PayoutHistory";
import { RecentTransfers } from "@/components/profile/earningsTab/RecentTransfers";
import { EarningHistory } from "@/components/profile/earningsTab/EarningHistory";
// MERGED IN 2026-08-19 (owner request, stated three times): "My earnings",
// "Earnings & Analytics" (/analytics) and "Payout & Payments" were three
// separate Profile entry points onto three screens about the same subject —
// what you earned, what it says about your work, and where the money lands.
// They are now ONE screen: this tab, with the analytics dashboard and the
// payout setup as sections of it rather than destinations of their own. Both
// are code-split because neither is needed for the first paint of the wallet.
const HelperAnalyticsBody = lazy(() => import("@/pages/helperAnalytics/HelperAnalyticsBody").then(m => ({ default: m.HelperAnalyticsBody })));
const PaymentTab = lazy(() => import("@/components/PaymentTab").then(m => ({ default: m.PaymentTab })));

/**
 * Quiet in-page section rule. Deliberately NOT a second header: the merged
 * tab has exactly one ProfileTabHeader (title + back button) at the top, and
 * three stacked panels each carrying its own header is precisely the shape
 * the owner rejected. This is a label on a hairline — enough to say where one
 * section ends, not enough to read as another screen.
 */
function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span
        className="font-serif italic uppercase text-ds-9 shrink-0"
        style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
      >
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
    </div>
  );
}

export function EarningsTab({ earningsJobs, tips, loading, onBack, helperId, helperName }: EarningsTabProps) {
  const navigate = useNavigate();
  const { profile } = useCurrentUser();
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Payout setup is a section of this screen, not a tab of its own — the
  // wallet's "Payout settings" affordances scroll to it.
  const payoutSectionRef = useRef<HTMLElement | null>(null);
  const scrollToPayout = () => {
    payoutSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Instant Payout comes with ANY paid membership — Basic and up (see
  // TIER_PERKS.basic). Free helpers see a paywall when they tap Cash out.
  // Subscription must be active (not expired) to count; a NULL expiry on a
  // paid tier means "no scheduled end" and counts as active — the same
  // convention tierFeePercent uses, so the gate and the fee rate can never
  // disagree about whether a membership is live.
  const subTier = (profile?.subscription_tier ?? "free") as string;
  const subExp = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
  const subActive = subExp ? subExp > new Date() : true;
  // Fee % to apply when a job row's helper_fee_percent is null (legacy row
  // pre-dating the column). Derive it from the helper's own subscription
  // tier — same ladder /analytics and /work-record use — so a Free helper's
  // net renders at 12%, NOT the historical flat-10 fallback that made this
  // tab disagree with every other earnings surface. A populated per-job
  // column still wins (it's the fee actually charged on that payout).
  const helperFeeFallbackPct = tierFeePercent(subTier, profile?.subscription_expires_at ?? null);
  const canUseInstantPayout = subActive && (subTier === "pro" || subTier === "elite" || subTier === "basic");
  // Pagination for the earnings-history list. Power helpers with 100+
  // completed jobs were rendering them all; this caps the initial render
  // at PAGE and grows by PAGE on each Load-more tap.
  const PAGE = 25;
  const [historyVisible, setHistoryVisible] = useState(PAGE);

  const { stripeData, stripeLoading, stripeError, ledgerError, payoutLedger, refreshing, handleRefresh } = useEarningsData(helperId);

  // ─── CSV EXPORT (1099 / Tax prep) ─────────────────────────
  const payoutYears = useMemo(() => {
    const years = new Set<number>();
    (stripeData?.payouts ?? []).forEach((p) => years.add(new Date(p.arrival_date * 1000).getFullYear()));
    const current = new Date().getFullYear();
    years.add(current);
    return Array.from(years).sort((a, b) => b - a);
  }, [stripeData]);

  const [exportYear, setExportYear] = useState<string>(String(new Date().getFullYear()));

  useEffect(() => {
    if (payoutYears.length && !payoutYears.includes(Number(exportYear))) {
      setExportYear(String(payoutYears[0]));
    }
  }, [payoutYears, exportYear]);

  const handleExportCSV = () => {
    const year = Number(exportYear);
    const { rows, csv } = buildPayoutsCsv(stripeData?.payouts ?? [], year);

    if (!rows.length) {
      toast({
        title: "No payouts to export",
        description: `No payouts found for ${year}.`,
      });
      return;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `helpr-payouts-${year}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Export ready",
      description: `${rows.length} payout${rows.length === 1 ? "" : "s"} exported for ${year}.`,
    });
  };

  const completedJobs = earningsJobs.filter((j) => j.status === "completed");
  const inProgressJobs = earningsJobs.filter((j) => j.status === "in_progress");
  // Take-home per job comes from the one shared definition in
  // `helperEarnings.ts`, which keeps this tab's long-standing behaviour: the
  // budget AND the urgent fee are collected from the poster ONCE and split
  // across a group job's roster (#114), so a group helper sees only their share
  // — shown == transferred.
  const totalEarnings = sumHelperTakeHomeDollars(completedJobs, helperFeeFallbackPct);
  // NET of the card fee, because that is what lands (R17). A tip covers its
  // own Stripe processing cost: create-payment retains exactly
  // stripeProcessingCostCents(tip) as the application fee, so the transfer is
  // tip − fee. Summing the gross overstated a $20 tip by 88¢ on the very tile
  // that tells a helpr what they earned.
  const totalTips = tips.reduce(
    (sum, t) => sum + (t.amount - stripeProcessingCostCents(Math.round(t.amount * 100)) / 100),
    0,
  );

  const availableTotal = (stripeData?.available ?? []).reduce((s, b) => s + b.amount, 0);
  const pendingTotal = (stripeData?.pending ?? []).reduce((s, b) => s + b.amount, 0);

  // Helper-milestone retention nudges — one-shot toasts at meaningful
  // job/earnings/streak thresholds. Pulls from stats already computed
  // above; the five-star streak is read from the React Query cache
  // populated by <HelperStreakBadge /> below. Closes #120.
  useHelperMilestones({
    helperId,
    completedJobCount: completedJobs.length,
    totalEarningsDollars: totalEarnings,
    // Gates whether a milestone is still worth celebrating. `earningsJobs`
    // arrives newest-first, so the first completed row is the latest
    // completion. `poster_completed_at` is the moment the job actually became
    // completed (the poster's approval is the terminal step); `updated_at` is
    // the fallback for older rows written before that column existed.
    lastCompletedAt:
      completedJobs[0]?.poster_completed_at ?? completedJobs[0]?.updated_at ?? null,
  });

  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // ─── 1099-K threshold awareness ───────────────────────────────
  // Once YTD payouts cross the FEDERAL gross threshold we surface a quiet,
  // dismissible banner pointing at the tax-export tool. Dismissal is
  // persisted per-user per-year via safeStorage so it doesn't nag once
  // acknowledged.
  //
  // The threshold is $20,000 (with 200+ transactions), from moneyLimits —
  // NOT the $600 this comment and the banner used to claim. That step-down
  // was repealed before it took effect, and the tax note at the bottom of
  // THIS SAME TAB, plus both Legal pages, always said $20,000. Gating on
  // gross alone is deliberate: it is the half of the AND we can measure from
  // payouts, and the banner only ever says a 1099-K "may" be coming.
  const ytdYear = new Date().getFullYear();
  const ytdPayoutsCents = (stripeData?.payouts ?? [])
    .filter((p) => new Date(p.arrival_date * 1000).getFullYear() === ytdYear)
    .reduce((sum, p) => sum + p.amount, 0);
  const ytdPayoutsDollars = ytdPayoutsCents / 100;
  const banner1099Threshold = FORM_1099K_GROSS_THRESHOLD_DOLLARS;
  const bannerKey = `helpr_1099k_banner_dismissed_${helperId}_${ytdYear}`;
  const [banner1099Dismissed, setBanner1099Dismissed] = useState<boolean>(() => {
    try {
      return safeStorage.getItem(bannerKey) === "1";
    } catch {
      return false;
    }
  });
  const show1099Banner =
    ytdPayoutsDollars >= banner1099Threshold && !banner1099Dismissed;
  const dismiss1099Banner = () => {
    setBanner1099Dismissed(true);
    try {
      safeStorage.setItem(bannerKey, "1");
    } catch { /* best-effort */ }
  };

  // Note: the "Last payout · Next expected" summary lives in
  // PaymentTab now (#7), driven off the payout_transfers ledger so
  // it's reachable directly from the Payment settings surface.

  const payoutSection = (
    <section ref={payoutSectionRef} className="scroll-mt-4 space-y-4">
      <SectionRule label="Payout & payments" />
      <Suspense fallback={null}>
        <PaymentTab earningsJobs={earningsJobs} totalEarnings={totalEarnings} />
      </Suspense>
    </section>
  );

  return (
    <div className="space-y-4">
      <ProfileTabHeader
        title="Earnings & Payouts"
        onBack={onBack}
        rightSlot={
          <EarningsToolsMenu
            onExportPdf={() => setExportDialogOpen(true)}
            onExportCsv={handleExportCSV}
            // Payout setup is a section of THIS screen now, so "Payout
            // settings" scrolls to it instead of navigating to a tab that no
            // longer has its own entry point.
            onNavigatePayment={scrollToPayout}
          />
        }
      />
      {/* Hidden controlled export dialog (PDF + CSV by date range) */}
      <EarningsExport
        helperId={helperId}
        helperName={helperName}
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        hideTrigger
      />

      {/* One-time "you got paid" celebration. Pulls from the
          payout_transfers ledger already loaded above, so no extra
          Supabase read. Suppression is per-device via safeStorage. */}
      <PayoutCelebration payouts={payoutLedger} />

      {/* Motivational pill — consecutive 5-star reviews. Self-hides
          below a 3-streak so it only appears when it actually means
          something. Sits above the forecast so the helper sees their
          "you're on a roll" cue before the projected total. */}
      {helperId && (
        <div className="flex">
          <HelperStreakBadge helperId={helperId} />
        </div>
      )}

      {/* NOT CONNECTED YET: the connect card is the page. Everything below it
          — the wallet, the goal, the charts, the ledger — is either empty or
          about money that cannot move until Stripe is set up, so the one thing
          a helpr can do sits directly under the forecast rather than eight
          sections down behind a card that only scrolls to it.
          `!stripeError` matters: a failed status fetch is NOT "not
          connected" — that state renders its own retry banner below. */}
      {!stripeLoading && !stripeError && !stripeData?.connected && payoutSection}

      {/* 1099-K banner — appears once YTD payouts cross the federal gross
          threshold (FORM_1099K_GROSS_THRESHOLD_DOLLARS). Quiet, dismissible
          per-user-per-year so it doesn't nag after the helper has seen it.
          Tapping the CTA opens the existing PDF tax-export dialog. */}
      {show1099Banner && (
        <ThresholdBanner
          ytdYear={ytdYear}
          onOpenExport={() => setExportDialogOpen(true)}
          onDismiss={dismiss1099Banner}
        />
      )}

      {/* ─── YOUR MONEY ─── */}
      <SectionRule label="Your money" />
      <section className="space-y-3">
        {/* Payout data failed to load — say so, with a Retry. Without this
            the tab silently rendered the "not connected" journey to a
            connected helper whenever stripe-payouts hiccuped. */}
        {(stripeError || ledgerError) && !stripeLoading && (
          <ErrorState
            variant="inline"
            title="We couldn't load your payout data."
            body="Your money is safe — we just couldn't reach Stripe. Tap Try again."
            onRetry={handleRefresh}
            retryDisabled={refreshing}
          />
        )}
        {/* Wallet card (Available + Pending side-by-side).
            NOT RENDERED UNTIL STRIPE IS CONNECTED. Its disconnected state was
            a second "Set up Payouts" card — the first thing on the page —
            whose button did nothing but scroll down to the Payout & payments
            section, which is a card that says the same sentence with the
            button that actually starts Stripe onboarding. Two cards, one job,
            one of them a signpost to the other (owner: "needs a full upgrade
            and polish alot of the same info").

            A helpr who has not connected does not have a wallet, so the
            honest page for them has no wallet card. The Payout & payments
            section moves up to just under the forecast in that state (see
            below) so the connect CTA is still the first thing they can act
            on. */}
        {stripeLoading ? (
          /* Wallet-shaped skeleton — owned here (not inside WalletCard)
             because the card itself only ever renders connected+loaded. */
          <div className="rounded-2xl liquid-glass p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-7 w-24 rounded" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-7 w-24 rounded" />
              </div>
            </div>
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ) : stripeData?.connected && (
        <WalletCard
          stripeData={stripeData}
          refreshing={refreshing}
          availableTotal={availableTotal}
          pendingTotal={pendingTotal}
          canUseInstantPayout={canUseInstantPayout}
          onRefresh={handleRefresh}
          onCashOut={() => setPayoutDialogOpen(true)}
          onUpgrade={() => setUpgradeOpen(true)}
        />
        )}

        {/* Compact secondary stats — 3-up tiny tiles */}
        {!loading && (
          <div className="grid grid-cols-3 gap-2">
            {[
              /* NET IS TAKE-HOME, so it formats EXACT (format.ts: "NOT for the
                 helper's net take-home… Take-home surfaces use
                 `formatPriceExact`"). Rounded, this tile said "$229" while the
                 payout ledger three sections below said "$228.80" for the same
                 single job — one payment, two numbers, on one screen. Tips are
                 money that moved too, so they take the same rule. */
              { icon: TrendingUp, label: "Net", value: `$${formatPriceExact(totalEarnings)}`, sub: `${completedJobs.length} job${completedJobs.length === 1 ? "" : "s"}` },
              { icon: Gift, label: "Tips", value: `$${formatPriceExact(totalTips)}`, sub: `${tips.length} tip${tips.length === 1 ? "" : "s"}` },
              { icon: Briefcase, label: "Active", value: String(inProgressJobs.length), sub: "in progress" },
            ].map(({ icon: Icon, label, value, sub }) => (
              <div key={label} className="rounded-ds-md liquid-glass px-3 py-3 transition-all hover:-translate-y-0.5">
                <div className="flex items-center gap-1 mb-1">
                  <Icon className="w-3 h-3 text-primary" />
                  <span className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
                    {label}
                  </span>
                </div>
                <p className="font-display italic font-bold tabular-nums leading-none text-ds-18" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                  {value}
                </p>
                <p className="font-serif italic mt-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {sub}
                </p>
              </div>
            ))}
          </div>
        )}

      </section>

      {/* ─── COMING UP ────────────────────────────────────────────
          The three forward-looking things, together. They used to be
          scattered: the forecast above the connect card, the week strip
          four blocks below it, and the goal buried inside the wallet
          section — so "what am I about to earn" was answered in three
          places a reader had to find. */}
      <SectionRule label="Coming up" />
      {/* Forward-looking "Projected by Sunday" card. Sums net take across
          accepted/in-progress jobs whose date_needed falls in the current
          week. Only renders for approved helpers — pre-onboarding helpers
          have no earnings yet so a $0 forecast is just noise. Placed at
          the very top of the tab so the helper sees their pipeline before
          the historical ledger. */}
      <EarningsForecastCard
        helperId={helperId}
        enabled={profile?.approval_status === "approved"}
        feeFallbackPercent={helperFeeFallbackPct}
      />

      {/* "Next 7 days" upcoming-jobs strip — pairs with the dollar
          forecast above to show the helper *which* jobs make up the
          projection. Gated behind Stripe-connected so pre-onboarded
          helpers (who can't accept jobs yet) don't see an empty week.
          Closes #130. */}
      <HelperScheduleStrip
        helperId={helperId}
        enabled={
          profile?.approval_status === "approved" && !!stripeData?.connected
        }
      />

      {/* Monthly earnings goal — the only control for it in the app
          (/analytics carried a second one; removed). localStorage-backed,
          so no DB migration needed. */}
      {!loading && (
        <MonthlyGoalCard
          completedJobs={completedJobs.map((j) => ({
            // prefer helper_completed_at so the month bucket matches when
            // the job was actually done, not when it was posted
            created_at: j.helper_completed_at ?? j.created_at,
            // Same shared take-home definition (and same group split) as the
            // tab total above, so the goal ring and the Total tile agree.
            netPayout: helperTakeHomeDollars(j, helperFeeFallbackPct),
          }))}
        />
      )}


      {/* ─── HISTORY ──────────────────────────────────────────────
          THREE lists of past money used to sit in a row with nothing
          separating them — Stripe's payout history inside the wallet block,
          the per-transfer ledger, and the per-job earnings list — each with a
          different source and no label saying which was which. They are one
          section now, ordered widest to narrowest: what landed in the bank,
          then each transfer, then the jobs behind them. */}
      <SectionRule label="History" />

{/* Payout history — inline year picker, no big empty box */}
      {stripeData?.connected && (
        <PayoutHistory
          stripeData={stripeData}
          exportYear={exportYear}
          onExportYearChange={setExportYear}
          payoutYears={payoutYears}
        />
      )}

      {/* ACTUAL PAYOUTS (from the payout_transfers ledger) */}
      {payoutLedger.length > 0 && (
        <RecentTransfers payoutLedger={payoutLedger} />
      )}

      {/* ─── EARNING HISTORY ─── */}
      <EarningHistory
        earningsJobs={earningsJobs}
        tips={tips}
        loading={loading}
        historyVisible={historyVisible}
        page={PAGE}
        onLoadMore={() => setHistoryVisible((n) => n + PAGE)}
        onBrowseJobs={() => navigate("/dashboard")}
        feeFallbackPct={helperFeeFallbackPct}
      />

      {/* ─── ANALYTICS ───────────────────────────────────────────────
          Was the standalone /analytics page ("Earnings & Analytics"). Same
          dashboard, rendered here as a section under a quiet rule instead of
          behind a second Profile row with a second header. */}
      {/* ─── INSIGHTS ─────────────────────────────────────────────
          The breakdown charts and the analytics dashboard are the same kind of
          thing — trends, not records — so they share one heading instead of
          the charts floating unlabelled above a rule that said "Analytics". */}
      <SectionRule label="Insights" />

      {/* PIE + YTD vs PRIOR-YTD compare ───────────────────
          Self-hides if there's no completed-job data. Sits between the
          payout history (the receipts) and the per-transfer ledger so
          the helper sees their high-level breakdown before drilling
          into individual transfers. */}
      <EarningsBreakdownCharts earningsJobs={earningsJobs} feeFallbackPercent={helperFeeFallbackPct} />

      <Suspense fallback={null}>
        <HelperAnalyticsBody />
      </Suspense>

      {/* ─── PAYOUT & PAYMENTS ───────────────────────────────────────
          Was the "payment" Profile tab. `onSeeEarnings` is deliberately not
          passed: its "See full breakdown →" link jumped to the Earnings tab,
          which is the very screen it is now sitting inside.

          Rendered at the BOTTOM once Stripe is connected — settings, read
          rarely — and near the TOP when it is not, because then it is the only
          thing on the page a helpr can act on and the whole screen is waiting
          on it. See `payoutSection` above. */}
      {stripeData?.connected && payoutSection}

      {/* Muted legal/tax disclosure — bottom of page */}
      <p className="text-ds-11 text-muted-foreground/80 leading-relaxed pt-2 flex gap-1.5">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          <strong className="text-muted-foreground">Tax reporting:</strong> The IRS requires a Form 1099-K for Helprs who exceed {form1099kGrossLabel()} in gross payments and {FORM_1099K_TRANSACTION_THRESHOLD} transactions in a calendar year — a federal filing, not a Louisiana one. Stripe issues these automatically — no action needed.
        </span>
      </p>

      <ProUpgradeSheet
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        icon={Zap}
        title="Cash out instantly."
        body="Skip the 1–2 business day wait. Subscribed Helprs can route earnings to a debit card in about 30 minutes."
        perks={[
          "Instant payouts to debit card (~30 min)",
          // Derived from the instant-payout authority, never hand-typed. This
          // line used to read "Stripe's standard 3% + $1 fee applies" — a fee
          // that is neither Stripe's nor charged: instant payout is a flat
          // percent of the amount cashed out with NO fixed add-on, and at the
          // $25 floor the invented "+ $1" more than doubled the real fee
          // ($1.75 quoted vs $0.75 charged).
          `${instantPayoutFeeLabel()} per instant cash-out · ${instantPayoutMinLabel()} minimum`,
          "Plus every other subscriber perk on your plan",
        ]}
        // Basic unlocks instant payouts (TIER_PERKS.basic) — the paywall
        // names the CHEAPEST tier that actually opens the gate, not Pro.
        requiredTier="basic"
      />

      <InstantPayoutDialog
        open={payoutDialogOpen}
        onOpenChange={setPayoutDialogOpen}
        onSuccess={handleRefresh}
      />
    </div>
  );
}
