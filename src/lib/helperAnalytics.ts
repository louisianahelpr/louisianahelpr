// helperAnalytics — the derivations behind /analytics, kept pure so every
// number on the page is unit-testable without a browser or a database.
//
// WHERE THE MONEY MATH LIVES: not here. Every dollar on this page goes through
// `helperTakeHomeDollars` / `helperPlatformFeeDollars` in
// `src/lib/helperEarnings.ts` — the same functions the Earnings tab uses. The
// RPC (`get_helper_analytics`) deliberately returns per-job FACTS rather than
// computed dollars for exactly this reason: two screens about the same money
// must not carry two implementations of it. See the migration header
// (20260901011102_helper_advanced_analytics.sql) for the full argument.
//
// WHERE THE FLOORS LIVE: not here either. The sample-size floors arrive in the
// payload (`floors`) so the SQL and the UI cannot drift about what counts as
// "enough history". Everything below returns `null` — never `0` — when the
// sample is short, and always reports the sample alongside it so the UI can
// say "3 of 5 so far" instead of printing a measurement nobody made.

import {
  helperPlatformFeeDollars,
  helperShareCount,
  helperTakeHomeDollars,
  type HelperEarningsJob,
} from "@/lib/helperEarnings";
import { formatCategory, formatPriceExact } from "@/lib/format";

/** The Free tier's commission. Mirrors TIER_PERKS.free.platformFeePercent. */
export const FREE_TIER_FEE_PERCENT = 12;

/** One completed job, as `get_helper_analytics` returns it. */
export interface AnalyticsJob extends HelperEarningsJob {
  id: string;
  category: string | null;
  parish: string | null;
  completed_at: string;
}

export type ApplicationOutcome = "won" | "lost" | "undecided";

export interface AnalyticsApplication {
  id: string;
  applied_at: string;
  /** Minutes between the job being posted and this application. Helper's own clock. */
  minutes_to_apply: number | null;
  outcome: ApplicationOutcome;
  category: string | null;
  parish: string | null;
}

export interface AnalyticsFloors {
  category_jobs: number;
  decided_applications: number;
  applications: number;
  head_to_head: number;
  market_jobs: number;
  market_category_jobs: number;
}

export interface AnalyticsHeadToHead {
  sample: number;
  /**
   * How many of those jobs the caller applied to BEFORE the helper who won.
   * The two medians cannot answer this — a lower median is perfectly
   * compatible with being last on half the set — so the count is computed in
   * SQL and the UI states it instead of inferring a per-job outcome from an
   * aggregate.
   */
  you_were_first: number;
  your_median_minutes: number | null;
  winner_median_minutes: number | null;
}

export interface AnalyticsMarketRate {
  category: string;
  jobs: number;
  median_budget: number | null;
}

export interface AnalyticsDemandCell {
  /** 0 = Sunday, matching Postgres `EXTRACT(DOW …)`. */
  dow: number;
  /** 0–5, each a 4-hour block starting at midnight America/Chicago. */
  block: number;
  jobs: number;
}

export interface AnalyticsMarket {
  scope: "parish" | "statewide";
  parishes: string[];
  window_days: number;
  sample: number;
  /** NULL below the market floor — never a grid of zeros. */
  demand: AnalyticsDemandCell[] | null;
  rates: AnalyticsMarketRate[];
}

/** Money-only rows handed to a NON-entitled caller for the upgrade pitch. */
export type AnalyticsPreviewJob = HelperEarningsJob;

export interface HelperAnalyticsPayload {
  generated_at: string;
  window_days: number;
  tier: string | null;
  entitled: boolean;
  floors: AnalyticsFloors;
  jobs?: AnalyticsJob[];
  applications?: AnalyticsApplication[];
  head_to_head?: AnalyticsHeadToHead;
  market?: AnalyticsMarket;
  /**
   * Present on EVERY signed-in, non-entitled response and ABSENT only when the
   * server could not identify the caller (`auth.uid()` was NULL — a torn or
   * expired session). The distinction is load-bearing: `preview.jobs === []`
   * means "we looked and you have no completed jobs", while `preview ===
   * undefined` means "we could not look". Collapsing the two with `?? []`
   * told a helper with a hundred completed jobs that they had none.
   */
  preview?: { jobs: AnalyticsPreviewJob[] };
}

/* ────────────────────────────── primitives ────────────────────────────── */

/**
 * `$1,234.50` — formatPriceExact plus the sign it deliberately omits.
 *
 * A non-finite input renders as an em dash, NOT as `$0`. `formatPriceExact`
 * returns the string "0" for NaN/Infinity, which on this page would print a
 * confident `$0.00` in a tile built to show "—" when nothing was measured. The
 * whole point of the tile's null path is defeated if a NaN can walk past it
 * wearing a dollar sign.
 */
export const money = (amount: number): string =>
  Number.isFinite(amount) ? `$${formatPriceExact(amount)}` : "—";

/** Median of a non-empty list. Even counts average the two middles. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Round to cents so a float tail never renders as $108.00000000000001. */
export const cents = (n: number): number => Math.round(n * 100) / 100;

/**
 * What this job's platform fee WOULD have been at an arbitrary rate.
 *
 * Percent-derived on purpose, and only ever used for the counterfactual half
 * of a comparison: the actual fee comes from `helperPlatformFeeDollars`, which
 * prefers the amount the payout genuinely stamped. Applying a hypothetical
 * percent to a stamped amount is not a thing that can be done, so the
 * comparison is stated as "the same jobs at 12%" rather than as a restatement
 * of what was charged.
 */
export function feeAtPercent(job: HelperEarningsJob, percent: number): number {
  const shares = helperShareCount(job);
  return ((job.budget ?? 0) / shares) * (percent / 100);
}

/** The helper's share of a job's budget — budget/N on a group job. */
export function helperGrossDollars(job: HelperEarningsJob): number {
  return (job.budget ?? 0) / helperShareCount(job);
}

/* ─────────────────────────────── earnings ─────────────────────────────── */

export interface EarningsTotals {
  jobs: number;
  gross: number;
  takeHome: number;
  fees: number;
  /** Fees as a share of gross. NULL when there is no gross to divide by. */
  effectiveFeePercent: number | null;
  /** What the same jobs would have cost at the Free plan's rate. */
  feesAtFreeRate: number;
  /** feesAtFreeRate − fees. Can be 0 (a Free helper) or negative (never, today). */
  savedVsFree: number;
}

export function earningsTotals(
  jobs: readonly AnalyticsJob[],
  feeFallbackPercent: number,
): EarningsTotals | null {
  if (jobs.length === 0) return null;
  let gross = 0, takeHome = 0, fees = 0, feesAtFreeRate = 0;
  for (const j of jobs) {
    gross += helperGrossDollars(j);
    takeHome += helperTakeHomeDollars(j, feeFallbackPercent);
    fees += helperPlatformFeeDollars(j, feeFallbackPercent);
    feesAtFreeRate += feeAtPercent(j, FREE_TIER_FEE_PERCENT);
  }
  return {
    jobs: jobs.length,
    gross: cents(gross),
    takeHome: cents(takeHome),
    fees: cents(fees),
    effectiveFeePercent: gross > 0 ? Math.round((fees / gross) * 1000) / 10 : null,
    feesAtFreeRate: cents(feesAtFreeRate),
    savedVsFree: cents(feesAtFreeRate - fees),
  };
}

export interface EarningsMonth {
  /** `YYYY-MM`, in the viewer's local time — the axis a person reads. */
  month: string;
  label: string;
  takeHome: number;
  fees: number;
  jobs: number;
}

/**
 * Monthly take-home and fee, oldest first, with EMPTY MONTHS FILLED IN.
 *
 * A month with no completed work is a real, measured zero — the helper earned
 * nothing — which is why these are 0 and not null. That is the one place on
 * this page where 0 is the honest answer; contrast the rates, which are null
 * below their floor because nobody measured them.
 */
export function earningsByMonth(
  jobs: readonly AnalyticsJob[],
  feeFallbackPercent: number,
): EarningsMonth[] {
  if (jobs.length === 0) return [];
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const bucket = new Map<string, { takeHome: number; fees: number; jobs: number }>();
  let min = Infinity, max = -Infinity;
  for (const j of jobs) {
    const d = new Date(j.completed_at);
    // An unparseable date keys the bucket "NaN-NaN", which the month-fill loop
    // below never reads — so the job would vanish from the CHART while
    // earningsTotals still counted it, and the bars would quietly stop adding
    // up to the headline. Skip it in both or in neither; skipping here alone
    // was the bug.
    if (!Number.isFinite(d.getTime())) continue;
    const t = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    if (t < min) min = t;
    if (t > max) max = t;
    const k = key(d);
    const b = bucket.get(k) ?? { takeHome: 0, fees: 0, jobs: 0 };
    b.takeHome += helperTakeHomeDollars(j, feeFallbackPercent);
    b.fees += helperPlatformFeeDollars(j, feeFallbackPercent);
    b.jobs += 1;
    bucket.set(k, b);
  }
  // Every row had an unusable date: there is no axis to draw.
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const out: EarningsMonth[] = [];
  for (const cur = new Date(min); cur.getTime() <= max; cur.setMonth(cur.getMonth() + 1)) {
    const k = key(cur);
    const b = bucket.get(k) ?? { takeHome: 0, fees: 0, jobs: 0 };
    out.push({
      month: k,
      label: cur.toLocaleDateString(undefined, { month: "short" }),
      takeHome: cents(b.takeHome),
      fees: cents(b.fees),
      jobs: b.jobs,
    });
  }
  return out;
}

/* ────────────────────────────── categories ────────────────────────────── */

export interface CategoryRow {
  category: string;
  label: string;
  jobs: number;
  takeHome: number;
  /** NULL until `floors.category_jobs` completed jobs in this category. */
  medianTakeHome: number | null;
  /** NULL under the same floor. Same unit as the market median, so comparable. */
  medianBudget: number | null;
  /** Market median posted budget, or NULL below `floors.market_category_jobs`. */
  marketMedianBudget: number | null;
  marketJobs: number;
}

export function categoryBreakdown(
  jobs: readonly AnalyticsJob[],
  feeFallbackPercent: number,
  floors: AnalyticsFloors,
  marketRates: readonly AnalyticsMarketRate[] = [],
): CategoryRow[] {
  const market = new Map(marketRates.map((r) => [r.category, r]));
  const groups = new Map<string, { take: number[]; budget: number[] }>();
  for (const j of jobs) {
    const key = j.category ?? "other";
    const g = groups.get(key) ?? { take: [], budget: [] };
    g.take.push(helperTakeHomeDollars(j, feeFallbackPercent));
    g.budget.push(helperGrossDollars(j));
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([category, g]) => {
      const enough = g.take.length >= floors.category_jobs;
      const m = market.get(category);
      return {
        category,
        label: formatCategory(category) || "Other",
        jobs: g.take.length,
        takeHome: cents(g.take.reduce((s, v) => s + v, 0)),
        medianTakeHome: enough ? cents(median(g.take)!) : null,
        medianBudget: enough ? cents(median(g.budget)!) : null,
        marketMedianBudget: m?.median_budget != null ? Number(m.median_budget) : null,
        marketJobs: m?.jobs ?? 0,
      };
    })
    .sort((a, b) => b.takeHome - a.takeHome);
}

/* ───────────────────────────── applications ───────────────────────────── */

export interface ApplicationFunnel {
  applied: number;
  won: number;
  lost: number;
  undecided: number;
  decided: number;
  /** NULL below `floors.decided_applications`. */
  winRate: number | null;
  /** NULL below `floors.applications`. */
  medianMinutesToApply: number | null;
}

export function applicationFunnel(
  apps: readonly AnalyticsApplication[],
  floors: AnalyticsFloors,
): ApplicationFunnel {
  const won = apps.filter((a) => a.outcome === "won").length;
  const lost = apps.filter((a) => a.outcome === "lost").length;
  const undecided = apps.filter((a) => a.outcome === "undecided").length;
  const decided = won + lost;
  const minutes = apps
    .map((a) => a.minutes_to_apply)
    .filter((m): m is number => typeof m === "number" && Number.isFinite(m));
  return {
    applied: apps.length,
    won,
    lost,
    undecided,
    decided,
    winRate:
      decided >= floors.decided_applications ? Math.round((won / decided) * 1000) / 10 : null,
    medianMinutesToApply:
      minutes.length >= floors.applications ? Math.round(median(minutes)!) : null,
  };
}

/** "12 min" / "3 hr 20 min" / "2 days". Null in, null out. */
export function formatMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h} hr ${rem} min` : `${h} hr`;
  }
  const d = Math.round((m / (60 * 24)) * 10) / 10;
  return `${d} ${d === 1 ? "day" : "days"}`;
}

/* ──────────────────────────────── demand ──────────────────────────────── */

export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Two-letter days for the heatmap's column headers only.
 *
 * Seven 3-letter labels across a 320px column in senior mode (which scales
 * text-ds-11 from 11px to 14px) ran together into "MonTueWedThu" with no
 * visible gap. Prose keeps the readable 3-letter form; only the grid header,
 * where the column below it supplies the context, drops to two.
 */
export const DOW_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
// Each label names the block's START hour, not its span. The span form
// ("8a–12p") is more explicit but does not fit the row-label column at 320px,
// where it truncated to "8a–1…" — a label that is not merely ugly but WRONG,
// since it reads as "8am to 1pm". The 4-hour width is stated once in the
// panel's caption instead.
export const BLOCK_LABELS = ["12a", "4a", "8a", "12p", "4p", "8p"] as const;

/** The same six blocks written out, for prose where width is not constrained. */
export const BLOCK_SPAN_LABELS = [
  "12–4am", "4–8am", "8am–12pm", "12–4pm", "4–8pm", "8pm–12am",
] as const;

export interface DemandGrid {
  /** `[dow][block]` job counts, 7 × 6. */
  cells: number[][];
  peak: number;
  /** The busiest cell, or null when the whole grid is empty. */
  busiest: { dow: number; block: number; jobs: number } | null;
  total: number;
}

/**
 * Fold the sparse cell list into a dense 7×6 grid.
 *
 * Returns null when the RPC withheld `demand` (below the market floor). A grid
 * of zeros is NOT the fallback: "no jobs were posted at 3am on a Tuesday" and
 * "we do not have enough postings to say" look identical in a heatmap and mean
 * completely different things.
 */
export function demandGrid(cellList: readonly AnalyticsDemandCell[] | null | undefined): DemandGrid | null {
  if (!cellList) return null;
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 6 }, () => 0));
  let peak = 0, total = 0;
  let busiest: DemandGrid["busiest"] = null;
  for (const c of cellList) {
    if (c.dow < 0 || c.dow > 6 || c.block < 0 || c.block > 5) continue;
    cells[c.dow][c.block] += c.jobs;
    total += c.jobs;
    const v = cells[c.dow][c.block];
    if (v > peak) {
      peak = v;
      busiest = { dow: c.dow, block: c.block, jobs: v };
    }
  }
  return { cells, peak, busiest, total };
}

/** "Lafayette", "Lafayette & Orleans", "Lafayette + 3 more", "Louisiana". */
export function scopeLabel(market: AnalyticsMarket | undefined): string {
  if (!market || market.scope === "statewide" || market.parishes.length === 0) return "Louisiana";
  const p = market.parishes;
  if (p.length === 1) return p[0];
  if (p.length === 2) return `${p[0]} & ${p[1]}`;
  return `${p[0]} + ${p.length - 1} more`;
}
