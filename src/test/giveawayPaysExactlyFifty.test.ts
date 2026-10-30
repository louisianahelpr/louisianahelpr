/**
 * Owner 2026-10-30: the "GIVE AWAY!!" job's winner takes home exactly $50, new
 * Helpr or not, and whatever is left stays with Louisiana Helpr. The job carries
 * one flat stamp (700, migration 20261030160851) that every money reader already
 * reads; on the same stamp a winner's unpaid setup fee is covered from the leftover
 * by the normal claim, so no figure the Helpr sees loses it.
 *
 * This guard holds every figure a Helpr can see for that job to $50 with the fee
 * owed and not owed, holds an ordinary job to what it paid before, and fails if
 * anything other than that one migration can write the stamp. The real transfers
 * are in src/test/edge/takeHomeMatchesReleasePayout.test.ts and
 * process-scheduled-payouts.test.ts, the labels in
 * src/components/dashboard/giveawayShowsNoWords.test.tsx, and the database side
 * (restamp, export, replay, CHECK) in src/test/pglite/giveawayWinnerTakesExactlyFifty.pglite.mjs.
 *
 * @mutate src/components/dashboard/JobPrice.tsx |     isGiveawayFixedPayJob(feeStamp) ? 0 : firstPayoutFeeDollars, |     firstPayoutFeeDollars,
 * @mutate src/lib/helperEarnings.ts |   const feeHere = job.status === "disputed" \|\| isGiveawayFixedPayJob(job) ? 0 : firstPayoutFeeDollars; |   const feeHere = job.status === "disputed" ? 0 : firstPayoutFeeDollars;
 * @mutate src/lib/helperEarnings.ts |     jobs.some((j) => !isGiveawayFixedPayJob(j)) ? firstPayoutFeeDollars : 0, |     firstPayoutFeeDollars,
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   jobs.some((j) => isAwaitingTransfer(j) && !isGiveawayFixedPayJob(j)) ? firstPayoutFeeDollars : 0; |   jobs.some(isAwaitingTransfer) ? firstPayoutFeeDollars : 0;
 * @mutate src/components/dashboard/applyConfirmDialog/applyTakeHome.ts |   const firstPayoutFee = isGiveawayFixedPayJob(confirmApplyJob) ? 0 : owedFirstPayoutFee; |   const firstPayoutFee = owedFirstPayoutFee;
 * @mutate src/lib/helprFlatFee.ts | const GIVEAWAY_FIXED_PAY_FLAT_CENTS = 700; | const GIVEAWAY_FIXED_PAY_FLAT_CENTS = 70;
 * @mutate supabase/functions/_shared/helprFlatFee.ts | const GIVEAWAY_FIXED_PAY_FLAT_CENTS = 700; | const GIVEAWAY_FIXED_PAY_FLAT_CENTS = 70;
 * @mutate supabase/migrations/20261030160851_giveaway_winner_takes_exactly_fifty.sql |      SET helper_fee_flat_cents = 700, |      SET helper_fee_flat_cents = 70,
 * @mutate supabase/migrations/20261030160851_giveaway_winner_takes_exactly_fifty.sql |       CHECK (helper_fee_flat_cents IS DISTINCT FROM 700 |       CHECK (helper_fee_flat_cents IS DISTINCT FROM 701
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeNet } from "@/components/dashboard/JobPrice";
import { useApplyTakeHome as applyTakeHomeOf } from "@/components/dashboard/applyConfirmDialog/applyTakeHome";
import type { EnrichedJob } from "@/components/dashboard/types";
import { comingToYou, earnedByJob, earnedDollarsWithLedger, firstPayoutFeeDueFrom } from "@/components/profile/earningsTab/earningsTabHelpers";
import { helperTakeHomeDollars, sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import { formatPriceFloor } from "@/lib/format";
import * as client from "@/lib/helprFlatFee";
import * as edge from "../../supabase/functions/_shared/helprFlatFee";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { walkSource } from "./helpers/walkSource";

const owed = vi.hoisted(() => ({ cents: 0 }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({
  useFirstPayoutFeeCents: () => owed.cents,
  useFirstPayoutFeeDollars: () => owed.cents / 100,
  useFirstPayoutFeeKnown: () => true,
}));

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MIGRATION = "supabase/migrations/20261030160851_giveaway_winner_takes_exactly_fifty.sql";
const JOB_ID = "11f8b084-ccd1-47b6-92ab-26338f701468";

const STAMP = { helper_fee_flat_cents: 700, helper_fee_percent: 5 };
const ORDINARY = { helper_fee_flat_cents: 70, helper_fee_percent: 5 };
const giveaway = { id: JOB_ID, budget: 60, urgent_fee: 0, is_group_job: false, helpers_needed: 1, ...STAMP };
const SETUP_FEE = 2;

describe("the giveaway stamp pays $50 on every figure, setup fee owed or not", () => {
  beforeEach(() => { owed.cents = 0; });

  it("the stamp is recognised the same in both runtimes, and only that stamp", () => {
    for (const m of [client, edge]) {
      expect(m.isGiveawayFixedPayJob(STAMP)).toBe(true);
      expect(m.isGiveawayFixedPayJob({ ...STAMP, helper_fee_flat_cents: "700" })).toBe(true);
      expect(m.helprFlatFeeCents(6000, STAMP)).toBe(1000);
      for (const other of [ORDINARY, { helper_fee_flat_cents: 0, helper_fee_percent: 0 }, { helper_fee_flat_cents: null, helper_fee_percent: 12 }, {}, null, undefined]) {
        expect(m.isGiveawayFixedPayJob(other)).toBe(false);
      }
    }
  });

  for (const feeDollars of [0, SETUP_FEE]) {
    const label = feeDollars ? "setup fee owed" : "setup fee not owed";

    it(`computeNet (job page, cards, chat, quick view): $50, ${label}`, () => {
      const { netEarnings } = computeNet(60, 12, 0, 1, feeDollars, STAMP);
      expect(netEarnings).toBe(50);
      expect(formatPriceFloor(netEarnings)).toBe("50");
    });

    it(`the apply sheet: $50 and no setup-fee line, ${label}`, () => {
      owed.cents = feeDollars * 100;
      const r = applyTakeHomeOf(giveaway as unknown as EnrichedJob, 12);
      expect(r.takeHome).toBe(50);
      expect(r.firstPayoutFee).toBe(0);
      expect(r.droppedCents).toBe(0);
    });

    it(`helperTakeHomeDollars (applied card, schedule, receipts' history), every payment state: $50, ${label}`, () => {
      for (const payment_status of ["escrow", "payout_pending", "released"]) {
        expect(helperTakeHomeDollars({ ...giveaway, payment_status }, 12, feeDollars)).toBe(50);
      }
      expect(sumHelperTakeHomeDollars([{ ...giveaway, payment_status: "payout_pending" }], 12, feeDollars)).toBe(50);
    });

    it(`Money and Home totals: $50 while it waits for its transfer, ${label}`, () => {
      const waiting = { ...giveaway, status: "completed", payment_status: "payout_pending", payout_scheduled_at: null };
      expect(firstPayoutFeeDueFrom([waiting], feeDollars)).toBe(0);
      expect(comingToYou([waiting], 12, feeDollars).cents).toBe(5000);
      expect(earnedDollarsWithLedger([waiting], 12, feeDollars, [])).toBe(50);
      const { byJob, feeOwed } = earnedByJob([waiting], 12, feeDollars, []);
      expect(byJob.get(JOB_ID)).toBe(50);
      expect(feeOwed).toBe(0);
    });
  }

  it("ordinary jobs are unchanged: $56, or $54 while the setup fee is owed", () => {
    expect(computeNet(60, 12, 0, 1, 0, ORDINARY).netEarnings).toBeCloseTo(56.3);
    expect(computeNet(60, 12, 0, 1, SETUP_FEE, ORDINARY).netEarnings).toBeCloseTo(54.3);
    owed.cents = 200;
    expect(applyTakeHomeOf({ ...giveaway, ...ORDINARY } as unknown as EnrichedJob, 12).takeHome).toBe(54);
    const waiting = { ...giveaway, ...ORDINARY, status: "completed", payment_status: "payout_pending" };
    expect(helperTakeHomeDollars(waiting, 12, SETUP_FEE)).toBe(54);
    expect(firstPayoutFeeDueFrom([waiting], SETUP_FEE)).toBe(SETUP_FEE);
    expect(comingToYou([waiting], 12, SETUP_FEE).cents).toBe(5400);
  });

  it("the fee still comes off once when an ordinary job waits beside the giveaway", () => {
    const a = { ...giveaway, status: "completed", payment_status: "payout_pending" };
    const b = { ...giveaway, ...ORDINARY, id: "other", status: "completed", payment_status: "payout_pending" };
    expect(firstPayoutFeeDueFrom([a, b], SETUP_FEE)).toBe(SETUP_FEE);
    expect(comingToYou([a, b], 12, SETUP_FEE).cents).toBe(5000 + 5600 - 200);
  });
});

describe("nothing else can write the giveaway stamp", () => {
  it("the migration names the one job, says why, and adds the CHECK that refuses 700 elsewhere", () => {
    const sql = blankSqlComments(read(MIGRATION));
    expect(sql).toContain(`j.id = '${JOB_ID}'`);
    expect(sql).toMatch(/SET helper_fee_flat_cents = 700,\s+platform_fee_amount = 10\.00/);
    expect(sql).toMatch(/set\s+local\s+app\.paid_job_fee_rewrite\s*=\s*'owner decision 2026-10-30:[^']+'/i);
    expect(sql).toContain("ADD CONSTRAINT jobs_giveaway_flat_stamp_is_one_job");
    expect(sql).toMatch(new RegExp(`CHECK \\(helper_fee_flat_cents IS DISTINCT FROM 700\\s+OR id = '${JOB_ID}'\\)`));
    expect(sql).toContain("j.helper_fee_flat_cents = 70");
    expect(sql.indexOf("ADD CONSTRAINT jobs_giveaway_flat_stamp_is_one_job"), "the table lock comes before the row update").toBeLessThan(sql.indexOf("UPDATE public.jobs j"));
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = j.id)");
    for (const c of ["F1 [fix]", "F2 [fix]", "F3 [fix]", "F4 [fix]", "F5 [fix]", "F6 [fix]", "K1 [keep]", "K2 [keep]", "K3 [keep]", "K4 [keep]", "K5 [keep]", "K6 [keep]", "K7 [keep]", "--before"]) {
      expect(read("src/test/pglite/giveawayWinnerTakesExactlyFifty.pglite.mjs"), c).toContain(c);
    }
  });

  it("no later migration drops the CHECK, and no other migration stamps 700", () => {
    const dir = resolve(ROOT, "supabase/migrations");
    const files = migrationFiles(dir);
    expect(files.length).toBeGreaterThan(1000);
    const self = MIGRATION.split("/").pop()!;
    for (const f of files) {
      if (f === self) continue;
      const sql = blankSqlComments(readFileSync(resolve(dir, f), "utf8"));
      expect(sql, f).not.toMatch(/helper_fee_flat_cents\s*=\s*700\b/);
      expect(sql, f).not.toMatch(/drop\s+constraint\s+(if\s+exists\s+)?jobs_giveaway_flat_stamp_is_one_job/i);
    }
  });

  it("every edge write of the stamp is a known expression: 0, the standard constant, or a copy of the parent's stamp", () => {
    const files = walkSource([resolve(ROOT, "supabase/functions")], [".ts"]);
    expect(files.length).toBeGreaterThan(100);
    const allowed = new Set([
      "0",
      "HELPR_FLAT_FEE_CENTS",
      "String(isPosterFee ? 0 : HELPR_FLAT_FEE_CENTS)",
      "isPosterFee ? 0 : HELPR_FLAT_FEE_CENTS",
      "isFlatFeeJob(parent) ? Number(parent.helper_fee_flat_cents) : null",
    ]);
    const writes: string[] = [];
    for (const f of files) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(/\bhelper_fee_flat_cents\s*:\s*([^,\n]+?)\s*,?\s*$/gm)) {
        // A type annotation or a pass-through of the row's own value is a read, not a stamp.
        if (/^(number|string|job\.|\w+\.helper_fee_flat_cents)/.test(m[1])) continue;
        writes.push(m[1]);
        expect(allowed.has(m[1]), `${f}: helper_fee_flat_cents: ${m[1]}`).toBe(true);
      }
    }
    expect(writes.length).toBeGreaterThanOrEqual(4);
  });

  it("the value is private to the two helprFlatFee modules: nothing else can spell it", () => {
    for (const p of ["src/lib/helprFlatFee.ts", "supabase/functions/_shared/helprFlatFee.ts"]) {
      const code = blankComments(read(p));
      expect(code).toContain("const GIVEAWAY_FIXED_PAY_FLAT_CENTS = 700;");
      expect(code).not.toContain("export const GIVEAWAY_FIXED_PAY_FLAT_CENTS");
    }
  });

  it("both payout paths use the one normal claim: no second write of the flag for the giveaway", () => {
    for (const p of ["supabase/functions/release-payout/index.ts", "supabase/functions/process-scheduled-payouts/index.ts"]) {
      const code = blankComments(read(p));
      expect(code, p).toContain("isGiveawayFixedPayJob(job)");
      expect(code, p).not.toMatch(/onboardingFeeCents > 0 && !isGiveawayFixedPayJob/);
      // The claim's own UPDATE and the two rollbacks are the only writers of the flag.
      expect(code.match(/onboarding_fee_paid: true/g)?.length, p).toBe(1);
    }
  });

  // @mutate supabase/functions/money-reconciliation/index.ts |       const expectedCents = Math.round(money(job.platform_fee_amount) * 100) - leftoverSetupFeeCents; |       const expectedCents = Math.round(money(job.platform_fee_amount) * 100);
  it("money-reconciliation reads the giveaway's setup fee from its ledger row, and only the giveaway's", () => {
    const code = blankComments(read("supabase/functions/money-reconciliation/index.ts"));
    expect(code).toContain("stripe_transfer_id, metadata");
    expect(code).toContain("const leftoverSetupFeeCents = isGiveawayFixedPayJob(job)");
    expect(code).toContain("const expectedCents = Math.round(money(job.platform_fee_amount) * 100) - leftoverSetupFeeCents;");
  });
});
