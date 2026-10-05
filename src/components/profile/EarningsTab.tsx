import { lazy, Suspense, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Info } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { instantPayoutFeeLabel, instantPayoutMinLabel } from "@/lib/instantPayoutFee";
import {
  FORM_1099K_GROSS_THRESHOLD_DOLLARS,
} from "@/lib/moneyLimits";
import { helperTakeHomeDollars, sumHelperTakeHomeDollars, sumHelperTipDollars } from "@/lib/helperEarnings";
import { tierFeePercent, profileHasPerk } from "@/lib/subscriptionTiers";
import { EarningsExport } from "@/components/EarningsExport";
import InstantPayoutDialog from "@/components/InstantPayoutDialog";
import ProUpgradeSheet from "@/components/ProUpgradeSheet";
import { safeStorage } from "@/lib/safeStorage";
import { EarningsBreakdownCharts } from "@/components/profile/EarningsBreakdownCharts";
import { PayoutCelebration } from "@/components/wallet/PayoutCelebration";
import { EarningsForecastCard } from "@/components/profile/EarningsForecastCard";
import { EarningsPageSkeleton, EarningsPayoutSetupSkeleton } from "@/components/profile/earningsTab/EarningsPageSkeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelperStreakBadge, useHelperStreak } from "@/components/profile/HelperStreakBadge";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { MonthlyGoalCard } from "@/components/profile/MonthlyGoalCard";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { useHelperMilestones } from "@/hooks/useHelperMilestones";
import type { EarningsTabProps } from "@/components/profile/earningsTab/types";
import {
  completedWithin,
  isAwaitingTransfer,
  firstPayoutFeeDueFrom,
  isEarnedJob,
  rangeStartMs,
} from "@/components/profile/earningsTab/earningsTabHelpers";
import { useEarningsData } from "@/components/profile/earningsTab/useEarningsData";
import { usePayoutsCsvExport } from "@/components/profile/earningsTab/usePayoutsCsvExport";
import { EarningsToolsMenu } from "@/components/profile/earningsTab/EarningsToolsMenu";
import { type EarningsRange } from "@/components/profile/earningsTab/EarningsRangeToggle";
import { EarningsSummaryCard } from "@/components/profile/earningsTab/EarningsSummaryCard";
import { ThresholdBanner } from "@/components/profile/earningsTab/ThresholdBanner";
import { WalletCard } from "@/components/profile/earningsTab/WalletCard";
import { PayoutHistory } from "@/components/profile/earningsTab/PayoutHistory";
import { EarningHistory } from "@/components/profile/earningsTab/EarningHistory";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
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
// breakdown section now shows the real, unlocked charts only.
//
// SPLIT 2026-09-11 into two views (Earnings / Payouts), then put back on ONE
// page (Q1177, owner 2026-10-01: the split was "messy and repeat itself a lot",
// payouts, transfers and jobs each listed twice across the two views). One
// page, top to bottom: wallet, the earned summary, ONE payouts list (jobs with
// their transfers, bank payouts), the insights, then the bank account
// (`PaymentTab`) as the floor.
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
  const streakState = useHelperStreak(helperId);
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Instant Payout comes with ANY paid membership — Basic and up (see
  // TIER_PERKS.basic). Free helpers see a paywall when they tap Cash out.
  // Subscription must be active (not expired) to count; a NULL expiry on a
  // paid tier means "no scheduled end" and counts as active — the same
  // convention tierFeePercent uses, so the gate and the fee rate can never
  // disagree about whether a membership is live.
  const subTier = (profile?.subscription_tier ?? "free") as string;
  // Fee % to apply when a job row's helper_fee_percent is null (legacy row
  // pre-dating the column). Derive it from the helper's own subscription
  // tier — same ladder /analytics and /work-record use — so a Free helper's
  // net renders at 12%, NOT the historical flat-10 fallback that made this
  // tab disagree with every other earnings surface. A populated per-job
  // column still wins (it's the fee actually charged on that payout).
  const helperFeeFallbackPct = tierFeePercent(subTier, profile?.subscription_expires_at ?? null);
  // Q753: the one-time setup fee still due; it comes off the totals ONCE.
  const firstPayoutFee = useFirstPayoutFeeDollars();
  // CC-019: this was a hand-typed `basic || pro || elite` list, and the
  // instant-payout edge function held a second copy of it. Plus was missing
  // from both, so a paying Plus member saw no button and, if they reached the
  // endpoint anyway, a 403 telling them to downgrade. Both sides now call the
  // same `profileHasPerk`, which also owns the expiry convention (null expiry
  // on a paid tier = active).
  const canUseInstantPayout = profileHasPerk(
    profile?.subscription_tier,
    profile?.subscription_expires_at,
    "instantPayout",
  );
  // Pagination for the earnings-history list. Power helpers with 100+
  // completed jobs were rendering them all; this caps the initial render
  // at PAGE and grows by PAGE on each Load-more tap.
  const PAGE = 25;
  const [historyVisible, setHistoryVisible] = useState(PAGE);

  const { stripeData, stripeLoading, stripeError, ledgerError, ledgerPending, payoutLedger, refreshing, handleRefresh } = useEarningsData(helperId);

  // ONE PAINT under the header (Q169, Q2007). The connect card (PaymentTab,
  // for a helpr without Stripe) sits at the top and, once connected, the bank
  // account (also PaymentTab) at the bottom; the card used to land late and
  // grow, shoving everything 68->519px down (page-settle CLS 0.54 at 375). So
  // the skeleton holds until Stripe has answered AND PaymentTab's own data is
  // in, in either slot. Stripe is PRIMARY, not capped secondary data: both
  // reads go edge fn -> Stripe and routinely outlast ARRIVAL_CAP_MS (capped, CI
  // measured CLS 0.2254 at 1440). Data or error both count as settled, so
  // retries bound the wait. The streak badge and the transfer ledger (its rows
  // sit INSIDE the payouts list's job cards) are capped secondary data.
  const [paymentSettled, setPaymentSettled] = useState(false);
  const markPaymentSettled = useCallback(() => setPaymentSettled(true), []);
  const stripeSettled = !stripeLoading && (!!stripeError || paymentSettled);
  const pageReady = useArrivalGate(!loading && stripeSettled, streakState.settled && !ledgerPending);

  const { payoutYears, exportYear, setExportYear, handleExportCSV } = usePayoutsCsvExport(stripeData?.payouts);

  // EARNED, not merely "completed" (the test until 2026-09-06): a job refunded
  // to the poster or charged back stays `completed` forever. `isEarnedJob` adds
  // the payment_status half: money committed (`payout_pending`) or moved
  // (`released`). See the state table in earningsTabHelpers.ts.
  const completedJobs = earningsJobs.filter(isEarnedJob);
  const inProgressJobs = earningsJobs.filter((j) => j.status === "in_progress");
  // Take-home per job: helperEarnings.ts (a group helper sees only their share,
  // #114). The one-time fee comes off a total only while a payout is still to come (Q753).
  const totalEarnings = sumHelperTakeHomeDollars(completedJobs, helperFeeFallbackPct, firstPayoutFeeDueFrom(completedJobs, firstPayoutFee));

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
    sumHelperTakeHomeDollars(releasingJobs, helperFeeFallbackPct, firstPayoutFeeDueFrom(releasingJobs, firstPayoutFee)) * 100,
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
  /* Which slice of time the summary's numbers cover. Opens on "lifetime" —
     the wallet balance is always lifetime; selecting "week" or "month" opts
     into the forward-looking cards those ranges fold in (see EarningsRangeToggle). */
  const [range, setRange] = useState<EarningsRange>("lifetime");

  /* THE FIGURES <EarningsSummaryCard /> ACTUALLY PRINTS, scoped to `range`.
     Until 2026-08-31 the range toggle scoped nothing: the headline total, the
     job count and the tips figure were lifetime under every option, so "This
     Year" was a no-op and "This Week" printed a lifetime total under a label
     that said otherwise. `rangeStartMs` buckets by completion timestamp, so
     "This Week" means one week.
     Lifetime `totalEarnings` is still what PaymentTab and the milestone hook
     read — those are lifetime facts and must not follow the toggle. */
  const rangeSince = rangeStartMs(range);
  const rangeJobs = completedWithin(completedJobs, rangeSince);
  const rangeTipRows =
    rangeSince === null
      ? tips
      : tips.filter((t) => new Date(t.created_at).getTime() >= rangeSince);
  const rangeEarnings = sumHelperTakeHomeDollars(rangeJobs, helperFeeFallbackPct, firstPayoutFeeDueFrom(rangeJobs, firstPayoutFee));
  // Tips land in full: the poster pays the card fee on top (ME-006).
  const rangeTips = sumHelperTipDollars(rangeTipRows);

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

  /* The bank-account block (PaymentTab). It renders in ONE of two places:
     - at the top when Stripe is NOT connected, because then it is the only
       thing on the screen a helpr can act on;
     - as the floor of the page once connected — the bank account, when the
       next payout is expected, and what the reader spent as a poster.
     Mounted in either slot as soon as Stripe answers, so its queries run, and
     hidden until `pageReady`. `id` is the "Payout settings" scroll target. */
  const payoutSection = (
    <section id="earnings-bank-account" className="space-y-4">
      <Suspense fallback={null}>
        <PaymentTab totalEarnings={totalEarnings} onSettled={markPaymentSettled} />
      </Suspense>
    </section>
  );
  const stripeAnswered = !stripeLoading && !stripeError;

  return (
    <ProfileTabBody>
      <ProfileTabHeader
        title="Earnings & Payouts"
        onBack={onBack}
        rightSlot={
          <EarningsToolsMenu
            onExportPdf={() => setExportDialogOpen(true)}
            onExportCsv={handleExportCSV}
            // The bank account is a section of this one page, so "Payout
            // settings" scrolls to it rather than navigating away.
            onNavigatePayment={() =>
              document.getElementById("earnings-bank-account")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
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
      {/* Floats OVER the page instead of sitting in the flow: it appears
          after the ledger loads and auto-dismisses, and in the flow both of
          those moments shoved the whole page down and back up (VN-3, measured
          as the last layout shift on a cold load). */}
      <div className="relative h-0 z-20">
        <div className="absolute inset-x-0 top-0">
          <PayoutCelebration payouts={payoutLedger} />
        </div>
      </div>

      {/* NOT CONNECTED YET: the connect card is the page; everything below it
          (wallet, goal, charts, ledger) is empty or about money that cannot
          move until Stripe is set up. `!stripeError` matters: a failed status
          fetch is NOT "not connected" (it has its own retry banner below).
          Mounted so its queries run, hidden until `pageReady`; until then, with
          no Stripe account on the profile row, its data-aware bones hold the
          slot (owner, 2026-10-03). */}
      {stripeAnswered && !stripeData?.connected && (
        <div hidden={!pageReady}>{payoutSection}</div>
      )}
      {!pageReady && !profile?.stripe_account_id && <EarningsPayoutSetupSkeleton />}

      {/* 1099-K banner — appears once YTD payouts cross the federal gross
          threshold (FORM_1099K_GROSS_THRESHOLD_DOLLARS). Quiet, dismissible
          per-user-per-year so it doesn't nag after the helper has seen it.
          Tapping the CTA opens the existing PDF tax-export dialog. Above the
          page's sections: it is not a section, it is an alert with a shelf
          life, and it self-dismisses permanently. */}
      {pageReady && show1099Banner && (
        <ThresholdBanner
          ytdYear={ytdYear}
          onOpenExport={() => setExportDialogOpen(true)}
          onDismiss={dismiss1099Banner}
        />
      )}

      {/* ONE PAGE (Q1177, owner 2026-10-01: the two-view split was "messy and
          repeat itself a lot"). Top to bottom: the wallet, the earned summary
          (with the week forecast / month goal under it), ONE payouts list, the
          insights, then the bank account and the tax note. Nothing renders
          piecemeal: until every source the page reads has settled, the whole
          page is ONE skeleton with the loaded layout (useArrivalGate). The
          section is mounted early, hidden, only so a connected helpr's bank
          account (PaymentTab, at the bottom) can load inside it. */}
      {!pageReady && <EarningsPageSkeleton withHeader={false} />}
      <section className="space-y-3" hidden={!pageReady}>
        {pageReady && (
          <>
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

            {/* Wallet card (Available + Pending side-by-side). NOT RENDERED
                UNTIL STRIPE IS CONNECTED: a helpr who has not connected does not
                have a wallet, so the honest page for them has no wallet card —
                they get the connect block at the top (owner: "needs a full
                upgrade and polish alot of the same info"). The gate holds until
                Stripe has answered, so there is no loading state here. */}
            {stripeData?.connected && (
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

            {helperId && (
              <div className="flex">
                <HelperStreakBadge helperId={helperId} />
              </div>
            )}

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

            {range === "week" && (
              <EarningsForecastCard
                helperId={helperId}
                // Was `approval_status === "approved"` (retired, Q205b). Every
                // account that reaches this tab has passed the only entry gate
                // (a confirmed email, ProtectedRoute), so "profile loaded" is
                // the whole condition.
                enabled={!!profile}
                feeFallbackPercent={helperFeeFallbackPct}
              />
            )}

            {range === "month" && (
              <MonthlyGoalCard
                completedJobs={completedJobs.map((j) => ({
                  // helper_completed_at so the month bucket matches when the
                  // job was done, not when it was posted
                  created_at: j.helper_completed_at ?? j.created_at,
                  netPayout: helperTakeHomeDollars(j, helperFeeFallbackPct),
                }))}
              />
            )}

            {/* ONE payouts list (see EarningHistory): unpaid work first, the
                bank payouts, then paid jobs with each ledger transfer inside
                the job it paid. It was three lists — "Earning history",
                "Payout history" and "Recent transfers" — on two views. */}
            <SectionRule />
            <EarningHistory
              earningsJobs={earningsJobs}
              tips={tips}
              loading={loading}
              historyVisible={historyVisible}
              page={PAGE}
              onLoadMore={() => setHistoryVisible((n) => n + PAGE)}
              onBrowseJobs={() => navigate("/home")}
              feeFallbackPct={helperFeeFallbackPct}
              firstPayoutFeeDollars={firstPayoutFeeDueFrom(completedJobs, firstPayoutFee)}
              payoutLedger={payoutLedger}
              bankPayouts={
                stripeData?.connected ? (
                  <PayoutHistory
                    stripeData={stripeData}
                    exportYear={exportYear}
                    onExportYearChange={setExportYear}
                    payoutYears={payoutYears}
                  />
                ) : undefined
              }
            />

            <SectionRule />
            {/* BOTH ROWS BELOW ARE olivewood/0.7 — subtitles and chevrons alike.
                The subtitles were 0.65 (4.24:1) and the `›` affordances 0.5
                (2.84:1), against a 4.5:1 AA floor. 0.7 is the lowest alpha on
                this token that clears (0.5 → 2.84, 0.65 → 4.24, 0.7 → 4.90) and
                it is already the app's quiet-ink tier. A disclosure arrow that
                is fainter than the text it discloses reads as disabled. */}
            <Collapsible>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="group w-full rounded-2xl liquid-glass px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                      More Insights
                    </span>
                    <span className="block text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                      Where your money comes from, by category and month
                    </span>
                  </span>
                  <span
                    className="text-ds-13 shrink-0 transition-transform group-data-[state=open]:rotate-90"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                    aria-hidden="true"
                  >
                    &rsaquo;
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <EarningsBreakdownCharts earningsJobs={earningsJobs} feeFallbackPercent={helperFeeFallbackPct} />
                {/* The ONE entry point to /analytics (Advanced Analytics). A
                    link, not a locked teaser: the page it opens decides
                    server-side whether this helper gets the dashboard or the
                    upgrade offer. */}
                <button
                  type="button"
                  onClick={() => navigate("/profile?tab=analytics")}
                  className="w-full rounded-2xl liquid-glass px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                      Advanced Analytics
                    </span>
                    <span className="block text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                      Trends over time, and when work gets posted near you
                    </span>
                  </span>
                  <span className="text-ds-13 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden="true">
                    &rsaquo;
                  </span>
                </button>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}

        {/* THE PAYOUT ACCOUNT, the floor of the page once connected. A helpr
            who has not connected gets this same block at the top instead.
            Mounted before `pageReady` (the section is hidden) so the page
            opens with it already filled. */}
        {stripeAnswered && stripeData?.connected && (
          <>
            {pageReady && <SectionRule />}
            {payoutSection}
          </>
        )}

        {/* The tax note closes the page, under the bank account it is about.

            IT NO LONGER STATES THE THRESHOLD (2026-09-06 rewrite). It read
            "exceed $20,000 in gross payments and 200 transactions" — a bare,
            undated number rendered as tax guidance. The federal 1099-K
            threshold has moved repeatedly (a $600 rule scheduled, deferred by
            the IRS twice, then repealed), so a typed number goes stale and a
            helper under the stated line concludes nothing is coming. The honest
            version says what we know and sends anyone who needs the current
            number to the IRS. The threshold constants stay in `moneyLimits.ts`
            because ThresholdBanner still needs a level to fire at. */}
        {pageReady && (
          <p className="text-ds-11 text-muted-foreground leading-relaxed pt-2 flex gap-1.5">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              <strong className="text-muted-foreground">Tax reporting:</strong> If your payments pass the federal Form 1099-K reporting thresholds for the year, Stripe issues the form automatically — no action needed on your side. It&rsquo;s a federal filing, not a Louisiana one. The thresholds have changed several times recently, so check{" "}
              <a
                href="https://www.irs.gov/businesses/understanding-your-form-1099-k"
                target="_blank"
                rel="noopener noreferrer"
                className="link-standard"
              >
                the IRS&rsquo;s own 1099-K guidance
              </a>{" "}
              for the current numbers, and talk to a tax professional about your situation.
            </span>
          </p>
        )}
      </section>

      <ProUpgradeSheet
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        icon={Zap}
        // Title Case, no full stop — the only popup title in the app that
        // was sentence-cased with a period, sitting one tap away from
        // "Cash Out Instantly" (InstantPayoutDialog). Named for what the
        // sheet does (unlock), not the feature it gates, so the two are
        // distinguishable when read aloud.
        title="Unlock Instant Cash Out"
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
    </ProfileTabBody>
  );
}
