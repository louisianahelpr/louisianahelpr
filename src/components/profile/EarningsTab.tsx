import { lazy, Suspense, useCallback, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Zap, Info } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { TAB_TITLES } from "@/pages/profile/types";
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
import { EarningsBankPayoutBones, EarningsPageSkeleton, EarningsPayoutSetupSkeleton, EarningsWalletBones } from "@/components/profile/earningsTab/EarningsPageSkeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelperStreakBadge, streakShows, useHelperStreak } from "@/components/profile/HelperStreakBadge";
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
  earnedDollarsWithLedger,
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
import { MoneyViewSwitcher, moneyViewFromSearch, type MoneyView } from "@/components/profile/earningsTab/MoneyViewSwitcher";
import { SpentSection } from "@/components/profile/earningsTab/SpentSection";
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
// SPLIT 2026-09-11 into two views (Earnings / Payouts), which listed the same
// money in both (owner, 2026-10-01: "messy and repeat itself a lot"). Since
// Q1177 the tab is "Money", split the other way (owner, 2026-10-04: "earning
// and payouts are the same. So do earning and spent instead"): EARNED (wallet,
// the earned summary, ONE payouts list with each transfer inside its job and
// the bank payouts, the insights, the bank account) and SPENT (SpentSection).
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

  // ONE PAINT for the page's OWN data (Q169): the earnings rows, then (capped)
  // the streak badge and the transfer ledger, whose rows sit INSIDE the
  // payouts list's job cards. The page does NOT wait for Stripe (owner,
  // 2026-10-04: "Don't wait for Stripe"): each Stripe-backed part — the
  // connect card, the wallet, the bank payouts, the bank account — holds its
  // own slot with its own bones until it lands. The connect card's bones stay
  // until PaymentTab reports its reads settled, so the card replaces them in
  // one swap instead of growing in place (the 68->519px shove of page-settle
  // CLS 0.54 at 375 was that card arriving late and growing).
  const [connectSettled, setConnectSettled] = useState(false);
  const markConnectSettled = useCallback(() => setConnectSettled(true), []);
  const pageReady = useArrivalGate(!loading, streakState.settled && !ledgerPending);
  const hasStripeAccount = !!profile?.stripe_account_id;
  const stripeAnswered = !stripeLoading && !stripeError;
  const showConnect = stripeAnswered && !stripeData?.connected;

  const { payoutYears, exportYear, setExportYear, handleExportCSV } = usePayoutsCsvExport(stripeData?.payouts);

  // EARNED, not merely "completed" (the test until 2026-09-06): a job refunded
  // to the poster or charged back stays `completed` forever. `isEarnedJob` adds
  // the payment_status half: money committed (`payout_pending`) or moved
  // (`released`). See the state table in earningsTabHelpers.ts.
  const completedJobs = earningsJobs.filter(isEarnedJob);
  const inProgressJobs = earningsJobs.filter((j) => j.status === "in_progress");
  // Take-home per job: helperEarnings.ts (a group helper sees only their share,
  // #114). The one-time fee comes off a total only while a payout is still to come (Q753).
  const totalEarnings = earnedDollarsWithLedger(completedJobs, helperFeeFallbackPct, firstPayoutFee, payoutLedger); // Q1272 (8): paid jobs count what landed

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
  const rangeEarnings = earnedDollarsWithLedger(rangeJobs, helperFeeFallbackPct, firstPayoutFee, payoutLedger);
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

  /* Which half is on screen: Earned (default) or Spent. `?view=spent` opens
     on Spent, read once at mount and never written back (MoneyViewSwitcher). */
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<MoneyView>(() => moneyViewFromSearch(searchParams));

  /* "Payout settings" in the tools menu: the payout account is the connect
     card at the top while not set up, and the floor of the Earned half once
     it is. Either way it is on this tab, so the item scrolls to it. */
  const scrollToPayoutAccount = () => {
    setView("earned");
    requestAnimationFrame(() =>
      document.getElementById("earnings-bank-account")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  /* Stripe-backed bones: each part holds its own slot while Stripe answers.
     Drawn only for a profile with a Stripe account (data-aware, owner
     2026-10-03): without one there is no wallet and no bank payouts. */
  const stripeBones = stripeLoading && hasStripeAccount;

  return (
    <ProfileTabBody>
      <ProfileTabHeader
        title={TAB_TITLES.earnings}
        onBack={onBack}
        rightSlot={
          <EarningsToolsMenu
            onExportPdf={() => setExportDialogOpen(true)}
            onExportCsv={handleExportCSV}
            onNavigatePayment={scrollToPayoutAccount}
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

      {/* NOT CONNECTED YET: the connect card sits at the top of both halves,
          because it is the one thing a helpr can act on. `!stripeError`
          matters: a failed status fetch is NOT "not connected" (it has its own
          retry banner). Mounted so its reads run and hidden until they settle;
          until then, with no Stripe account on the profile row, its
          data-aware bones hold the slot (owner, 2026-10-03). */}
      {showConnect && (
        <div id="earnings-bank-account" hidden={!connectSettled}>
          <Suspense fallback={null}>
            <PaymentTab onSettled={markConnectSettled} />
          </Suspense>
        </div>
      )}
      {!hasStripeAccount && (stripeLoading || (showConnect && !connectSettled)) && <EarningsPayoutSetupSkeleton />}

      {/* 1099-K banner — appears once YTD payouts cross the federal gross
          threshold (FORM_1099K_GROSS_THRESHOLD_DOLLARS). Quiet, dismissible
          per-user-per-year so it doesn't nag after the helper has seen it.
          Tapping the CTA opens the existing PDF tax-export dialog. */}
      {pageReady && show1099Banner && (
        <ThresholdBanner
          ytdYear={ytdYear}
          onOpenExport={() => setExportDialogOpen(true)}
          onDismiss={dismiss1099Banner}
        />
      )}

      {/* EARNED | SPENT (Q1177, owner 2026-10-04). Needs no data, so it is
          never held back. */}
      <MoneyViewSwitcher value={view} onChange={setView} />

      {/* SPENT: its own read, its own bones (SpentSection). */}
      {view === "spent" && <SpentSection />}

      {/* EARNED. Nothing renders piecemeal: until the page's own data has
          settled, the half is ONE skeleton with the loaded layout
          (useArrivalGate). Stripe-backed parts inside it hold their own
          slots (see `stripeBones`). */}
      {view === "earned" && !pageReady && <EarningsPageSkeleton withHeader={false} />}
      {view === "earned" && pageReady && (
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

          {/* Wallet card (Available + Pending side-by-side). NOT RENDERED
              UNTIL STRIPE IS CONNECTED: a helpr who has not connected does not
              have a wallet, so the honest page for them has no wallet card —
              they get the connect card at the top (owner: "needs a full
              upgrade and polish alot of the same info"). */}
          {stripeData?.connected ? (
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
          ) : stripeBones ? <EarningsWalletBones /> : null}

          {/* Only when the badge draws (Q437): an EMPTY wrapper here still
              took space-y-3's margin, so the Earned card sat 24px under the
              switcher instead of the shared 12. */}
          {helperId && streakShows(streakState.streak) && (
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
              ) : stripeBones ? <EarningsBankPayoutBones /> : undefined
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

          {/* THE PAYOUT ACCOUNT, the floor of the Earned half once connected:
              the bank account and when the next payout is expected. A helpr
              who has not connected gets this block at the top instead. It
              draws its own bones while its Stripe read answers. */}
          {stripeAnswered && stripeData?.connected && (
            <>
              <SectionRule />
              <section id="earnings-bank-account" className="space-y-4">
                <Suspense fallback={<Skeleton className="h-24 w-full rounded-2xl" />}>
                  <PaymentTab />
                </Suspense>
              </section>
            </>
          )}

          {/* The tax note closes the Earned half.

              IT NO LONGER STATES THE THRESHOLD (2026-09-06 rewrite). It read
              "exceed $20,000 in gross payments and 200 transactions" — a bare,
              undated number rendered as tax guidance. The federal 1099-K
              threshold has moved repeatedly (a $600 rule scheduled, deferred by
              the IRS twice, then repealed), so a typed number goes stale and a
              helper under the stated line concludes nothing is coming. The
              honest version says what we know and sends anyone who needs the
              current number to the IRS. The threshold constants stay in
              `moneyLimits.ts` because ThresholdBanner still needs a level. */}
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
        </section>
      )}

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
