import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TrendingUp, Gift, Briefcase, Wallet, RefreshCw, Loader2, Banknote, Zap, Settings, FileText, FileSpreadsheet, ExternalLink, Info } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { EarningsExport } from "@/components/EarningsExport";
import InstantPayoutDialog from "@/components/InstantPayoutDialog";
import ProUpgradeSheet from "@/components/ProUpgradeSheet";
import { PayoutCelebration } from "@/components/wallet/PayoutCelebration";
import { EarningsForecastCard } from "@/components/profile/EarningsForecastCard";
import { HelperScheduleStrip } from "@/components/profile/HelperScheduleStrip";
import { HelperStreakBadge } from "@/components/profile/HelperStreakBadge";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHelperMilestones } from "@/hooks/useHelperMilestones";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface PayoutLedgerRow {
  id: string;
  job_id: string;
  amount_cents: number;
  platform_fee_cents: number;
  status: "pending" | "paid" | "failed" | "reversed";
  created_at: string;
  paid_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  stripe_transfer_id: string | null;
  jobs: { title?: string } | null;
}

// Status pill colors — bark for "in motion/done" states, sienna for
// "action needed", destructive only for genuine failure.
const statusColors: Record<string, string> = {
  open: "bg-[hsl(var(--burnt-sienna)/0.10)] text-[hsl(var(--burnt-sienna))]",
  accepted: "bg-[hsl(var(--bark)/0.10)] text-[hsl(var(--bark))]",
  in_progress: "bg-[hsl(var(--burnt-sienna)/0.10)] text-[hsl(var(--burnt-sienna))]",
  revision_requested: "bg-[hsl(var(--gold-warm)/0.16)] text-[hsl(var(--gold-warm))]",
  completed: "bg-[hsl(var(--bark)/0.10)] text-[hsl(var(--bark))]",
  cancelled: "bg-destructive/10 text-destructive",
};

const payoutStatusColors: Record<string, string> = {
  paid: "bg-[hsl(var(--bark)/0.10)] text-[hsl(var(--bark))]",
  in_transit: "bg-[hsl(var(--burnt-sienna)/0.10)] text-[hsl(var(--burnt-sienna))]",
  pending: "bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood))]",
  failed: "bg-destructive/10 text-destructive",
  canceled: "bg-destructive/10 text-destructive",
};

interface EarningsTabProps {
  earningsJobs: Job[];
  tips: { amount: number; job_id: string; created_at: string }[];
  loading: boolean;
  onBack: () => void;
  helperId: string;
  helperName: string;
}

interface StripePayout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrival_date: number;
  method: string;
  created: number;
  description: string | null;
}

interface StripePayoutData {
  connected: boolean;
  payouts_enabled: boolean;
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
  instant_available?: { amount: number; currency: string }[];
  payouts: StripePayout[];
}

const formatCents = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

const formatDate = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function EarningsTab({ earningsJobs, tips, loading, onBack, helperId, helperName }: EarningsTabProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useCurrentUser();
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Instant Payout is a Pro/Elite perk — free helpers see a paywall when
  // they tap Cash out. Subscription must be active (not expired) to count.
  const subTier = (profile?.subscription_tier ?? "free") as string;
  const subExp = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
  const subActive = subExp ? subExp > new Date() : false;
  const canUseInstantPayout = subActive && (subTier === "pro" || subTier === "elite" || subTier === "basic");
  // Pagination for the earnings-history list. Power helpers with 100+
  // completed jobs were rendering them all; this caps the initial render
  // at PAGE and grows by PAGE on each Load-more tap.
  const PAGE = 25;
  const [historyVisible, setHistoryVisible] = useState(PAGE);

  // React Query: caches Stripe payout data so re-opening the tab is instant.
  const FALLBACK_STRIPE: StripePayoutData = {
    connected: false, payouts_enabled: false, available: [], pending: [], payouts: [],
  };
  const { data: stripeData, isLoading: stripeLoading, isFetching, refetch } = useQuery<StripePayoutData>({
    queryKey: ["stripe-payouts"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke<StripePayoutData>("stripe-payouts", { body: {} });
        if (error) throw error;
        return data ?? FALLBACK_STRIPE;
      } catch (err) {
        report(err, { severity: "warning", tags: { source: "EarningsTab.fetchPayouts" } });
        return FALLBACK_STRIPE;
      }
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // payout_transfers ledger — the authoritative record of every
  // stripe.transfers.create() call to this helper. RLS already restricts
  // SELECT to `auth.uid() = helper_id` so no extra filter needed here.
  const { data: payoutLedger = [] } = useQuery<PayoutLedgerRow[]>({
    queryKey: ["payout-transfers", helperId],
    queryFn: async () => {
      if (!helperId) return [];
      const { data, error } = await supabase.from("payout_transfers")
        .select("id, job_id, amount_cents, platform_fee_cents, status, created_at, paid_at, failed_at, failure_reason, stripe_transfer_id, jobs(title)")
        .eq("helper_id", helperId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        report(error, { severity: "warning", tags: { source: "EarningsTab.fetchLedger" } });
        return [];
      }
      return (data ?? []) as PayoutLedgerRow[];
    },
    enabled: !!helperId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const refreshing = isFetching && !stripeLoading;
  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ["stripe-payouts"] });
    refetch();
  };

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
    const rows = (stripeData?.payouts ?? []).filter(
      (p) => new Date(p.arrival_date * 1000).getFullYear() === year
    );

    if (!rows.length) {
      toast({
        title: "No payouts to export",
        description: `No payouts found for ${year}.`,
      });
      return;
    }

    const escape = (val: string | number | null | undefined) => {
      const s = val == null ? "" : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ["Arrival Date", "Description", "Status", "Method", "Currency", "Net Payout (USD)"];
    const csvLines = [header.join(",")];
    let total = 0;

    rows.forEach((p) => {
      const dollars = p.amount / 100;
      total += dollars;
      csvLines.push(
        [
          new Date(p.arrival_date * 1000).toISOString().slice(0, 10),
          escape(p.description ?? `Stripe Payout ${p.id}`),
          escape(p.status),
          escape(p.method),
          escape(p.currency.toUpperCase()),
          dollars.toFixed(2),
        ].join(",")
      );
    });

    csvLines.push("");
    csvLines.push(`Total Net Payouts,${total.toFixed(2)}`);
    csvLines.push(`Tax Year,${year}`);
    csvLines.push("Note,Net amounts paid to your bank. Excludes platform fees & sales tax (Helpr's responsibility).");

    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
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
  const totalEarnings = completedJobs.reduce((sum, j) => {
    const helpers = j.is_group_job && j.helpers_needed ? j.helpers_needed : 1;
    const perHelper = j.budget / helpers;
    const commissionPercent = j.helper_fee_percent ?? 10;
    const commission = (perHelper * commissionPercent) / 100;
    return sum + (perHelper - commission + (j.urgent_fee ?? 0));
  }, 0);
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

  return (
    <div className="space-y-5">
      <ProfileTabHeader
        eyebrow="Wallet"
        title="My earnings"
        meta="Payouts, tips, and tax exports"
        onBack={onBack}
        rightSlot={
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 rounded-ds-sm hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Earnings settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-ds-11">Earnings tools</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setExportDialogOpen(true)}>
              <FileText className="w-4 h-4 mr-2" /> Export for Taxes (PDF)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleExportCSV}>
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Export Payouts CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/profile?tab=payment")}>
              <ExternalLink className="w-4 h-4 mr-2" /> Stripe Dashboard Access
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

      {/* ─── COMPACT DASHBOARD: Wallet + Stats ─── */}
      <section className="space-y-3">
        {/* Wallet card (Available + Pending side-by-side) */}
        {stripeLoading ? (
          <div className="rounded-2xl liquid-glass p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-muted/40 animate-pulse" />
                <div className="h-7 w-24 rounded bg-muted/40 animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-muted/40 animate-pulse" />
                <div className="h-7 w-24 rounded bg-muted/40 animate-pulse" />
              </div>
            </div>
            <div className="h-9 w-full rounded-md bg-muted/30 animate-pulse" />
          </div>
        ) : !stripeData?.connected ? (
          <div className="rounded-2xl liquid-glass p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                  Balance
                </p>
                <h2 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
                  Wallet
                </h2>
              </div>
            </div>
            <p className="font-serif italic" style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.7)" }}>
              Connect your payout account to see your live balance.
            </p>
            <Button size="sm" onClick={() => navigate("/profile?tab=payment")}>Set up payouts</Button>
          </div>
        ) : (
          <div className="rounded-2xl liquid-glass p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-serif italic uppercase flex items-center gap-1.5" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                    Balance <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary not-italic" style={{ letterSpacing: "0.05em" }}>LIVE</span>
                  </p>
                  <h2 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
                    Wallet
                  </h2>
                </div>
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                aria-label="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Banknote className="w-3 h-3 text-primary" />
                  <span className="font-serif italic uppercase" style={{ fontSize: "0.58rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                    Available
                  </span>
                </div>
                <p className="font-display italic font-bold tabular-nums leading-none" style={{ fontSize: "1.85rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
                  {formatCents(availableTotal)}
                </p>
                <p className="font-serif italic mt-1" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                  ready to pay out
                </p>
              </div>
              <div className="border-l border-border/40 pl-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <Loader2 className="w-3 h-3" style={{ color: "hsl(var(--olivewood) / 0.6)" }} />
                  <span className="font-serif italic uppercase" style={{ fontSize: "0.58rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                    Pending
                  </span>
                </div>
                <p className="font-display italic font-bold tabular-nums leading-none" style={{ fontSize: "1.85rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
                  {formatCents(pendingTotal)}
                </p>
                <p className="font-serif italic mt-1" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                  clearing soon
                </p>
              </div>
            </div>

            {(() => {
              const instantAvailable = (stripeData.instant_available ?? []).reduce((s, b) => s + b.amount, 0);
              if (instantAvailable <= 0) return null;
              return (
                <div className="mt-3 rounded-ds-md border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-primary" />
                      <span className="text-ds-11 font-semibold text-foreground">Instant cash out</span>
                      {!canUseInstantPayout && (
                        <span
                          className="text-[8.5px] font-bold uppercase tracking-wider px-1 py-0.5 rounded-full"
                          style={{
                            background: "hsl(var(--burnt-sienna) / 0.14)",
                            color: "hsl(var(--burnt-sienna))",
                            letterSpacing: "0.06em",
                          }}
                        >
                          Pro
                        </span>
                      )}
                    </div>
                    <p className="text-ds-15 font-bold text-foreground">{formatCents(instantAvailable)}</p>
                    <p className="text-muted-foreground text-ds-11">
                      {canUseInstantPayout ? "~30 min · 3% + $1 fee" : "Subscribe to unlock instant payouts"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => canUseInstantPayout ? setPayoutDialogOpen(true) : setUpgradeOpen(true)}
                    className="h-8 text-ds-11 gap-1.5 shrink-0"
                  >
                    <Zap className="w-3.5 h-3.5" /> Cash out
                  </Button>
                </div>
              );
            })()}

            {!stripeData.payouts_enabled && (
              <p className="mt-2 text-ds-11 text-destructive">
                Payouts not yet enabled — finish setup to start receiving funds.
              </p>
            )}
          </div>
        )}

        {/* Compact secondary stats — 3-up tiny tiles */}
        {!loading && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: TrendingUp, label: "Total", value: `$${totalEarnings.toFixed(2)}`, sub: `${completedJobs.length} jobs` },
              { icon: Gift, label: "Tips", value: `$${totalTips.toFixed(2)}`, sub: `${tips.length} tips` },
              { icon: Briefcase, label: "Active", value: String(inProgressJobs.length), sub: "in progress" },
            ].map(({ icon: Icon, label, value, sub }) => (
              <div key={label} className="rounded-ds-md liquid-glass px-3 py-3 transition-all hover:-translate-y-0.5">
                <div className="flex items-center gap-1 mb-1">
                  <Icon className="w-3 h-3 text-primary" />
                  <span className="font-serif italic uppercase" style={{ fontSize: "0.55rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                    {label}
                  </span>
                </div>
                <p className="font-display italic font-bold tabular-nums leading-none" style={{ fontSize: "1.15rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                  {value}
                </p>
                <p className="font-serif italic mt-1" style={{ fontSize: "0.66rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                  {sub}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Payout history — inline year picker, no big empty box */}
        {stripeData?.connected && (
          <div className="pt-2">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                  Ledger
                </p>
                <h3 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
                  Payout history
                </h3>
              </div>
              <Select value={exportYear} onValueChange={setExportYear}>
                <SelectTrigger className="h-7 w-[88px] text-ds-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {payoutYears.map((y) => (
                    <SelectItem key={y} value={String(y)} className="text-ds-11">{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {stripeData.payouts.length === 0 ? (
              <p className="font-serif italic" style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                No payouts recorded for {exportYear}.
              </p>
            ) : (
              <div className="space-y-2">
                {stripeData.payouts.map((p) => (
                  <div key={p.id} className="rounded-ds-md liquid-glass p-3 transition-all hover:-translate-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-display italic font-bold tabular-nums" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))" }}>
                            {formatCents(p.amount, p.currency)}
                          </span>
                          <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium capitalize ${payoutStatusColors[p.status] || "bg-secondary text-secondary-foreground"}`}>
                            {p.status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="font-serif italic" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                          Arrives {formatDate(p.arrival_date)} · {p.method === "instant" ? "Instant" : "Standard"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─── ACTUAL PAYOUTS (from payout_transfers ledger) ─── */}
      {payoutLedger.length > 0 && (
        <div>
          <p className="font-serif italic uppercase mb-1" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
            Payouts
          </p>
          <h2 className="font-display italic font-bold leading-tight mb-3" style={{ fontSize: "1.25rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
            Recent transfers
          </h2>
          <div className="space-y-2.5">
            {payoutLedger.map((t) => {
              const jobTitle = (t.jobs as { title?: string } | null)?.title ?? "Job";
              const date = new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              const amount = (t.amount_cents / 100).toFixed(2);
              const fee = (t.platform_fee_cents / 100).toFixed(2);
              const tone =
                t.status === "paid" ? "bg-primary/10 text-primary"
                : t.status === "failed" ? "bg-destructive/10 text-destructive"
                : t.status === "reversed" ? "bg-muted text-muted-foreground"
                : "bg-accent/20 text-accent-foreground"; // pending
              return (
                <div key={t.id} className="rounded-ds-md liquid-glass p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                          {jobTitle}
                        </h3>
                        <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium capitalize ${tone}`}>{t.status}</span>
                      </div>
                      <p className="font-serif italic" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                        {date}
                        {t.stripe_transfer_id && (
                          <span className="ml-2 text-ds-10 font-mono opacity-60" title="Stripe transfer ID">{t.stripe_transfer_id.slice(-8)}</span>
                        )}
                        {t.failure_reason && t.status === "failed" && (
                          <span className="block mt-1 text-destructive text-ds-11">{t.failure_reason}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display italic font-bold tabular-nums" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))" }}>
                        ${amount}
                      </p>
                      {Number(fee) > 0 && (
                        <p className="font-serif italic" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.6)" }}>
                          fee ${fee}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── EARNING HISTORY ─── */}
      {loading ? (
        <p className="font-serif italic" style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.7)" }}>Loading…</p>
      ) : (
        <div>
          <p className="font-serif italic uppercase mb-1" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
            History
          </p>
          <h2 className="font-display italic font-bold leading-tight mb-3" style={{ fontSize: "1.25rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
            Earning history
          </h2>
          {earningsJobs.length === 0 ? (
            <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-3 px-6 py-12">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                  border: "1px solid hsl(var(--olivewood) / 0.10)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                    "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
                }}
              >
                <Briefcase className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
              </div>
              <div className="space-y-1.5">
                <span className="text-display-eyebrow">Quiet ledger</span>
                <p
                  className="font-display italic font-bold leading-tight"
                  style={{
                    fontSize: "clamp(1.05rem, 1.5vw + 0.4rem, 1.35rem)",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  No earnings yet.
                </p>
                <p
                  className="font-serif italic text-ds-13 leading-relaxed max-w-sm mx-auto"
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                >
                  Apply to a task and your earnings will land here.
                </p>
              </div>
              <Button onClick={() => navigate("/dashboard")} className="rounded-ds-md mt-1">Browse tasks</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {earningsJobs.slice(0, historyVisible).map((job) => {
                const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
                const perHelper = job.budget / helpers;
                const commissionPercent = job.helper_fee_percent ?? 10;
                const commission = (perHelper * commissionPercent) / 100;
                const payout = job.status === "completed" ? perHelper - commission + (job.urgent_fee ?? 0) : null;
                const jobTips = tips.filter((t) => t.job_id === job.id);
                const tipTotal = jobTips.reduce((s, t) => s + t.amount, 0);
                return (
                  <div key={job.id} className="rounded-ds-md liquid-glass p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                            {job.title}
                          </h3>
                          <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>{job.status.replace("_", " ")}</span>
                        </div>
                        <p className="font-serif italic" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                          {job.location} <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span> {new Date(job.date_needed).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {payout !== null && (
                          <p className="font-display italic font-bold tabular-nums" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))" }}>
                            ${payout.toFixed(2)}
                          </p>
                        )}
                        {tipTotal > 0 && <p className="text-ds-11 text-primary flex items-center gap-1 justify-end"><Gift className="w-3 h-3" /> +${tipTotal.toFixed(2)}</p>}
                        {job.status === "in_progress" && (
                          <p className="font-serif italic" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                            ${job.budget} budget
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {earningsJobs.length > historyVisible && (
                <Button
                  variant="outline"
                  className="w-full rounded-ds-md"
                  onClick={() => setHistoryVisible((n) => n + PAGE)}
                >
                  Load {Math.min(PAGE, earningsJobs.length - historyVisible)} more · {earningsJobs.length - historyVisible} remaining
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Muted legal/tax disclosure — bottom of page */}
      <p className="text-ds-11 text-muted-foreground/80 leading-relaxed pt-2 flex gap-1.5">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          <strong className="text-muted-foreground">Tax reporting:</strong> Louisiana law requires 1099-K forms for helprs who exceed $20,000 in gross payments and 200 transactions in a calendar year. Stripe issues these automatically — no action needed.
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
