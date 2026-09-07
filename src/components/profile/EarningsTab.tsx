import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Info } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { instantPayoutFeeLabel, instantPayoutMinLabel } from "@/lib/instantPayoutFee";
import {
  FORM_1099K_GROSS_THRESHOLD_DOLLARS,
  FORM_1099K_TRANSACTION_THRESHOLD,
  form1099kGrossLabel,
} from "@/lib/moneyLimits";
import { helperTakeHomeDollars, sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import { stripeProcessingCostCents } from "@/lib/stripeFees";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { toast } from "sonner";
import { EarningsExport } from "@/components/EarningsExport";
import InstantPayoutDialog from "@/components/InstantPayoutDialog";
import ProUpgradeSheet from "@/components/ProUpgradeSheet";
import { safeStorage } from "@/lib/safeStorage";
import { saveOrShareFile } from "@/lib/fileExport";
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
import {
  buildPayoutsCsv,
  completedWithin,
  isAwaitingTransfer,
  isEarnedJob,
  rangeStartMs,
} from "@/components/profile/earningsTab/earningsTabHelpers";
import { useEarningsData } from "@/components/profile/earningsTab/useEarningsData";
import { EarningsToolsMenu } from "@/components/profile/earningsTab/EarningsToolsMenu";
import { EarningsViewSwitcher, type EarningsView } from "@/components/profile/earningsTab/EarningsViewSwitcher";
import { type EarningsRange } from "@/components/profile/earningsTab/EarningsRangeToggle";
import { EarningsSummaryCard } from "@/components/profile/earningsTab/EarningsSummaryCard";
import { ThresholdBanner } from "@/components/profile/earningsTab/ThresholdBanner";
import { WalletCard } from "@/components/profile/earningsTab/WalletCard";
import { PayoutHistory } from "@/components/profile/earningsTab/PayoutHistory";
import { RecentTransfers } from "@/components/profile/earningsTab/RecentTransfers";
import { EarningHistory } from "@/components/profile/earningsTab/EarningHistory";
// MERGED IN 2026-08-19 (owner request, stated three times): "My earnings",
// "Earnings & Analytics" (/analytics) and "Payout & Payments" were three
// separate Profile entry points onto three screens about the same subject —
// what you earned, what it says about your work, and where the money lands.
// They are now ONE screen: this tab, with the payout setup as a section of it
// rather than a destination of its own. Code-split because it isn't needed
// for the first paint of the wallet.
//
// The former "Insights" content (HelperAnalyticsBody — an Activity Trend
// chart plus a grid of PRO-locked, non-functional teaser cards: earnings by
// month, best categories, best days, success rate, profile views, repeat
// hire, ratings & reviews) was removed 2026-08-30. None of it was wired to a
// real Pro feature; it only ever showed a lock icon and an upgrade CTA. The
// Insights view now shows the real, unlocked breakdown charts only.
const PaymentTab = lazy(() => import("@/components/PaymentTab").then(m => ({ default: m.PaymentTab })));

/**
 * Quiet in-page section rule. Deliberately NOT a second header: the merged
 * tab has exactly one ProfileTabHeader (title + back button) at the top, and
 * three stacked panels each carrying its own header is precisely the shape
 * the owner rejected. The small-caps label that used to sit on this hairline
 * was removed at the owner's direction (2026-08-27) — the rule alone now
 * separates sections, so this takes no props.
 */
function SectionRule() {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="flex-1 h-px" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
    </div>
  );
}

export function EarningsTab({ earningsJobs, tips, loading, onBack, helperId, helperName }: EarningsTabProps) {
  const navigate = useNavigate();
  const { profile } = useCurrentUser();
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
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
  const canUseInstantPayout = subActive && (subTier === "basic" || subTier === "pro" || subTier === "elite");
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

  const handleExportCSV = async () => {
    const year = Number(exportYear);
    const { rows, csv } = buildPayoutsCsv(stripeData?.payouts ?? [], year);

    if (!rows.length) {
      toast("No payouts to export", { description: `No payouts found for ${year}.` });
      return;
    }

    // Was `URL.createObjectURL` + `<a download>` + click, inline here. That
    // idiom is a silent no-op in WKWebView — the tap did nothing at all in the
    // shipped app (owner: "Download csv pdf etc does not work"). saveOrShareFile
    // keeps the anchor on web and routes native through the OS share sheet, and
    // toasts on every outcome. See src/lib/fileExport.ts.
    // saveOrShareFile owns the messaging now, so the old "Export ready" toast
    // is gone rather than doubled up. (Note: it never actually rendered —
    // toastPolicy.ts suppresses every non-actionable `toast.success` app-wide.
    // On web the browser's own download is the confirmation; what matters is
    // that a FAILURE is now stated, which is the half that was missing.)
    await saveOrShareFile({
      blob: new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      filename: `helpr-payouts-${year}.csv`,
      label: `your ${year} payouts CSV`,
    });
  };

  // EARNED, not merely "completed". `status === "completed"` was the whole
  // test until 2026-09-06, and it counts a job whose money was refunded to the
  // poster or charged back by the card issuer — both reachable on a completed
  // job, both still `completed` afterwards. `isEarnedJob` adds the
  // payment_status half: money committed (`payout_pending`) or moved
  // (`released`). See the state table in earningsTabHelpers.ts.
  const completedJobs = earningsJobs.filter(isEarnedJob);
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
  const sumNetTipDollars = (rows: { amount: number }[]) =>
    rows.reduce(
      (sum, t) => sum + (t.amount - stripeProcessingCostCents(Math.round(t.amount * 100)) / 100),
      0,
    );

  const availableTotal = (stripeData?.available ?? []).reduce((s, b) => s + b.amount, 0);
  const pendingTotal = (stripeData?.pending ?? []).reduce((s, b) => s + b.amount, 0);

  // Money the poster has ALREADY approved but that Stripe has not been told
  // about yet. auto-release-payment flips the job to `payout_pending` with a
  // `payout_scheduled_at` PAYOUT_HOLD_HOURS out, and only then does
  // release-payout create the actual transfer — so for that whole window the
  // amount sits on the PLATFORM's balance and appears in neither Stripe bucket
  // the wallet reads. From the helper's chair a job they were paid for simply
  // vanished: approved, and then in neither Available nor Pending.
  //
  // This line now renders in <EarningsSummaryCard />, NOT in <WalletCard />
  // where it used to live. WalletCard only mounts once Stripe is connected, so
  // the one state that most needs explaining — "I finished a job, where is my
  // money" — was silent for exactly the helper who has not finished payout
  // setup and has the most reason to ask.
  const releasingJobs = earningsJobs.filter(isAwaitingTransfer);
  const releasingCents = Math.round(
    sumHelperTakeHomeDollars(releasingJobs, helperFeeFallbackPct) * 100,
  );
  // Soonest scheduled arrival, for the "reaches your wallet <date>" copy.
  const releasingAt =
    releasingJobs
      .map((j) => j.payout_scheduled_at)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;

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
  /* Which quarter of the tab is on screen. See EarningsViewSwitcher for why
     the four groups became a switch rather than four hairline rules. Opens on
     "money" — the wallet is what a helpr comes here for. */
  const [view, setView] = useState<EarningsView>("money");
  /* Which slice of time the Money view's numbers cover. Opens on "lifetime" —
     the wallet balance is always lifetime; selecting "week" or "month" opts
     into the forward-looking cards those ranges fold in (see EarningsRangeToggle). */
  const [range, setRange] = useState<EarningsRange>("lifetime");

  /* THE FIGURES <EarningsSummaryCard /> ACTUALLY PRINTS, scoped to `range`.
     Until 2026-08-31 the range toggle scoped nothing: the headline total, the
     job count and the tips figure were lifetime under every option, so "This
     Year" was a no-op and "This Week" printed a lifetime total under a label
     that said otherwise. `rangeStartMs` buckets by completion timestamp the
     same way PaymentTab's poster-spend toggle does, so "This Week" means one
     week on this screen, not two.
     Lifetime `totalEarnings` is still what PaymentTab and the milestone hook
     read — those are lifetime facts and must not follow the toggle. */
  const rangeSince = rangeStartMs(range);
  const rangeJobs = completedWithin(completedJobs, rangeSince);
  const rangeTipRows =
    rangeSince === null
      ? tips
      : tips.filter((t) => new Date(t.created_at).getTime() >= rangeSince);
  const rangeEarnings = sumHelperTakeHomeDollars(rangeJobs, helperFeeFallbackPct);
  const rangeTips = sumNetTipDollars(rangeTipRows);

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

  /* The payout-setup block. It renders in TWO places on purpose:
     - inline near the top when Stripe is NOT connected, because then it is the
       only thing on the screen a helpr can act on and every other view is
       either empty or about money that cannot move yet;
     - as the "Payouts" view once connected — settings, read rarely.
     No SectionRule and no scroll ref any more: a view does not need a hairline
     to separate it from what is no longer on screen, and "Payout settings"
     selects the view instead of scrolling a long column to reach it. */
  const payoutSection = (
    <section className="space-y-4">
      <Suspense fallback={null}>
        <PaymentTab totalEarnings={totalEarnings} />
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
            // Payout setup is a VIEW of this screen now, so "Payout settings"
            // selects it rather than scrolling down a 25-card column to reach
            // it (or navigating to a tab that no longer has its own entry).
            onNavigatePayment={() => setView("payouts")}
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

      {/* THE ORPHANED "$357 / total earned" USED TO SIT HERE (owner,
          2026-08-30: "357 is oddly placed. Fix it.") — a bare <p> on the page
          background between the poster-spend card above and the tab bar below,
          the only figure on the screen without a container. It has moved into
          <EarningsSummaryCard /> at the top of the Money view, which is also
          where the duplicate of it lived: the same `totalEarnings` value was
          printed here AND as the first of three small tiles further down, one
          number stated twice on one screen. One statement now, in a card whose
          anatomy matches the wallet directly beneath it.

          The date-range toggle used to sit here too, full-width and attached to
          nothing, a screen above PaymentTab's near-identical poster-spend pill.
          It now renders inside the card whose figures it scopes, and only in
          the Money view — it governs nothing in History, Insights or Payouts,
          where it was previously still on screen and inert. */}

      {/* ONE VIEW AT A TIME. Everything above this line is either global
          (header, celebration) or urgent (the 1099 banner, the connect card),
          so it stays put; the four groups below take turns. */}
      <EarningsViewSwitcher value={view} onChange={setView} />

      {/* ─── MONEY ─── what I have, and what is coming ─── */}
      {view === "money" && (
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

        {/* EARNED — the first card of the Money view, and the only place on
            this screen that states take-home. Sits above the wallet on
            purpose: "what have I made" is the question a helpr opens this tab
            with, and "where is that money right now" is the follow-up. It also
            renders for a helpr who has NOT connected Stripe (who has earnings
            but no wallet), which is exactly the state the owner screenshotted. */}
        <EarningsSummaryCard
          loading={loading}
          range={range}
          onRangeChange={setRange}
          earnedDollars={rangeEarnings}
          jobCount={rangeJobs.length}
          tipsDollars={rangeTips}
          tipCount={rangeTipRows.length}
          inProgressCount={inProgressJobs.length}
          releasingCents={releasingCents}
          releasingAt={releasingAt}
        />

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

        {/* THE 3-UP TILE ROW (Net / Tips / Active) WAS HERE. Its "Net" tile
            printed `totalEarnings` — the identical value the orphaned headline
            above the tab bar was already printing, from the same variable
            through the same formatter. One figure, twice, on one screen. All
            three facts now live in <EarningsSummaryCard /> above, where the
            money ones follow the range toggle and the live job count is stated
            separately as "right now" rather than sharing a scope it never had. */}

      {/* ─── COMING UP ────────────────────────────────────────────
          Forward-looking content now lives BEHIND the date-range toggle
          above, not permanently on the page (owner: the Sunday projection
          and the monthly-goal streak card were always-visible even for a
          helpr who opened the tab to check their lifetime total, which two
          of these three cards have nothing to do with). Selecting "This
          Week" or "This Month" opts in; "Lifetime"/"This Year" show neither.

          The "Next 7 days" schedule strip stays unconditional — it isn't a
          projection card, it's the roster of what's already on the
          calendar, which is relevant regardless of range. */}
      {range === "week" && (
        <>
          <SectionRule />
          {/* "Projected by Sunday" card. Sums net take across
              accepted/in-progress jobs whose date_needed falls in the current
              week. Only renders for approved helpers — pre-onboarding helpers
              have no earnings yet so a $0 forecast is just noise. */}
          <EarningsForecastCard
            helperId={helperId}
            enabled={profile?.approval_status === "approved"}
            feeFallbackPercent={helperFeeFallbackPct}
          />
        </>
      )}

      {/* "Next 7 days" upcoming-jobs strip. Gated behind Stripe-connected so
          pre-onboarded helpers (who can't accept jobs yet) don't see an
          empty week. Closes #130. */}
      <HelperScheduleStrip
        helperId={helperId}
        enabled={
          profile?.approval_status === "approved" && !!stripeData?.connected
        }
      />

      {range === "month" && (
        <>
          <SectionRule />
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
        </>
      )}

      </section>
      )}

      {/* ─── HISTORY ──────────────────────────────────────────────
          THREE lists of past money used to sit in a row with nothing
          separating them — Stripe's payout history inside the wallet block,
          the per-transfer ledger, and the per-job earnings list — each with a
          different source and no label saying which was which. They are one
          view now, ordered widest to narrowest: what landed in the bank, then
          each transfer, then the jobs behind them.

          This is the longest region on an active helpr by a wide margin — up
          to 25 job rows plus both ledgers — and it is also the one nobody
          reads on a normal visit. Behind its own tab it costs nothing until
          asked for. */}
      {view === "history" && (
      <section className="space-y-4">

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

      </section>
      )}

      {/* ─── INSIGHTS ─────────────────────────────────────────────
          Just the real, unlocked breakdown charts. This view used to also
          render HelperAnalyticsBody — an "Activity Trend" chart plus a grid
          of PRO-locked teaser cards (earnings by month, best categories,
          best days, success rate, profile views, repeat hire, ratings &
          reviews) that were never wired to an actual Pro feature; they only
          ever showed a lock icon and an upgrade CTA. Removed 2026-08-30
          rather than kept as permanent non-functional furniture. */}
      {view === "insights" && (
      <section className="space-y-4">
      <p className="text-ds-11 px-1" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>More insights with every completed job</p>

      {/* PIE + YTD vs PRIOR-YTD compare ───────────────────
          Self-hides if there's no completed-job data. */}
      <EarningsBreakdownCharts earningsJobs={earningsJobs} feeFallbackPercent={helperFeeFallbackPct} />

      {/* The ONE entry point to /analytics (Advanced Analytics, built
          2026-09-01 to satisfy the Pro bullet that previously pointed at
          nothing). It is a link, not a locked teaser card: the charts above
          stay free for everyone, and the page it opens decides for itself —
          server-side — whether this helper gets the dashboard or the upgrade
          offer. Deliberately not gated here; a client-side gate on a paid
          perk is the bug this feature was built to stop repeating, and a
          hidden link would leave the pricing bullet undiscoverable. */}
      <button
        type="button"
        onClick={() => navigate("/profile?tab=analytics")}
        className="w-full rounded-2xl liquid-glass px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
            Advanced Analytics
          </span>
          <span className="block text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
            Where your money comes from, and when work gets posted near you
          </span>
        </span>
        <span className="text-ds-13 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.5)" }} aria-hidden="true">
          &rsaquo;
        </span>
      </button>
      </section>
      )}

      {/* ─── PAYOUTS ─────────────────────────────────────────────────
          Was the "payment" Profile tab, then the last block of a very long
          column. `onSeeEarnings` is deliberately not passed: its "See full
          breakdown →" link jumped to the Earnings tab, which is the very
          screen it is sitting inside.

          Only when Stripe IS connected — a helpr who has not connected gets
          this same block inline near the top instead (see `payoutSection`),
          because then it is the whole screen's business and should not be
          hidden behind a tab. */}
      {view === "payouts" && stripeData?.connected && payoutSection}

      {/* The tax note belongs to the payout view, not to whatever happens to
          be last on the page. It used to sit under the analytics dashboard,
          restating the 1099-K threshold the banner above had already named. */}
      {view === "payouts" && (

      <p className="text-ds-11 text-muted-foreground/80 leading-relaxed pt-2 flex gap-1.5">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          <strong className="text-muted-foreground">Tax reporting:</strong> The IRS requires a Form 1099-K for Helprs who exceed {form1099kGrossLabel()} in gross payments and {FORM_1099K_TRANSACTION_THRESHOLD} transactions in a calendar year — a federal filing, not a Louisiana one. Stripe issues these automatically — no action needed.
        </span>
      </p>
      )}

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
