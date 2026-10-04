/**
 * Q753 (ME-008 follow-up): every surface that shows a Helpr a payout amount
 * takes the one-time setup fee off it, from ONE shared source
 * (src/lib/firstPayoutFee.ts, fed by useFirstPayoutFeeCents).
 *
 * `release-payout` and `process-scheduled-payouts` deduct the fee from the
 * FIRST payout of an unpaid account. Only the apply sheet knew; the feed chip,
 * compact row, job-detail pill, My Jobs, Schedule, Earnings and the forecast
 * all read higher than what landed.
 *
 * The inventory is every call of the three take-home functions in non-test
 * src/ code (comments and strings blanked). A call is fee-aware when its
 * argument list names `firstPayoutFee`. Every other call must sit in EXEMPT,
 * which is exact in both directions: a stale entry, or an exempt file that has
 * since become fee-aware, fails too.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankNonCode } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

// @mutate src/components/dashboard/JobPrice.tsx | helpersNeeded, firstPayoutFee); | helpersNeeded);
// @mutate src/components/dashboard/CompactJobCard.tsx | helpers, firstPayoutFee).netEarnings | helpers).netEarnings
// @mutate src/components/dashboard/JobCard.tsx | helpersCount, firstPayoutFee).netEarnings | helpersCount).netEarnings
// @mutate src/pages/jobs/appliedJobCard/appliedJobCardHelpers.ts | isSettledForDisplay(job) ? 0 : firstPayoutFeeDollars, | 0,
// @mutate src/components/profile/ScheduleTab.tsx | isSettledForDisplay(job) ? 0 : firstPayoutFee | 0
// @mutate src/components/profile/EarningsTab.tsx | sumHelperTakeHomeDollars(completedJobs, helperFeeFallbackPct, firstPayoutFeeDueFrom(completedJobs, firstPayoutFee)) | sumHelperTakeHomeDollars(completedJobs, helperFeeFallbackPct)
// @mutate src/pages/profile/Profile.tsx | helperFeeFallbackPct, firstPayoutFee); | helperFeeFallbackPct);

const ROOT = resolve(__dirname, "../..");
const CALL = /(?<!function\s)\b(computeNet|helperTakeHomeDollars|sumHelperTakeHomeDollars)\s*\(/g;
const DEFINITIONS = new Set(["src/lib/helperEarnings.ts"]);

/** The text inside the balanced parentheses that open at `open`. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

interface Counts { aware: number; unaware: number }

function inventory(): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  for (const abs of walkSource([resolve(ROOT, "src")])) {
    const rel = relative(ROOT, abs);
    if (DEFINITIONS.has(rel)) continue;
    if (/(^|\/)test\/|\.test\.tsx?$|\.spec\.tsx?$/.test(rel)) continue;
    const src = blankNonCode(readFileSync(abs, "utf8"));
    const c: Counts = { aware: 0, unaware: 0 };
    for (const m of src.matchAll(CALL)) {
      const args = argsAt(src, m.index! + m[0].length - 1);
      if (/firstPayoutFee/i.test(args)) c.aware++;
      else c.unaware++;
    }
    if (c.aware + c.unaware) out[rel] = c;
  }
  return out;
}

// @two-way src/test/firstPayoutFeeEverySurface.test.ts:and EXEMPT is exact
/** file -> exact number of fee-unaware calls it may keep, and why that is right. */
const EXEMPT: Record<string, { count: number; why: string }> = {
  "src/components/admin/adminAnalytics/adminAnalyticsHelpers.ts": { count: 2, why: "admin reporting over OTHER users' jobs; the viewer's own first payout is not in play" },
  "src/components/admin/userDetail/JobsTab.tsx": { count: 1, why: "admin view of another user's job earnings" },
  "src/components/admin/useAdminUserSummaries.ts": { count: 1, why: "admin summary of other users' earnings" },
  "src/components/profile/EarningsTab.tsx": { count: 1, why: "MonthlyGoal: per-job progress toward a goal; the one-time fee is stated once and comes off the totals, never pinned to one job (lh-money-escrow review of Q753)" },
  "src/components/profile/earningsTab/EarningHistory.tsx": { count: 1, why: "each row is that job's own take-home; the fee is one line above the list (EarningHistory.firstPayoutFee.test.tsx), never pinned to a row (review of Q753)" },
  "src/components/profile/EarningsBreakdownCharts.tsx": { count: 2, why: "historical category/month distribution of completed work, not a payout preview (Q753 residual lives in OPEN.md)" },
  "src/components/profile/EarningsForecastCard.tsx": { count: 1, why: "sums inside the queryFn; the fee is applied ONCE at render with netAfterFirstPayoutFee (asserted below)" },
  "src/lib/helperAnalytics.ts": { count: 3, why: "analytics aggregates over completed jobs" },
  "src/lib/jobDisplayPay.ts": { count: 1, why: "sort key only: one constant off every job keeps the order, and jobs at or under the fee tie at the $0 the cards show" },
  "src/pages/profile/HelprWrapped.tsx": { count: 1, why: "year-in-review recap computed inside a queryFn over completed jobs" },
  "src/pages/profile/WorkRecord.tsx": { count: 1, why: "official earnings record built inside a queryFn over completed jobs" },
};

describe("every payout surface takes the first-payout fee off (Q753)", () => {
  const found = inventory();

  it("the scan reads the real tree", () => {
    expect(walkSource([resolve(ROOT, "src")]).length).toBeGreaterThan(500);
    const awareFiles = Object.values(found).filter((c) => c.aware > 0).length;
    // JobPrice, CompactJobCard, JobCard, ScheduleTab, appliedJobCardHelpers,
    // EarningsTab, EarningHistory, Profile (+ helperEarnings' own sum, outside the scan).
    expect(awareFiles).toBeGreaterThan(5); // 6 aware files on 2026-10-04 (EarningHistory states the fee on its own line)
    expect(Object.keys(found).length).toBeGreaterThan(15);
  });

  it("no unaware call outside EXEMPT, and EXEMPT is exact", () => {
    const unaware = Object.fromEntries(
      Object.entries(found).filter(([, c]) => c.unaware > 0).map(([f, c]) => [f, c.unaware]),
    );
    const expected = Object.fromEntries(Object.entries(EXEMPT).map(([f, v]) => [f, v.count]));
    expect(unaware, "pass the viewer's useFirstPayoutFeeDollars() to the call, or add an exact EXEMPT entry with a reason").toEqual(expected);
  });

  it("the forecast applies the fee once at render", () => {
    const src = blankNonCode(readFileSync(resolve(ROOT, "src/components/profile/EarningsForecastCard.tsx"), "utf8"));
    expect(src).toMatch(/netAfterFirstPayoutFee\(data\.projectedTotal,\s*firstPayoutFee\)/);
  });

  it("the apply sheet and the shared sums use the one shared function", () => {
    const apply = readFileSync(resolve(ROOT, "src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx"), "utf8");
    expect(apply).toMatch(/netAfterFirstPayoutFee\(/);
    const earnings = readFileSync(resolve(ROOT, "src/lib/helperEarnings.ts"), "utf8");
    expect(earnings).toMatch(/netAfterFirstPayoutFee\(/);
    expect(earnings).toMatch(/sumAfterFirstPayoutFee\(/);
  });
});
