import {
  Users, Briefcase, DollarSign, ShieldAlert, AlertTriangle,
  CheckCircle2, Crown, TrendingUp, X,
} from "lucide-react";
import type { Stats, DateRange } from "./types";
import { KpiCard, computeTrend } from "./KpiCard";
import { PriorityAlert } from "./PriorityAlert";
import { TaxReserveCard } from "./TaxReserveCard";
import { DateRangeBar } from "./DateRangeBar";

interface DashboardHomeProps {
  stats: Stats;
  statsLoading: boolean;
  onNavigate: (v: string) => void;
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  customDays: number;
  setCustomDays: (n: number) => void;
  rangeLabel: string;
  prevLabel: string;
}

export const DashboardHome = ({
  stats, statsLoading, onNavigate,
  dateRange, setDateRange, customDays, setCustomDays,
  rangeLabel, prevLabel,
}: DashboardHomeProps) => {
  const v = (val: number | string) => statsLoading ? "—" : val;
  const hasAlerts = stats.pendingApprovals > 0 || stats.disputedJobs > 0 || stats.openReports > 0 || stats.supportTickets > 0;
  const revenueTrend = computeTrend(stats.revenueInRange, stats.revenuePrev);
  const newUsersTrend = computeTrend(stats.newUsersInRange, stats.newUsersPrev);
  const completedTrend = computeTrend(stats.completedJobsInRange, stats.completedJobsPrev);
  const compareCopy = `vs ${prevLabel}`;

  return (
    <div className="space-y-4 sm:space-y-5 w-full">
      {/* Date range selector — top of the dashboard. Drives every
          range-sensitive tile (revenue, new users, completed jobs) and
          the sparklines under each. */}
      <DateRangeBar
        dateRange={dateRange}
        setDateRange={setDateRange}
        customDays={customDays}
        setCustomDays={setCustomDays}
      />

      {/* Greeting — editorial 3-line header on its own glass plate.
          Matches the dashboard / activity / messages top-box pattern. */}
      <div
        className="liquid-glass relative overflow-hidden px-5 py-4 sm:px-6 sm:py-5"
        style={{
          backgroundImage:
            "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
            "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04), " +
            "0 1px 2px hsl(var(--olivewood) / 0.05), " +
            "0 8px 18px -6px hsl(var(--olivewood) / 0.1), " +
            "0 18px 32px -10px hsl(var(--olivewood) / 0.12)",
        }}
      >
        <h1
          className="font-display italic font-bold leading-tight"
          style={{ fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.85rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
        >
          Welcome back
        </h1>
        <p className="font-serif italic mt-0.5 text-[0.78rem]" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {hasAlerts ? "There are items needing attention today." : "Everything looks calm on the platform."}
        </p>
      </div>

      {/* KPI Summary cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">

        <KpiCard
          label={`New Users (${rangeLabel})`}
          value={v(stats.newUsersInRange.toLocaleString())}
          icon={Users}
          accent="accent"
          trend={newUsersTrend}
          compareLabel={compareCopy}
          sparkline={stats.newUsersSeries}
          onClick={() => onNavigate("people")}
        />
        <KpiCard
          label="Active Jobs"
          value={v(stats.activeJobs.toLocaleString())}
          icon={Briefcase}
          accent="primary"
          sparkline={stats.activeJobsSeries}
          onClick={() => onNavigate("jobs")}
        />
        <KpiCard
          label={`Revenue (${rangeLabel})`}
          value={v(`$${stats.revenueInRange.toFixed(0)}`)}
          icon={DollarSign}
          trend={revenueTrend}
          compareLabel={compareCopy}
          sparkline={stats.revenueSeries}
          accent="accent"
          onClick={() => onNavigate("analytics")}
        />
        <KpiCard
          label="Pending Disputes"
          value={v(stats.disputedJobs)}
          icon={ShieldAlert}
          accent="destructive"
          onClick={() => onNavigate("disputes")}
        />
      </div>

      {/* Priority alerts */}
      {hasAlerts && (
        <div className="space-y-2 sm:space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
            <p className="text-ds-10 sm:text-ds-11 font-semibold text-foreground uppercase tracking-widest">Priority Alerts</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5 sm:gap-3">
            {stats.pendingApprovals > 0 && (
              <PriorityAlert label="Pending Helpr approvals" count={stats.pendingApprovals} color="accent" onClick={() => onNavigate("people")} />
            )}
            {stats.disputedJobs > 0 && (
              <PriorityAlert label="Active disputes" count={stats.disputedJobs} color="destructive" onClick={() => onNavigate("disputes")} />
            )}
            {stats.openReports > 0 && (
              <PriorityAlert label="Open reports" count={stats.openReports} color="destructive" onClick={() => onNavigate("reports")} />
            )}
            {stats.supportTickets > 0 && (
              <PriorityAlert label="Support tickets" count={stats.supportTickets} color="accent" onClick={() => onNavigate("support")} />
            )}
          </div>
        </div>
      )}

      {/* Financial Health — full width */}
      <div className="space-y-2 sm:space-y-3">
        <p className="text-ds-10 sm:text-ds-11 font-semibold text-muted-foreground uppercase tracking-widest">Financial Health</p>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          <KpiCard label="Captured Revenue (all-time)" value={v(`$${stats.totalRevenue.toFixed(2)}`)} icon={DollarSign} accent="primary" onClick={() => onNavigate("analytics")} />
          <KpiCard label="Platform Profit" value={v(`$${stats.totalFees.toFixed(2)}`)} icon={TrendingUp} accent="primary" onClick={() => onNavigate("analytics")} />
          <KpiCard label="Active Subscriptions" value={v(stats.activeSubscriptions)} icon={Crown} accent="accent" onClick={() => onNavigate("subscriptions")} />
          <KpiCard
            label={`Completed Jobs (${rangeLabel})`}
            value={v(stats.completedJobsInRange)}
            icon={CheckCircle2}
            accent="primary"
            trend={completedTrend}
            compareLabel={compareCopy}
            sparkline={stats.completedJobsSeries}
            onClick={() => onNavigate("analytics")}
          />
          {stats.lateCancellationRevenue > 0 && (
            <KpiCard label="Late Cancel Revenue" value={v(`$${stats.lateCancellationRevenue.toFixed(2)}`)} icon={X} accent="destructive" onClick={() => onNavigate("analytics")} />
          )}
        </div>
      </div>

      {/* Tax obligations — running reserve estimate so the platform-fee
          income tax never lands as an April surprise. */}
      <div className="space-y-2 sm:space-y-3">
        <p className="text-ds-10 sm:text-ds-11 font-semibold text-muted-foreground uppercase tracking-widest">Tax Obligations</p>
        <TaxReserveCard
          totalFees={stats.totalFees}
          feesThisQuarter={stats.feesThisQuarter}
          statsLoading={statsLoading}
        />
      </div>
    </div>
  );
};
