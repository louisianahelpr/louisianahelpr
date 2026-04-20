import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, TrendingUp, Gift, Briefcase, Wallet, RefreshCw, Loader2, Banknote, Download, Zap } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { EarningsExport } from "@/components/EarningsExport";
import InstantPayoutDialog from "@/components/InstantPayoutDialog";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  revision_requested: "bg-destructive/10 text-destructive",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

const payoutStatusColors: Record<string, string> = {
  paid: "bg-primary/10 text-primary",
  in_transit: "bg-accent/20 text-accent-foreground",
  pending: "bg-secondary text-secondary-foreground",
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
  const [stripeData, setStripeData] = useState<StripePayoutData | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);

  const fetchPayouts = async () => {
    try {
      const { data, error } = await supabase.functions.invoke<StripePayoutData>("stripe-payouts", { body: {} });
      if (error) throw error;
      setStripeData(data ?? null);
    } catch (err) {
      console.warn("[EarningsTab] payouts fetch failed:", err);
      setStripeData({ connected: false, payouts_enabled: false, available: [], pending: [], payouts: [] });
    } finally {
      setStripeLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPayouts();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPayouts();
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
    const commissionPercent = (j as any).helper_fee_percent ?? 10;
    const commission = (perHelper * commissionPercent) / 100;
    return sum + (perHelper - commission + (j.urgent_fee ?? 0));
  }, 0);
  const totalTips = tips.reduce((sum, t) => sum + t.amount, 0);

  const availableTotal = (stripeData?.available ?? []).reduce((s, b) => s + b.amount, 0);
  const pendingTotal = (stripeData?.pending ?? []).reduce((s, b) => s + b.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground flex-1">My Earnings</h1>
        <EarningsExport helperId={helperId} helperName={helperName} />
      </div>

      {/* ─── LIVE STRIPE WALLET ─── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-semibold text-foreground">Wallet</h2>
            {stripeData?.connected && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wide">Live · Stripe</span>
            )}
          </div>
          {stripeData?.connected && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>

        {stripeLoading ? (
          <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading live payout data…</p>
          </div>
        ) : !stripeData?.connected ? (
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your payout account to see your live Stripe balance, pending funds, and payout history.
            </p>
            <Button size="sm" onClick={() => navigate("/profile?tab=payment")}>Set up payouts</Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Available</span>
                  <Banknote className="w-4 h-4 text-primary" />
                </div>
                <p className="text-xl font-bold text-foreground">{formatCents(availableTotal)}</p>
                <p className="text-xs text-muted-foreground mt-1">ready to pay out</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Pending</span>
                  <Loader2 className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-xl font-bold text-foreground">{formatCents(pendingTotal)}</p>
                <p className="text-xs text-muted-foreground mt-1">clearing soon</p>
              </div>
            </div>

            {(() => {
              const instantAvailable = (stripeData.instant_available ?? []).reduce((s, b) => s + b.amount, 0);
              if (instantAvailable <= 0) return null;
              return (
                <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">Instant cash out available</span>
                    </div>
                    <p className="text-xl font-bold text-foreground">{formatCents(instantAvailable)}</p>
                    <p className="text-xs text-muted-foreground mt-1">To your debit card in ~30 min · 3% + $1 fee</p>
                  </div>
                  <Button onClick={() => setPayoutDialogOpen(true)} className="gap-2 shrink-0">
                    <Zap className="w-4 h-4" /> Cash out
                  </Button>
                </div>
              );
            })()}

            {!stripeData.payouts_enabled && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs text-destructive">
                  Payouts are not yet enabled on your account. Finish payout setup to start receiving funds.
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2 mt-4 gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">Payout History</h3>
                <div className="flex items-center gap-2">
                  <Select value={exportYear} onValueChange={setExportYear}>
                    <SelectTrigger className="h-8 w-[100px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {payoutYears.map((y) => (
                        <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExportCSV}
                    className="h-8 text-xs gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download for Taxes
                  </Button>
                </div>
              </div>
              {stripeData.payouts.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <p className="text-sm text-muted-foreground">No payouts yet — your first one will land here automatically.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stripeData.payouts.map((p) => (
                    <div key={p.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-foreground text-sm">{formatCents(p.amount, p.currency)}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${payoutStatusColors[p.status] || "bg-secondary text-secondary-foreground"}`}>
                              {p.status.replace("_", " ")}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Arrives {formatDate(p.arrival_date)} · {p.method === "instant" ? "Instant" : "Standard"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ─── JOB-LEVEL EARNINGS ─── */}
      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Total</span>
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xl font-bold text-foreground">${totalEarnings.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">{completedJobs.length} jobs</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Tips</span>
                <Gift className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xl font-bold text-foreground">${totalTips.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">{tips.length} tips</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Active</span>
                <Briefcase className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xl font-bold text-foreground">{inProgressJobs.length}</p>
              <p className="text-xs text-muted-foreground mt-1">in progress</p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Tax reporting:</strong> Louisiana law requires 1099-K forms for helprs who exceed <strong>$20,000 in gross payments</strong> and <strong>200 transactions</strong> in a calendar year. Stripe issues these automatically — no action needed on your part.
          </div>

          <div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-3">Earning History</h2>
            {earningsJobs.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No jobs yet.</p>
                <Button onClick={() => navigate("/dashboard")}>Browse tasks</Button>
              </div>
            ) : (
              <div className="space-y-3">
                {earningsJobs.map((job) => {
                  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
                  const perHelper = job.budget / helpers;
                  const commissionPercent = (job as any).helper_fee_percent ?? 10;
                  const commission = (perHelper * commissionPercent) / 100;
                  const payout = job.status === "completed" ? perHelper - commission + (job.urgent_fee ?? 0) : null;
                  const jobTips = tips.filter((t) => t.job_id === job.id);
                  const tipTotal = jobTips.reduce((s, t) => s + t.amount, 0);
                  return (
                    <div key={job.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-foreground text-sm">{job.title}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>{job.status.replace("_", " ")}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{job.location} · {new Date(job.date_needed).toLocaleDateString()}</p>
                        </div>
                        <div className="text-right">
                          {payout !== null && <p className="font-bold text-foreground text-sm">${payout.toFixed(2)}</p>}
                          {tipTotal > 0 && <p className="text-xs text-primary flex items-center gap-1 justify-end"><Gift className="w-3 h-3" /> +${tipTotal.toFixed(2)}</p>}
                          {job.status === "in_progress" && <p className="text-xs text-muted-foreground">${job.budget} budget</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <InstantPayoutDialog
        open={payoutDialogOpen}
        onOpenChange={setPayoutDialogOpen}
        onSuccess={fetchPayouts}
      />
    </div>
  );
}
