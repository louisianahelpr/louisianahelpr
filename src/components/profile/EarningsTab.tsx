import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, Gift, Briefcase, Zap, Info } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { formatPrice } from "@/lib/format";
import { helperTakeHomeDollars, sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
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

export function EarningsTab({ earningsJobs, tips, loading, onBack, helperId, helperName }: EarningsTabProps) {
  const navigate = useNavigate();
  const { profile } = useCurrentUser();
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Instant Payout is a Pro/Elite perk — free helpers see a paywall when
  // they tap Cash out. Subscription must be active (not expired) to count.
  const subTier = (profile?.subscription_tier ?? "free") as string;
  const subExp = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
  const subActive = subExp ? subExp > new Date() : false;
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

  const { stripeData, stripeLoading, payoutLedger, refreshing, handleRefresh } = useEarningsData(helperId);

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
  const totalTips = tips.reduce((sum, t) => sum + t.amount, 0);

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
  });

  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // ─── 1099-K threshold awareness ───────────────────────────────
  // Federal threshold dropped to $600/yr for 1099-K issuance. Once a
  // helper crosses that line we surface a quiet, dismissible banner
  // pointing at the tax-export tool. Dismissal is persisted per-user
  // per-year via safeStorage so it doesn't nag once acknowledged.
  // (Louisiana adds its own $20k/200-tx threshold note already at the
  // bottom of the page — that's a separate, stricter signal.)
  const ytdYear = new Date().getFullYear();
  const ytdPayoutsCents = (stripeData?.payouts ?? [])
    .filter((p) => new Date(p.arrival_date * 1000).getFullYear() === ytdYear)
    .reduce((sum, p) => sum + p.amount, 0);
  const ytdPayoutsDollars = ytdPayoutsCents / 100;
  const banner1099Threshold = 600;
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

  return (
    <div className="space-y-4">
      <ProfileTabHeader
        title="My earnings"
        onBack={onBack}
        rightSlot={
          <EarningsToolsMenu
            onExportPdf={() => setExportDialogOpen(true)}
            onExportCsv={handleExportCSV}
            onNavigatePayment={() => navigate("/profile?tab=payment")}
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

      {/* 1099-K banner — appears once YTD payouts cross the federal
          $600 threshold. Quiet, dismissible per-user-per-year so it
          doesn't nag after the helper has seen it. Tapping the CTA
          opens the existing PDF tax-export dialog (no new flow). */}
      {show1099Banner && (
        <ThresholdBanner
          ytdYear={ytdYear}
          onOpenExport={() => setExportDialogOpen(true)}
          onDismiss={dismiss1099Banner}
        />
      )}

      {/* ─── COMPACT DASHBOARD: Wallet + Stats ─── */}
      <section className="space-y-3">
        {/* Wallet card (Available + Pending side-by-side) */}
        <WalletCard
          stripeData={stripeData}
          stripeLoading={stripeLoading}
          refreshing={refreshing}
          availableTotal={availableTotal}
          pendingTotal={pendingTotal}
          canUseInstantPayout={canUseInstantPayout}
          onRefresh={handleRefresh}
          onNavigatePayment={() => navigate("/profile?tab=payment")}
          onCashOut={() => setPayoutDialogOpen(true)}
          onUpgrade={() => setUpgradeOpen(true)}
        />

        {/* Monthly earning goal — localStorage-backed; no DB migration needed */}
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

        {/* Compact secondary stats — 3-up tiny tiles */}
        {!loading && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: TrendingUp, label: "Total", value: `$${formatPrice(totalEarnings)}`, sub: `${completedJobs.length} job${completedJobs.length === 1 ? "" : "s"}` },
              { icon: Gift, label: "Tips", value: `$${formatPrice(totalTips)}`, sub: `${tips.length} tip${tips.length === 1 ? "" : "s"}` },
              { icon: Briefcase, label: "Active", value: String(inProgressJobs.length), sub: "in progress" },
            ].map(({ icon: Icon, label, value, sub }) => (
              <div key={label} className="rounded-ds-md liquid-glass px-3 py-3 transition-all hover:-translate-y-0.5">
                <div className="flex items-center gap-1 mb-1">
                  <Icon className="w-3 h-3 text-primary" />
                  <span className="font-serif italic uppercase" style={{ fontSize: "0.55rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
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

        {/* Payout history — inline year picker, no big empty box */}
        {stripeData?.connected && (
          <PayoutHistory
            stripeData={stripeData}
            exportYear={exportYear}
            onExportYearChange={setExportYear}
            payoutYears={payoutYears}
          />
        )}
      </section>

      {/* ─── PIE + YTD vs PRIOR-YTD compare ───────────────────
          Self-hides if there's no completed-job data. Sits between the
          payout history (the receipts) and the per-transfer ledger so
          the helper sees their high-level breakdown before drilling
          into individual transfers. */}
      <EarningsBreakdownCharts earningsJobs={earningsJobs} feeFallbackPercent={helperFeeFallbackPct} />

      {/* ─── ACTUAL PAYOUTS (from payout_transfers ledger) ─── */}
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

      {/* Muted legal/tax disclosure — bottom of page */}
      <p className="text-ds-11 text-muted-foreground/80 leading-relaxed pt-2 flex gap-1.5">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          <strong className="text-muted-foreground">Tax reporting:</strong> Louisiana law requires 1099-K forms for Helprs who exceed $20,000 in gross payments and 200 transactions in a calendar year. Stripe issues these automatically — no action needed.
        </span>
      </p>

      <ProUpgradeSheet
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        icon={Zap}
        eyebrow="Subscriber perk"
        title="Cash out instantly."
        body="Skip the 1–2 business day wait. Subscribed helpers can route earnings to a debit card in about 30 minutes."
        perks={[
          "Instant payouts to debit card (~30 min)",
          "Stripe's standard 3% + $1 fee applies",
          "Plus every other subscriber perk on your plan",
        ]}
        requiredTier="pro"
      />

      <InstantPayoutDialog
        open={payoutDialogOpen}
        onOpenChange={setPayoutDialogOpen}
        onSuccess={handleRefresh}
      />
    </div>
  );
}
