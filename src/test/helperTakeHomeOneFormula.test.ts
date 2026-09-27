/**
 * Q765: a helper's take-home on a job is computed in ONE place,
 * helperTakeHomeDollars (src/lib/helperEarnings.ts).
 *
 * The admin JobsTab "Earnings" column hand-rolled `budget / N * (1 - fee%)`.
 * That dropped the urgent bonus, ignored the stamped platform_fee_amount on a
 * released row, and disagreed with what the helper's own Earnings page showed.
 * The admin pay summary (useAdminUserSummaries) and the admin analytics payout
 * totals (adminAnalyticsHelpers) had the same hand-rolled copy; all three now
 * call helperTakeHomeDollars.
 *
 * The inventory is every non-test .ts/.tsx under src/ except helperEarnings.ts
 * itself, scanned (comments blanked) for the two shapes a take-home takes by
 * hand: `(1 - …fee…)` and `budget/perHelper - commission/fee`. The allowlist is
 * exact in both directions: an entry that stops matching fails too.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

// @mutate src/components/admin/userDetail/JobsTab.tsx | return helperTakeHomeDollars(j, helperFeePercentOrLegacy(j.helper_fee_percent)); | return (budget / 1) * (1 - helperFeePercentOrLegacy(j.helper_fee_percent) / 100);
// @mutate src/components/admin/useAdminUserSummaries.ts | + helperTakeHomeDollars(j, helperFeePercentOrLegacy(j.helper_fee_percent)) | + Number(j.budget ?? 0) * (1 - helperFeePercentOrLegacy(j.helper_fee_percent) / 100)

const ROOT = resolve(__dirname, "../..");
const SHAPE =
  /\(\s*1\s*-\s*[a-z_.()]*fee|\b[a-z_]*(?:budget|perhelper)[a-z_]*\)?\s*-\s*[a-z_.]*(?:commission|fee)[a-z_]*/gi;

// @two-way src/test/helperTakeHomeOneFormula.test.ts:use helperTakeHomeDollars, or add an exact allowlist entry
/** file -> exact number of hand-rolled hits it is allowed, with why. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "src/components/dashboard/JobPrice.tsx": {
    count: 1,
    why: "pre-hire browse quote that itemises budget, fee and urgent bonus as separate figures",
  },
  "src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx": {
    count: 1,
    why: "pre-hire itemised receipt; each line is shown, and the one-time first-payout fee comes off after",
  },
  "src/pages/jobs/appliedJobCard/CancellationFeePill.tsx": {
    count: 1,
    why: "net of a cancellation fee, not a job take-home",
  },
};

function inventory(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const abs of walkSource([resolve(ROOT, "src")])) {
    const rel = relative(ROOT, abs);
    if (rel === "src/lib/helperEarnings.ts") continue;
    if (/(^|\/)test\/|\.test\.tsx?$|\.spec\.tsx?$/.test(rel)) continue;
    const n = [...blankComments(readFileSync(abs, "utf8")).matchAll(SHAPE)].length;
    if (n) out[rel] = n;
  }
  return out;
}

describe("helper take-home has one formula (Q765)", () => {
  const found = inventory();

  it("the scan reads the real tree", () => {
    expect(readFileSync(resolve(ROOT, "src/lib/helperEarnings.ts"), "utf8")).toMatch(
      /export function helperTakeHomeDollars/,
    );
    expect(walkSource([resolve(ROOT, "src")]).length).toBeGreaterThan(500);
  });

  it("no hand-rolled take-home outside helperEarnings.ts, and the allowlist is exact", () => {
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([f, v]) => [f, v.count]));
    expect(found, "use helperTakeHomeDollars, or add an exact allowlist entry with a reason").toEqual(expected);
  });

  it("the admin surfaces call helperTakeHomeDollars", () => {
    for (const f of [
      "src/components/admin/userDetail/JobsTab.tsx",
      "src/components/admin/useAdminUserSummaries.ts",
      "src/components/admin/adminAnalytics/adminAnalyticsHelpers.ts",
    ]) {
      expect(readFileSync(resolve(ROOT, f), "utf8"), f).toMatch(/helperTakeHomeDollars\(/);
    }
  });
});
