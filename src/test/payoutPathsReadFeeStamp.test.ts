// Jobs flat fee (roadmap F3, owner 2026-10-14/15): a job funded on the flat
// model carries the stamp jobs.helper_fee_flat_cents. A payout path that reads
// a job WITHOUT that column sees `isFlatFeeJob(job) === false` and silently
// prices the job on the old tier ladder (8-12% instead of 5% + 70c), with no
// error anywhere. This guard closes that class, built from the edge code's own
// inventory:
//
//   (A) every `.from("jobs")` read in supabase/functions that selects
//       `helper_fee_percent` also selects `helper_fee_flat_cents` (a percent
//       without the stamp is the exact trap);
//   (B) a Helpr commission is computed only through jobHelprCommissionDollars
//       (which honours the stamp); the legacy-only helperCommissionDollars is
//       called nowhere else except an EXACT allowlist;
//   (D) a job object REBUILT by hand (an object literal copying
//       helper_fee_percent from a row) copies helper_fee_flat_cents too: the
//       void-cancelled-payments Part E retry dropped it and priced a flat
//       job's cancellation fee on the tier ladder (lh-money-escrow review,
//       2026-10-15, N1);
//   (C) create-payment charges the poster the job price only (no "Service fee"
//       line, no urgent-bonus card-fee line, F3/F3b) and its escrow stamp
//       writes helper_fee_flat_cents.
//
// @mutate supabase/functions/release-payout/index.ts | helper_fee_percent, helper_fee_flat_cents, is_seed | helper_fee_percent, is_seed
// @mutate supabase/functions/void-cancelled-payments/index.ts | customer_id, helper_fee_percent, helper_fee_flat_cents, is_group_job, | customer_id, helper_fee_percent, is_group_job,
// @mutate supabase/functions/auto-release-payment/index.ts | const helperCommission = jobHelprCommissionDollars(job, perHelperBudget, helperFeePercent, netUrgentFeeDollars(job.urgent_fee) / helpersCount); | const helperCommission = helperCommissionDollars(perHelperBudget, helperFeePercent);
// @mutate supabase/functions/void-cancelled-payments/index.ts | helper_fee_percent: job.helper_fee_percent, helper_fee_flat_cents: job.helper_fee_flat_cents }, | helper_fee_percent: job.helper_fee_percent },
// @mutate supabase/functions/create-payment/index.ts |             platform_fee_amount: escrowFlatFeeCents / 100, |             platform_fee_amount: 0,
// @mutate src/hooks/useProfileTabData.ts | readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}, helper_fee_flat_cents`, | readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}`,
// @mutate supabase/functions/create-payment/index.ts | const customerFeeAmount = 0; | const customerFeeAmount = urgentBonusCardFeeCents(urgentFeeCents) / 100;
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// The shared listing (Q1142): supabase/functions is outside src/, so it passes
// through to the real readdirSync; the guard only needs one import shape.
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = path.resolve(__dirname, "../..");
const FN_DIR = path.join(ROOT, "supabase/functions");

function edgeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...edgeFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const FILES = edgeFiles(FN_DIR).map((abs) => ({
  rel: path.relative(ROOT, abs),
  code: blankComments(readFileSync(abs, "utf8")),
}));

/** Every `.from("jobs") ... .select("<cols>")` column list, with its file. */
function jobsSelects(): { rel: string; cols: string }[] {
  const out: { rel: string; cols: string }[] = [];
  for (const f of FILES) {
    const re = /\.from\(\s*["']jobs["']\s*\)\s*\.select\(\s*(["'`])([\s\S]*?)\1/g;
    for (const m of f.code.matchAll(re)) out.push({ rel: f.rel, cols: m[2] });
  }
  return out;
}

describe("payout paths read the jobs fee-model stamp (F3)", () => {
  it("(A) every jobs read that selects helper_fee_percent also selects helper_fee_flat_cents", () => {
    const all = jobsSelects();
    // Inventory floor: the scan really is reading the edge code's jobs selects.
    expect(all.length).toBeGreaterThan(80);
    const withPercent = all.filter((s) => /\bhelper_fee_percent\b/.test(s.cols));
    expect(withPercent.length).toBeGreaterThan(8);
    const missing = withPercent
      .filter((s) => !/\bhelper_fee_flat_cents\b/.test(s.cols))
      .map((s) => `${s.rel}: ${s.cols.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(missing).toEqual([]);
  });

  it("(B) the legacy-only helperCommissionDollars is called only where a flat job cannot reach it", () => {
    // money-reconciliation: the live-tier drift check, which skips a flat job
    // first (isFlatFeeJob) and grades it against its stamp instead.
    // Exact both ways: a caller added fails, and an entry whose file no longer
    // calls it fails as a stale allowlist entry.
    // @two-way src/test/payoutPathsReadFeeStamp.test.ts:stale helperCommissionDollars allowlist entry
    const ALLOWED = ["supabase/functions/_shared/helperFees.ts", "supabase/functions/money-reconciliation/index.ts"];
    const callers = FILES.filter((f) => /\bhelperCommissionDollars\s*\(/.test(f.code)).map((f) => f.rel).sort();
    for (const entry of ALLOWED) {
      expect(callers, `stale helperCommissionDollars allowlist entry ${entry} — remove it`).toContain(entry);
    }
    expect(callers).toEqual(ALLOWED.slice().sort());
    const flatCallers = FILES.filter((f) => /\bjobHelprCommissionDollars\s*\(/.test(f.code)).map((f) => f.rel);
    // Every path that pays a Helpr a job's money prices it through the stamp.
    for (const fn of [
      "release-payout", "process-scheduled-payouts", "auto-release-payment",
      "execute-dispute-split", "create-payment", "charge-recurring-visits", "money-reconciliation",
    ]) {
      expect(flatCallers).toContain(`supabase/functions/${fn}/index.ts`);
    }
  });

  it("(C) create-payment charges the job price only and stamps the flat model", () => {
    const cp = FILES.find((f) => f.rel === "supabase/functions/create-payment/index.ts")!.code;
    // The one "Service fee" line left is a recurring visit paid on-session,
    // priced from its own row (charge-recurring-visits writes fee_cents 0 on a
    // flat series; a series funded before F3 keeps the fee it was sold with).
    const serviceLines = [...cp.matchAll(/name:\s*"Service fee"/g)].length;
    const rowPriced = [...cp.matchAll(/name:\s*"Service fee",\s*tax_code:\s*NONTAXABLE_TAX_CODE\s*\},\s*unit_amount:\s*row\.fee_cents/g)].length;
    expect(rowPriced).toBe(1);
    expect(serviceLines).toBe(rowPriced);
    expect(cp).not.toMatch(/name:\s*"Urgent bonus card fee"/);
    expect(cp).not.toMatch(/\burgentBonusCardFeeCents\s*\(/);
    expect(cp).toMatch(/const customerFeeAmount = 0;/);
    // The model stamp also records the flat fee (review N4), so a gift-funded
    // job is never graded against a NULL platform_fee_amount.
    expect(cp).toMatch(/\.update\(\{\s*helper_fee_flat_cents:\s*HELPR_FLAT_FEE_CENTS,\s*helper_fee_percent:\s*HELPR_FLAT_FEE_PERCENT,\s*platform_fee_amount:\s*escrowFlatFeeCents \/ 100,?\s*\}\)/);
    // ...summed over the crew (Q1845): each member's 5% + 70c on their share.
    expect(cp).toMatch(/const escrowFlatFeeCents = jobFlatFeeTotalCents\(Math\.round\(job\.budget \* 100\), urgentFeeCents, escrowHelprCount\);/);
  });

  it("(D) a job object rebuilt by hand carries the stamp with the percent", () => {
    const literals: { rel: string; text: string }[] = [];
    for (const f of FILES) {
      const re = /\{[^{}]*\bhelper_fee_percent:\s*[A-Za-z_$][\w$]*\.[^{}]*\}/g;
      for (const m of f.code.matchAll(re)) literals.push({ rel: f.rel, text: m[0] });
    }
    // Inventory floor: the Part E retry literal is found at all.
    expect(literals.length).toBeGreaterThan(0);
    const missing = literals
      .filter((l) => !/\bhelper_fee_flat_cents\b/.test(l.text))
      .map((l) => `${l.rel}: ${l.text.replace(/\s+/g, " ").slice(0, 160)}`);
    expect(missing).toEqual([]);
  });

  it("(E) the helper's Earnings read carries the stamp (review N3)", () => {
    // useProfileEarnings feeds the Earnings tab and the Profile total; without
    // the stamp a flat job's take-home is priced on the viewer's tier, or at
    // 5% with no 70c once a crew job settles (more than the transfer).
    const src = blankComments(readFileSync(path.join(ROOT, "src/hooks/useProfileTabData.ts"), "utf8"));
    const start = src.indexOf("export function useProfileEarnings");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\nexport function ", start + 10);
    const body = src.slice(start, end > 0 ? end : undefined);
    expect(body).toMatch(/from\("jobs"\)/);
    expect(body).toMatch(/helper_fee_flat_cents/);
  });
});
