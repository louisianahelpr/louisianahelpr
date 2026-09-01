import { describe, it, expect } from "vitest";
import {
  FREE_TIER_FEE_PERCENT,
  applicationFunnel,
  categoryBreakdown,
  demandGrid,
  earningsByMonth,
  earningsTotals,
  feeAtPercent,
  formatMinutes,
  median,
  money,
  scopeLabel,
  type AnalyticsApplication,
  type AnalyticsFloors,
  type AnalyticsJob,
} from "@/lib/helperAnalytics";

/**
 * These fixtures are the SAME five jobs the PGlite harness for
 * 20260901011102_helper_advanced_analytics.sql feeds through the RPC, so the
 * SQL side and the TypeScript side are verified against one hand-computed set
 * of answers rather than two:
 *
 *   J1 cleaning  $120  fee 10%  stamped $12   released        -> fee 12  keep 108
 *   J2 cleaning  $200  fee 10%  stamped $20   released        -> fee 20  keep 180
 *   J3 cleaning  $80   fee 10%  stamped $8    released        -> fee  8  keep  72
 *   J4 yard_work $100  fee NULL stamped NULL  released        -> fallback 10%, fee 10, keep 90
 *   J5 moving    $150  fee 10%  stamped $15   payout_pending  -> UNSETTLED: the stamp is
 *                                                               escrow bookkeeping, so the
 *                                                               live tier rate applies
 *                                                               -> fee 15, keep 135
 *
 *   gross 650 · fees 65 · take-home 585 · effective 10.0%
 *   at the Free plan's 12%: 78 in fees, so a Pro helper kept 13 more.
 */
const FLOORS: AnalyticsFloors = {
  category_jobs: 3,
  decided_applications: 5,
  applications: 3,
  head_to_head: 3,
  market_jobs: 20,
  market_category_jobs: 5,
};

const job = (over: Partial<AnalyticsJob> & { id: string }): AnalyticsJob => ({
  category: "cleaning",
  parish: null,
  completed_at: "2026-08-15T12:00:00.000Z",
  budget: 100,
  helper_fee_percent: 10,
  platform_fee_amount: 10,
  payment_status: "released",
  is_group_job: false,
  helpers_needed: 1,
  urgent_fee: 0,
  ...over,
});

const JOBS: AnalyticsJob[] = [
  job({ id: "j1", budget: 120, platform_fee_amount: 12, completed_at: "2026-08-15T12:00:00Z" }),
  job({ id: "j2", budget: 200, platform_fee_amount: 20, completed_at: "2026-07-10T12:00:00Z" }),
  job({ id: "j3", budget: 80, platform_fee_amount: 8, completed_at: "2026-06-10T12:00:00Z" }),
  job({
    id: "j4",
    category: "yard_work",
    budget: 100,
    helper_fee_percent: null,
    platform_fee_amount: null,
    completed_at: "2026-06-05T12:00:00Z",
  }),
  job({
    id: "j5",
    category: "moving",
    budget: 150,
    platform_fee_amount: 15,
    payment_status: "payout_pending",
    completed_at: "2026-08-20T12:00:00Z",
  }),
];

const PRO_FEE = 10;

describe("median", () => {
  it("returns null for an empty sample rather than 0", () => {
    expect(median([])).toBeNull();
  });
  it("averages the two middles on an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([100, 190, 110, 180])).toBe(145);
  });
  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
  it("sorts numerically, not lexically", () => {
    expect(median([9, 10, 11])).toBe(10);
  });
});

describe("earningsTotals", () => {
  it("returns null with no completed jobs — never a row of zeros", () => {
    expect(earningsTotals([], PRO_FEE)).toBeNull();
  });

  it("matches the hand-computed totals for the shared fixture", () => {
    const t = earningsTotals(JOBS, PRO_FEE)!;
    expect(t.jobs).toBe(5);
    expect(t.gross).toBe(650);
    expect(t.fees).toBe(65);
    expect(t.takeHome).toBe(585);
    expect(t.effectiveFeePercent).toBe(10);
    expect(t.feesAtFreeRate).toBe(78); // 650 * 12%
    expect(t.savedVsFree).toBe(13);
  });

  it("an UNSETTLED row uses the live tier rate, not its escrow-time stamp", () => {
    // j5 is stamped $15 at 10%. On Elite (8%) the fee shown must be 12, not 15
    // — the stamp was written before any helper's tier was known. This is the
    // isSettledForDisplay rule in helperEarnings.ts; asserting it here stops
    // the analytics page from being the surface that quietly forgets it.
    const only = [JOBS[4]];
    expect(earningsTotals(only, 8)!.fees).toBe(12);
    expect(earningsTotals(only, 8)!.takeHome).toBe(138);
    // A SETTLED row ignores the tier and honours the stamp.
    expect(earningsTotals([JOBS[0]], 8)!.fees).toBe(12);
  });

  it("a Free helper is shown no saving, not a negative one", () => {
    const t = earningsTotals(JOBS, FREE_TIER_FEE_PERCENT)!;
    // Four of the five rows carry a stamped 10% fee, which is what they were
    // actually charged; only the legacy row and the unsettled row follow the
    // fallback. So the "saving" is small and non-negative rather than 0.
    expect(t.savedVsFree).toBeGreaterThanOrEqual(0);
  });

  it("splits a group job's budget across the roster", () => {
    const group = job({
      id: "g",
      budget: 300,
      is_group_job: true,
      helpers_needed: 3,
      helper_fee_percent: 10,
      platform_fee_amount: 30,
    });
    const t = earningsTotals([group], PRO_FEE)!;
    expect(t.gross).toBe(100); // 300 / 3
    expect(t.fees).toBe(10); // per-helper budget × frozen percent
    expect(t.takeHome).toBe(90);
  });
});

describe("feeAtPercent", () => {
  it("is percent-derived, ignoring the stamped amount", () => {
    expect(feeAtPercent(JOBS[0], 12)).toBeCloseTo(14.4, 6);
  });
  it("uses the per-helper share on a group job", () => {
    expect(
      feeAtPercent(job({ id: "g", budget: 300, is_group_job: true, helpers_needed: 3 }), 12),
    ).toBeCloseTo(12, 6);
  });
});

describe("earningsByMonth", () => {
  it("fills the gap months in between, because an earned-nothing month is a real 0", () => {
    const months = earningsByMonth(JOBS, PRO_FEE);
    // June through August: three months, none skipped.
    expect(months.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(months.every((m) => Number.isFinite(m.takeHome))).toBe(true);
  });

  it("every month's take-home plus fee sums back to the totals", () => {
    const months = earningsByMonth(JOBS, PRO_FEE);
    const take = months.reduce((s, m) => s + m.takeHome, 0);
    const fees = months.reduce((s, m) => s + m.fees, 0);
    expect(Math.round(take * 100) / 100).toBe(585);
    expect(Math.round(fees * 100) / 100).toBe(65);
    expect(months.reduce((s, m) => s + m.jobs, 0)).toBe(5);
  });

  it("is empty, not a fabricated axis, when there is nothing to plot", () => {
    expect(earningsByMonth([], PRO_FEE)).toEqual([]);
  });
});

describe("categoryBreakdown", () => {
  const rows = categoryBreakdown(JOBS, PRO_FEE, FLOORS, [
    { category: "cleaning", jobs: 10, median_budget: 145 },
    { category: "moving", jobs: 3, median_budget: null },
  ]);

  it("orders by what the helper actually banked", () => {
    expect(rows.map((r) => r.category)).toEqual(["cleaning", "moving", "yard_work"]);
    expect(rows[0].takeHome).toBe(360); // 108 + 180 + 72
  });

  it("publishes a median only at or above the floor", () => {
    const cleaning = rows.find((r) => r.category === "cleaning")!;
    expect(cleaning.jobs).toBe(3);
    expect(cleaning.medianTakeHome).toBe(108); // median(108, 180, 72)
    expect(cleaning.medianBudget).toBe(120);

    const moving = rows.find((r) => r.category === "moving")!;
    expect(moving.jobs).toBe(1);
    expect(moving.medianTakeHome).toBeNull();
    expect(moving.medianBudget).toBeNull();
  });

  it("carries the market median through, and withholds it below its own floor", () => {
    expect(rows.find((r) => r.category === "cleaning")!.marketMedianBudget).toBe(145);
    // The market said 3 jobs and no median: the count is still shown, the
    // median is not invented.
    const moving = rows.find((r) => r.category === "moving")!;
    expect(moving.marketJobs).toBe(3);
    expect(moving.marketMedianBudget).toBeNull();
  });

  it("reports 0 market jobs for a category the market has none of", () => {
    const yard = rows.find((r) => r.category === "yard_work")!;
    expect(yard.marketJobs).toBe(0);
    expect(yard.marketMedianBudget).toBeNull();
  });

  it("buckets a null category as 'other' rather than dropping the job", () => {
    const rows2 = categoryBreakdown([job({ id: "x", category: null })], PRO_FEE, FLOORS);
    expect(rows2).toHaveLength(1);
    expect(rows2[0].category).toBe("other");
  });
});

describe("applicationFunnel", () => {
  const app = (over: Partial<AnalyticsApplication> & { id: string }): AnalyticsApplication => ({
    applied_at: "2026-08-01T00:00:00Z",
    minutes_to_apply: 10,
    outcome: "won",
    category: "cleaning",
    parish: null,
    ...over,
  });

  it("counts undecided separately — a job nobody won is not a loss", () => {
    const f = applicationFunnel(
      [
        app({ id: "1", outcome: "won", minutes_to_apply: 10 }),
        app({ id: "2", outcome: "won", minutes_to_apply: 20 }),
        app({ id: "3", outcome: "lost", minutes_to_apply: 60 }),
        app({ id: "4", outcome: "lost", minutes_to_apply: 120 }),
        app({ id: "5", outcome: "lost", minutes_to_apply: 180 }),
        app({ id: "6", outcome: "undecided", minutes_to_apply: 5 }),
        app({ id: "7", outcome: "undecided", minutes_to_apply: 5 }),
      ],
      FLOORS,
    );
    expect(f.applied).toBe(7);
    expect(f.decided).toBe(5);
    expect(f.undecided).toBe(2);
    expect(f.winRate).toBe(40); // 2 of 5, NOT 2 of 7
    expect(f.medianMinutesToApply).toBe(20);
  });

  it("withholds the win rate below the decided floor, at any success level", () => {
    const twoForTwo = applicationFunnel(
      [app({ id: "1" }), app({ id: "2" })],
      FLOORS,
    );
    // Two wins out of two decided is 100%, and publishing it would be the
    // "100% Clients who rebooked" bug in a new costume.
    expect(twoForTwo.decided).toBe(2);
    expect(twoForTwo.winRate).toBeNull();
  });

  it("returns a real 0% once the sample is big enough", () => {
    const allLost = Array.from({ length: 5 }, (_, i) =>
      app({ id: `l${i}`, outcome: "lost" }),
    );
    expect(applicationFunnel(allLost, FLOORS).winRate).toBe(0);
  });

  it("withholds the median apply time below its floor and ignores null minutes", () => {
    expect(applicationFunnel([app({ id: "1" }), app({ id: "2" })], FLOORS).medianMinutesToApply)
      .toBeNull();
    const withNulls = applicationFunnel(
      [
        app({ id: "1", minutes_to_apply: null }),
        app({ id: "2", minutes_to_apply: null }),
        app({ id: "3", minutes_to_apply: 30 }),
      ],
      FLOORS,
    );
    expect(withNulls.medianMinutesToApply).toBeNull(); // only 1 usable, floor is 3
  });

  it("is all zeros and nulls, not a crash, on no applications", () => {
    const f = applicationFunnel([], FLOORS);
    expect(f).toMatchObject({ applied: 0, won: 0, lost: 0, decided: 0, winRate: null });
  });
});

describe("formatMinutes", () => {
  it.each([
    [null, null],
    [undefined, null],
    [0, "0 min"],
    [12, "12 min"],
    [59, "59 min"],
    [60, "1 hr"],
    [200, "3 hr 20 min"],
    [1440, "1 day"],
    [2880, "2 days"],
  ])("%s → %s", (input, want) => {
    expect(formatMinutes(input as number | null)).toBe(want);
  });
});

describe("demandGrid", () => {
  it("returns null when the RPC withheld the grid — not a grid of zeros", () => {
    expect(demandGrid(null)).toBeNull();
    expect(demandGrid(undefined)).toBeNull();
  });

  it("folds the sparse list into 7×6 and finds the peak", () => {
    const g = demandGrid([
      { dow: 3, block: 2, jobs: 27 },
      { dow: 5, block: 4, jobs: 4 },
    ])!;
    expect(g.cells).toHaveLength(7);
    expect(g.cells[0]).toHaveLength(6);
    expect(g.cells[3][2]).toBe(27);
    expect(g.cells[5][4]).toBe(4);
    expect(g.total).toBe(31);
    expect(g.busiest).toEqual({ dow: 3, block: 2, jobs: 27 });
  });

  it("drops out-of-range cells instead of throwing", () => {
    const g = demandGrid([{ dow: 9, block: 2, jobs: 5 }, { dow: 1, block: 1, jobs: 2 }])!;
    expect(g.total).toBe(2);
  });

  it("an empty list is an empty grid with no busiest cell", () => {
    const g = demandGrid([])!;
    expect(g.total).toBe(0);
    expect(g.busiest).toBeNull();
    expect(g.peak).toBe(0);
  });
});

describe("scopeLabel", () => {
  const base = { window_days: 180, sample: 0, demand: null, rates: [] };
  it("names the parish, pairs two, and summarises more", () => {
    expect(scopeLabel({ ...base, scope: "parish", parishes: ["Lafayette"] })).toBe("Lafayette");
    expect(scopeLabel({ ...base, scope: "parish", parishes: ["Lafayette", "Orleans"] }))
      .toBe("Lafayette & Orleans");
    expect(scopeLabel({ ...base, scope: "parish", parishes: ["A", "B", "C", "D"] }))
      .toBe("A + 3 more");
  });
  it("falls back to Louisiana for statewide and for a missing market", () => {
    expect(scopeLabel({ ...base, scope: "statewide", parishes: [] })).toBe("Louisiana");
    expect(scopeLabel(undefined)).toBe("Louisiana");
  });
});

describe("guards against a wrong number reaching the screen", () => {
  it("money() renders a non-finite amount as an em dash, never $0", () => {
    // formatPriceExact returns the string "0" for NaN/Infinity, so without this
    // guard a NaN prints a confident "$0.00" in a tile whose whole design is to
    // show "—" when nothing was measured.
    expect(money(0)).toBe("$0");
    expect(money(280.6)).toBe("$280.60");
    expect(money(Number.NaN)).toBe("—");
    expect(money(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("earningsByMonth drops an unparseable date instead of hiding it in the chart", () => {
    // The bad row would key the bucket "NaN-NaN", which the month-fill loop
    // never reads — so it vanished from the BARS while earningsTotals kept
    // counting it, and the chart quietly stopped adding up to the headline.
    const bad = job({ id: "bad", completed_at: "not-a-date", budget: 100 });
    const months = earningsByMonth([JOBS[0], bad], PRO_FEE);
    expect(months.map((m) => m.month)).toEqual(["2026-08"]);
    expect(months[0].jobs).toBe(1);
  });

  it("earningsByMonth returns no axis at all when every date is unusable", () => {
    expect(earningsByMonth([job({ id: "a", completed_at: "" })], PRO_FEE)).toEqual([]);
  });
});
