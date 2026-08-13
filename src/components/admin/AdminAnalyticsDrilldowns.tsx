import { lazy, Suspense, useState } from "react";
import { MapPin } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { Badge } from "@/components/ui/badge";
import { cn, formatName } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { jobStatusLabel, paymentStatusLabel } from "@/lib/statusLabels";
import { formatCategory, formatPrice, formatShortDate } from "@/lib/format";
import { formatJobDate } from "@/lib/dateUtils";
import { PIE_COLORS } from "./adminAnalyticsConstants";
import { toneTextClasses, type Tone } from "@/components/admin/tones";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

/**
 * Drill-down detail views for the admin analytics dashboard — the
 * full-list screens opened from a metric tile (all users, subscribers,
 * categories, payout tracking, all jobs).
 *
 * Extracted verbatim from AdminAnalytics.tsx. Categories is the only
 * drill-down with a chart, so the lazy CategoriesBarChart and its
 * loading spinner live here with it.
 */
const CategoriesBarChart = lazy(() =>
  import("./AdminAnalyticsCharts").then((m) => ({ default: m.CategoriesBarChart })),
);

const ChartFallback = () => (
  <div className="flex h-full w-full items-center justify-center">
    <HelprSpinner size={20} />
  </div>
);

// ─── Drill-down: Users ───
export const UsersDrillDown = ({ users, roleByUser }: { users: Profile[]; roleByUser: Map<string, string> }) => {
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "denied">("all");
  const filtered = users.filter(u => statusFilter === "all" || u.approval_status === statusFilter);

  const statusColor = (status: string) => {
    if (status === "approved") return "bg-primary/10 text-primary";
    if (status === "denied") return "bg-destructive/10 text-destructive";
    return "bg-accent/20 text-accent";
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filter by status" className="flex gap-1 bg-secondary/50 rounded-ds-sm p-1">
        {(["all", "pending", "approved", "denied"] as const).map(s => {
          const count = users.filter(u => s === "all" || u.approval_status === s).length;
          return (
            <button key={s} onClick={() => setStatusFilter(s)} aria-pressed={statusFilter === s}
              className={`flex-1 px-3 py-1.5 rounded-md text-ds-11 font-medium transition-colors capitalize ${statusFilter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {s} ({count})
            </button>
          );
        })}
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map(u => (
          <div key={u.id} className="rounded-ds-md liquid-glass p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-ds-13">{formatName(u.full_name, "—")}</p>
                <div className="flex flex-wrap gap-2 text-ds-11 text-muted-foreground mt-0.5">
                  {u.email && <span>{u.email}</span>}
                  {u.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{u.location}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {u.subscription_tier && (
                  <Badge className="text-ds-10 bg-primary/10 text-primary capitalize">{u.subscription_tier}</Badge>
                )}
                <Badge className={`text-ds-11 capitalize ${statusColor(u.approval_status)}`}>{u.approval_status}</Badge>
              </div>
            </div>
            <p className="text-ds-10 text-muted-foreground mt-2">Joined {formatShortDate(u.created_at)} · {roleByUser.get(u.user_id) ?? "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Drill-down: Subscriptions ───
export const SubscriptionsDrillDown = ({ users }: { users: Profile[] }) => {
  const [tierFilter, setTierFilter] = useState<string>("all");
  const tiers = ["all", "elite", "pro", "basic", "free"];
  const filtered = users.filter(u => {
    if (tierFilter === "all") return true;
    if (tierFilter === "free") return !u.subscription_tier;
    return u.subscription_tier === tierFilter;
  });

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filter by tier" className="flex gap-1 bg-secondary/50 rounded-ds-sm p-1">
        {tiers.map(t => {
          const count = users.filter(u => t === "all" || (t === "free" ? !u.subscription_tier : u.subscription_tier === t)).length;
          return (
            <button key={t} onClick={() => setTierFilter(t)} aria-pressed={tierFilter === t}
              className={`flex-1 px-3 py-1.5 rounded-md text-ds-11 font-medium transition-colors capitalize ${tierFilter === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t} ({count})
            </button>
          );
        })}
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map(u => (
          <div key={u.id} className="rounded-ds-md liquid-glass p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground text-ds-13">{formatName(u.full_name, "—")}</p>
              <p className="text-ds-11 text-muted-foreground">{u.email} · {u.location || "No location"}</p>
            </div>
            <Badge className={`capitalize text-ds-11 ${
              u.subscription_tier === "elite" ? "bg-accent/20 text-accent" :
              u.subscription_tier === "pro" ? "bg-primary/10 text-primary" :
              u.subscription_tier === "basic" ? "bg-secondary text-secondary-foreground" :
              "bg-muted text-muted-foreground"
            }`}>
              {u.subscription_tier || "Free"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Drill-down: Categories ───
export const CategoriesDrillDown = ({ data }: { data: { name: string; count: number; revenue: number }[] }) => (
  <div className="space-y-3">
    <div className="h-[250px]">
      <Suspense fallback={<ChartFallback />}>
        <CategoriesBarChart data={data} />
      </Suspense>
    </div>
    <div className="space-y-2">
      {data.map((cat, i) => (
        <div key={cat.name} className="rounded-ds-md liquid-glass p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="text-ds-13 font-medium text-foreground capitalize">{cat.name}</span>
          </div>
          <div className="flex items-center gap-4 text-ds-13">
            <span className="text-muted-foreground">{cat.count} job{cat.count === 1 ? "" : "s"}</span>
            <span className="font-semibold text-foreground">${formatPrice(cat.revenue)} revenue</span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─── Drill-down: Payouts ───
export const PayoutsDrillDown = ({ jobs }: { jobs: Job[] }) => {
  const [filter, setFilter] = useState<string>("all");
  const statuses = ["all", "escrow", "payout_pending", "released", "refunded"];
  const filtered = filter === "all" ? jobs : jobs.filter(j => j.payment_status === filter);

  const statusTone: Record<string, Tone> = {
    escrow: "warning",
    payout_pending: "info",
    released: "success",
    refunded: "danger",
  };
  const statusDot = (status: string) =>
    cn("bg-current", toneTextClasses[statusTone[status] ?? "neutral"]);

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filter by payment status" className="flex gap-1 flex-wrap bg-secondary/50 rounded-ds-sm p-1">
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)} aria-pressed={filter === s}
            className={`px-3 py-1.5 rounded-md text-ds-11 font-medium transition-colors ${filter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {s === "all" ? `All (${jobs.length})` : `${paymentStatusLabel(s)} (${jobs.filter(j => j.payment_status === s).length})`}
          </button>
        ))}
      </div>

      <div className="rounded-ds-md liquid-glass p-4 flex items-center justify-between">
        <span className="text-ds-11 text-muted-foreground">Total for filter ({filtered.length} job{filtered.length === 1 ? "" : "s"})</span>
        <span className="text-ds-17 font-bold text-foreground">
          ${formatPrice(filtered.reduce((s, j) => s + (j.budget || 0), 0))}
        </span>
      </div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map(j => (
          <div key={j.id} className="rounded-ds-md liquid-glass p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-ds-13 truncate">{j.title}</p>
                <p className="text-ds-11 text-muted-foreground mt-0.5">{j.location} · {formatJobDate(j.date_needed)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className={cn("w-2 h-2 rounded-full", statusDot(j.payment_status || ""))} />
                <span className="text-ds-11 text-muted-foreground">{paymentStatusLabel(j.payment_status)}</span>
              </div>
            </div>
            <div className="flex gap-4 mt-2 text-ds-11 text-muted-foreground">
              <span>Budget: ${formatPrice(j.budget)}</span>
              <span>Fee: ${formatPrice(j.platform_fee_amount || 0)}</span>
              <span>Payout: ${formatPrice(j.budget - (j.platform_fee_amount || 0))}</span>
              {j.payout_scheduled_at && <span>Scheduled: {new Date(j.payout_scheduled_at).toLocaleString()}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Drill-down: Jobs (existing, cleaned up) ───
export const JobsDrillDown = ({ jobs, showFinancials, showFees }: { jobs: Job[]; showFinancials: boolean; showFees: boolean }) => {
  const [filter, setFilter] = useState<string>("all");
  const statusOptions = ["all", "open", "accepted", "in_progress", "completed", "cancelled"];
  const filtered = filter === "all" ? jobs : jobs.filter(j => j.status === filter);
  const total = filtered.reduce((s, j) => s + (showFees ? (j.platform_fee_amount || 0) : j.budget), 0);

  // Job-status pill colors are unified via the canonical
  // `jobStatusColorClasses` map in `@/lib/statusColors` so this admin
  // drilldown reads the same as every other status chip in the app.

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filter by job status" className="flex gap-1 flex-wrap bg-secondary/50 rounded-ds-sm p-1">
        {statusOptions.map(s => (
          <button key={s} onClick={() => setFilter(s)} aria-pressed={filter === s}
            className={`px-3 py-1.5 rounded-md text-ds-11 font-medium transition-colors ${filter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {s === "all" ? `All (${jobs.length})` : `${jobStatusLabel(s)} (${jobs.filter(j => j.status === s).length})`}
          </button>
        ))}
      </div>

      {showFinancials && (
        <div className="rounded-ds-md liquid-glass p-4 flex items-center justify-between">
          <span className="text-ds-11 text-muted-foreground">{showFees ? "Total Fees" : "Total Revenue"} ({filtered.length} job{filtered.length === 1 ? "" : "s"})</span>
          <span className="text-ds-17 font-bold text-foreground">${total.toFixed(2)}</span>
        </div>
      )}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map(j => (
          <div key={j.id} className="rounded-ds-md liquid-glass p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-ds-13 truncate">{j.title}</p>
                <div className="flex flex-wrap gap-2 text-ds-11 text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{j.location}</span>
                  <span>{j.category ? formatCategory(j.category) : ""}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge className={`text-ds-11 ${jobStatusColorClasses(j.status)}`}>{jobStatusLabel(j.status)}</Badge>
                <span className="text-ds-13 font-semibold text-foreground">${j.budget}</span>
              </div>
            </div>
            {showFinancials && (
              <div className="flex gap-4 mt-2 text-ds-11 text-muted-foreground">
                <span>Budget: ${j.budget}</span>
                <span>Fee: ${j.platform_fee_amount || 0}</span>
                <span>Payout: ${j.budget - (j.platform_fee_amount || 0)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
