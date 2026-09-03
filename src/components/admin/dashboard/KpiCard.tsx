import { lazy, Suspense } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

const KpiSparkline = lazy(() => import("@/components/admin/KpiSparkline"));

export const computeTrend = (current: number, previous: number): { pct: number; up: boolean } | null => {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { pct: 100, up: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct: Math.abs(pct), up: pct >= 0 };
};

export const KpiCard = ({ label, value, icon: Icon, trend, accent, onClick, sparkline, compareLabel, hint }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: { pct: number; up: boolean } | null;
  accent: "primary" | "accent" | "destructive";
  onClick?: () => void;
  sparkline?: number[];
  compareLabel?: string;
  /** Native tooltip on the tile — carries the WHY behind an em-dash value. */
  hint?: string;
}) => {
  // Icon tint mirrors the metric color. Note: `accent` uses `text-accent`
  // (burnt sienna), NOT `text-accent-foreground` (which is white and was
  // rendering near-invisible on the light `bg-accent/10` tile).
  const accentClasses = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/15 text-[hsl(var(--accent-ink))]",
    destructive: "bg-destructive/10 text-destructive",
  }[accent];

  return (
    <button
      onClick={onClick}
      title={hint}
      // `overflow-hidden` is load-bearing, not tidiness: KpiSparkline bleeds
      // itself past the card padding with `-mx-1` so the trend line reaches the
      // tile's edges, and without a clip the stroke drew straight out through
      // the rounded corner — visible on the New Users tile at both 375 and 1440.
      // Clipping it AT the radius is what makes the bleed read as deliberate.
      className="rounded-ds-md liquid-glass overflow-hidden p-3 sm:p-4 text-left hover:border-primary/30 hover:shadow-md transition-all group w-full"
    >
      <div className="flex items-center justify-between mb-1.5 sm:mb-2">
        <div className={cn("w-8 h-8 sm:w-9 sm:h-9 rounded-ds-sm flex items-center justify-center", accentClasses)}>
          <Icon className="w-4 h-4 sm:w-[1.125rem] sm:h-[1.125rem]" strokeWidth={2.25} />
        </div>
        {trend && (
          <span className={cn(
            "text-ds-10 sm:text-ds-11 font-semibold px-1.5 py-0.5 rounded-md flex items-center gap-0.5",
            trend.up ? "text-primary bg-primary/10" : "text-destructive bg-destructive/10"
          )}>
            {trend.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend.pct}%
          </span>
        )}
      </div>
      <p className="text-ds-17 sm:text-ds-20 font-bold text-foreground tabular-nums leading-tight">{value}</p>
      <p className="text-ds-11 text-muted-foreground mt-0.5 leading-tight">{label}</p>
      {trend && compareLabel && (
        <p className={cn(
          "text-ds-10 tabular-nums mt-0.5 leading-tight",
          // Full opacity, not /80. The 20% alpha lightened bark to #7f8469,
          // measured 3.88:1 against the card — a fail for 16px text. The
          // alpha bought nothing but a contrast failure; bark at full
          // strength is the same hue, just legible. Same for destructive.
          trend.up ? "text-primary" : "text-destructive",
        )}>
          {trend.up ? "+" : "−"}{trend.pct}% {compareLabel}
        </p>
      )}
      {/* A tile that ASKED for a sparkline always gets the lane, even when the
          series is flat zero. KpiSparkline returns null on an all-zero array,
          so "Active Jobs" (0 in the window) rendered with no lane at all — and
          because the KPI grid stretches its rows, that short card was inflated
          to match the tall "New Users" tile beside it and read as a bordered
          box with a number floating in a field of nothing. A flat baseline is
          both honest ("no activity in this window") and keeps the two tiles in
          a row the same height. `hasSpark` distinguishes "asked and had none"
          from "never asked" — tiles with no sparkline prop still render short,
          which is why the grid no longer stretches them. */}
      {sparkline && sparkline.length > 0 && (
        sparkline.some((n) => n) ? (
          <Suspense fallback={<div className="h-7 mt-2" aria-hidden />}>
            <KpiSparkline data={sparkline} tone={accent} />
          </Suspense>
        ) : (
          <div className="h-7 mt-2 flex items-end" aria-hidden>
            <div className="h-px w-full bg-border" />
          </div>
        )
      )}
    </button>
  );
};
