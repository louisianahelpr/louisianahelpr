import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { netUrgentFeeDollars } from "@/lib/stripeFees";
import { Info, Sparkles, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { queryKeys } from "@/lib/queryKeys";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

/**
 * Jobs that count toward "in-progress earnings" for the projection.
 *
 * The job_status enum in production is:
 *   open · accepted · in_progress · completed · cancelled
 *   · revision_requested · disputed
 *
 * "Accepted" and "in_progress" are the only pre-payment statuses where
 * the helper is committed to deliver — these are what we project. We
 * deliberately exclude `revision_requested` (uncertain outcome) and
 * `disputed` (might never pay out).
 */
const FORECAST_STATUSES = ["accepted", "in_progress"] as const;

/**
 * "Earned so far this week" is anchored on jobs the helper has fully
 * completed — same status the existing EarningsTab totals use.
 */
const COMPLETED_STATUS = "completed";

/**
 * Compute the helper's net take from a single job using the same formula
 * already used by EarningsTab (kept inline for parity — see line ~640 in
 * `EarningsTab.tsx`). If that formula ever changes, this MUST follow.
 */
function helperNet(job: Pick<Job, "budget" | "helpers_needed" | "is_group_job" | "helper_fee_percent" | "urgent_fee">): number {
  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelper = job.budget / helpers;
  const commissionPercent = job.helper_fee_percent ?? 10;
  const commission = (perHelper * commissionPercent) / 100;
  return perHelper - commission + netUrgentFeeDollars(job.urgent_fee);
}

/**
 * Return [mondayISO, sundayISO] covering the current week in the user's
 * local timezone. Postgres comparisons against `date_needed` (a `date`,
 * not `timestamptz`) ignore time-of-day, so we send YYYY-MM-DD strings.
 */
function currentWeekRange(now: Date = new Date()): { startISO: string; endISO: string; start: Date; end: Date } {
  const start = new Date(now);
  // Monday = 1, Sunday = 0 in JS — shift Sunday back six days so weeks
  // run Mon-Sun, which is how most US payroll & helper apps frame it.
  const dayOfWeek = start.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  start.setDate(start.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const isoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return { startISO: isoDate(start), endISO: isoDate(end), start, end };
}

interface ForecastRow {
  budget: number;
  helpers_needed: number | null;
  is_group_job: boolean | null;
  helper_fee_percent: number | null;
  urgent_fee: number | null;
  status: Job["status"];
}

interface ForecastData {
  projectedTotal: number;
  earnedSoFar: number;
  inProgressCount: number;
  weekEnd: Date;
}

const formatUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface EarningsForecastCardProps {
  helperId: string;
  /**
   * When false, the card renders nothing — used to hide the projection
   * for helpers who haven't finished Stripe Connect onboarding yet
   * (they wouldn't have earnings anyway, so showing "$0 projected" is
   * just noise).
   */
  enabled: boolean;
}

export function EarningsForecastCard({ helperId, enabled }: EarningsForecastCardProps) {
  const navigate = useNavigate();

  const { startISO, endISO, end } = useMemo(() => currentWeekRange(), []);

  const { data, isLoading } = useQuery<ForecastData>({
    queryKey: queryKeys.earningsForecast.forWindow(helperId, startISO, endISO),
    queryFn: async () => {
      // Filter at the DB level — never fetch the entire helper history
      // just to slice client-side. RLS already restricts SELECT on
      // jobs to the helper themselves for these statuses.
      const rows = unwrap(
        await supabase
          .from("jobs")
          .select("budget, helpers_needed, is_group_job, helper_fee_percent, urgent_fee, status")
          .eq("helper_id", helperId)
          .in("status", [...FORECAST_STATUSES, COMPLETED_STATUS])
          .gte("date_needed", startISO)
          .lte("date_needed", endISO),
      ) as ForecastRow[] | null;

      const safeRows = rows ?? [];
      let projectedTotal = 0;
      let earnedSoFar = 0;
      let inProgressCount = 0;

      for (const row of safeRows) {
        const net = helperNet(row);
        if (row.status === COMPLETED_STATUS) {
          earnedSoFar += net;
          // Completed jobs also count toward the projected total — the
          // forecast is "what you'll have by Sunday", and money already
          // earned is part of that.
          projectedTotal += net;
        } else {
          projectedTotal += net;
          inProgressCount += 1;
        }
      }

      return { projectedTotal, earnedSoFar, inProgressCount, weekEnd: end };
    },
    enabled: enabled && !!helperId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  if (!enabled) return null;

  if (isLoading || !data) {
    return (
      <div
        data-testid="earnings-forecast-skeleton"
        className="rounded-2xl liquid-glass p-5 space-y-2"
      >
        <Skeleton className="h-3 w-32 rounded" />
        <Skeleton className="h-7 w-40 rounded" />
        <Skeleton className="h-3 w-56 rounded" />
      </div>
    );
  }

  const { projectedTotal, earnedSoFar, inProgressCount } = data;

  // Empty state: no scheduled / in-progress jobs AND nothing earned yet
  // this week — the helper has a clean slate, nudge them to browse.
  if (projectedTotal <= 0) {
    return (
      <div className="rounded-2xl liquid-glass p-5">
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "hsl(var(--gold-warm) / 0.14)" }}
          >
            <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--gold-warm))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="font-serif italic uppercase"
              style={{
                fontSize: "0.6rem",
                color: "hsl(var(--burnt-sienna) / 0.78)",
                letterSpacing: "0.18em",
              }}
            >
              This week's projection
            </p>
            <h3
              className="font-display italic font-bold leading-tight text-headline-card"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              No jobs lined up yet
            </h3>
            <p
              className="font-serif italic mt-1"
              style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Pick up a job before Sunday and we'll project your earnings here.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-8 text-ds-11 gap-1.5"
              onClick={() => navigate("/dashboard")}
            >
              <Briefcase className="w-3.5 h-3.5" />
              Browse jobs
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Populated state — show projection + caveat + progress comparison.
  const pct = projectedTotal > 0 ? Math.min(100, Math.round((earnedSoFar / projectedTotal) * 100)) : 0;

  return (
    <div className="rounded-2xl liquid-glass p-5">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p
          className="font-serif italic uppercase flex items-center gap-1.5"
          style={{
            fontSize: "0.6rem",
            color: "hsl(var(--burnt-sienna) / 0.78)",
            letterSpacing: "0.18em",
          }}
        >
          This week's projection
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="How this projection is calculated"
                className="inline-flex items-center justify-center rounded-full hover:bg-secondary/60 transition-colors p-0.5 -m-0.5"
              >
                <Info className="w-3 h-3 not-italic" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 text-ds-13 leading-relaxed font-sans not-italic"
            >
              <p className="font-semibold text-foreground mb-1">
                How this is calculated
              </p>
              <p className="text-muted-foreground">
                We sum your net take (after the platform fee) on every job
                you're accepted on or working through this week, plus
                anything you've already completed since Monday. It assumes
                every scheduled job actually completes — cancellations or
                disputes will lower the real number.
              </p>
            </PopoverContent>
          </Popover>
        </p>
      </div>

      <p
        className="font-display italic font-bold tabular-nums leading-none"
        style={{
          fontSize: "1.85rem",
          color: "hsl(var(--ink-deep))",
          letterSpacing: "-0.02em",
        }}
        aria-label={`Projected ${formatUsd(projectedTotal)} by Sunday`}
      >
        {formatUsd(projectedTotal)}
        <span
          className="font-serif italic font-normal ml-1.5"
          style={{ fontSize: "0.75rem", color: "hsl(var(--olivewood) / 0.8)" }}
        >
          by Sunday
        </span>
      </p>

      <p
        className="font-serif italic mt-1.5"
        style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.8)" }}
      >
        {inProgressCount === 0
          ? "Estimate — assumes all scheduled jobs complete."
          : `Estimate — assumes all ${inProgressCount} scheduled ${inProgressCount === 1 ? "job" : "jobs"} complete.`}
      </p>

      {/* Subtle progress bar — earned vs. projected. Only render when
          there is some scheduled work ahead, otherwise the bar is full
          and meaningless. */}
      {inProgressCount > 0 && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-ds-10">
            <span
              className="font-serif italic"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Earned so far · {formatUsd(earnedSoFar)}
            </span>
            <span
              className="font-serif italic tabular-nums"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {pct}%
            </span>
          </div>
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Earnings progress toward weekly projection"
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${pct}%`,
                background: "hsl(var(--gold-warm))",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default EarningsForecastCard;
