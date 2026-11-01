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
//   (F) the APP side of (A) (Q1839): every client column list (src/, e2e/,
//       scripts/) that names helper_fee_percent names helper_fee_flat_cents,
//       and the shared whole-row list JOB_READABLE_COLUMN_LIST carries the
//       stamp, so every `.select(JOB_READABLE_COLUMNS)` read (Schedule,
//       admin analytics, Activity, Work record) has it. Five narrow selects
//       (Earnings forecast, Wrapped, admin export, admin Jobs tab, admin user
//       summaries) priced a flat job on the viewer's tier without it.
//   (G) the poster's cancel dialog is handed the stamp, so its "Helpr
//       receives at least" figure uses 5% + 70c on a flat job (Q1839).
//
// @mutate supabase/functions/release-payout/index.ts | helper_fee_percent, helper_fee_flat_cents, is_seed | helper_fee_percent, is_seed
// @mutate supabase/functions/void-cancelled-payments/index.ts | customer_id, helper_fee_percent, helper_fee_flat_cents, poster_fee_flat_cents, is_group_job, | customer_id, helper_fee_percent, poster_fee_flat_cents, is_group_job,
// @mutate supabase/functions/auto-release-payment/index.ts | const helperCommission = jobHelprCommissionDollars(job, perHelperBudget, helperFeePercent, netUrgentFeeDollars(job.urgent_fee) / helpersCount); | const helperCommission = helperCommissionDollars(perHelperBudget, helperFeePercent);
// @mutate supabase/functions/void-cancelled-payments/index.ts | helper_fee_percent: job.helper_fee_percent, helper_fee_flat_cents: job.helper_fee_flat_cents }, | helper_fee_percent: job.helper_fee_percent },
// @mutate supabase/functions/create-payment/index.ts |             platform_fee_amount: escrowFlatFeeCents / 100, |             platform_fee_amount: 0,
// @mutate src/lib/jobColumns.ts |   "helper_fee_flat_cents",\n  "helper_fee_percent", |   "helper_fee_percent",
// @mutate src/hooks/useProfileTabData.ts | const jobsQuery = supabase.from("jobs").select(JOB_READABLE_COLUMNS).neq("status", "cancelled"); | const jobsQuery = supabase.from("jobs").select("id, budget, helper_fee_percent, status").neq("status", "cancelled");
// @mutate src/components/profile/EarningsForecastCard.tsx | helper_fee_percent, helper_fee_flat_cents, urgent_fee | helper_fee_percent, urgent_fee
// @mutate src/pages/profile/HelprWrapped.tsx | customer_id, helper_fee_percent, helper_fee_flat_cents, platform_fee_amount | customer_id, helper_fee_percent, platform_fee_amount
// @mutate src/components/admin/AdminExport.tsx | platform_fee_percent, helper_fee_percent, helper_fee_flat_cents, is_group_job | platform_fee_percent, helper_fee_percent, is_group_job
// @mutate src/components/admin/useAdminUserSummaries.ts | budget, helper_fee_percent, helper_fee_flat_cents, platform_fee_amount | budget, helper_fee_percent, platform_fee_amount
// @mutate src/components/job-card/ActivityDialogs.tsx |           feeStamp={props.cancelDialogJob} |           feeStamp={null}
// @mutate src/components/browseMap/fetchJobForPin.ts | credential_tier, parish, helper_fee_flat_cents, helper_fee_percent"; | credential_tier, parish, helper_fee_percent";
// @mutate src/pages/home/QuickApplyHandler.tsx | latitude, longitude, helper_fee_flat_cents, helper_fee_percent"; | latitude, longitude, helper_fee_percent";
// @mutate supabase/functions/create-payment/index.ts | const customerFeeAmount = isPosterFee ? posterFeeCents / 100 : 0; | const customerFeeAmount = isPosterFee ? posterFeeCents / 100 : urgentBonusCardFeeCents(urgentFeeCents) / 100;
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// The shared listing (Q1142): supabase/functions is outside src/, so it passes
// through to the real readdirSync; the guard only needs one import shape.
import { readdirSync } from "./helpers/trackedFiles";
import { JOB_READABLE_COLUMN_LIST } from "@/lib/jobColumns";

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

  // (A') The reverse (lh-money-escrow review 2026-10-25, #2): since the fee on
  // new jobs became 10% + 70c, a read that carries the stamp but not its
  // percent prices a 5%-stamped job at the 10% fallback (helprFlatFeeCents).
  // @mutate supabase/functions/create-payment/index.ts | is_urgent, helper_fee_flat_cents, helper_fee_percent, poster_fee_flat_cents | is_urgent, helper_fee_flat_cents, poster_fee_flat_cents
  it("(A') every jobs read that selects helper_fee_flat_cents also selects helper_fee_percent", () => {
    const withStamp = jobsSelects().filter((s) => /\bhelper_fee_flat_cents\b/.test(s.cols));
    expect(withStamp.length).toBeGreaterThan(8);
    const missing = withStamp
      .filter((s) => !/\bhelper_fee_percent\b/.test(s.cols))
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
    // A recurring visit paid on-session is priced from its own row
    // (charge-recurring-visits writes fee_cents 0 on a flat series; a series
    // funded before F3 keeps the fee it was sold with). Owner 2026-10-25: that
    // older fee is folded into the visit line, never shown as a fee line.
    const serviceLines = [...cp.matchAll(/name:\s*"Service fee"/g)].length;
    const rowPriced = [...cp.matchAll(/unit_amount:\s*row\.budget_cents \+ Math\.max\(0, row\.fee_cents\)/g)].length;
    // The poster-fee model's line (owner 2026-10-18), only behind its stamp.
    const posterPriced = [...cp.matchAll(/if \(isPosterFee && posterFeeCents > 0\) \{\s*lineItems\.push\(\{[\s\S]{0,200}?name:\s*"Service fee"[\s\S]{0,400}?unit_amount:\s*posterFeeCents,/g)].length;
    expect(rowPriced).toBe(1);
    expect(posterPriced).toBe(1);
    expect(serviceLines).toBe(posterPriced);
    expect(cp).not.toMatch(/name:\s*"Urgent bonus card fee"/);
    expect(cp).not.toMatch(/\burgentBonusCardFeeCents\s*\(/);
    expect(cp).toMatch(/const customerFeeAmount = isPosterFee \? posterFeeCents \/ 100 : 0;/);
    // The model stamp also records the flat fee (review N4), so a gift-funded
    // job is never graded against a NULL platform_fee_amount.
    // Its flat branch (switch off, or a gift / recurring checkout): the
    // poster-fee branch (owner 2026-10-18) stamps the Helpr 0/0 instead.
    expect(cp).toMatch(/:\s*\{\s*\.\.\.\(job\.poster_fee_flat_cents != null \? \{ poster_fee_flat_cents: null \} : \{\}\),\s*helper_fee_flat_cents:\s*HELPR_FLAT_FEE_CENTS,\s*helper_fee_percent:\s*HELPR_FLAT_FEE_PERCENT,\s*platform_fee_percent:\s*POSTER_SERVICE_FEE_PERCENT,\s*customer_fee_amount:\s*0,\s*platform_fee_amount:\s*escrowFlatFeeCents \/ 100,?\s*\}\)/);
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
    expect(body).toMatch(/from\("jobs"\)\.select\(JOB_READABLE_COLUMNS\)/);
    expect(JOB_READABLE_COLUMN_LIST as readonly string[]).toContain("helper_fee_flat_cents");
  });

  it("(F) every app column list naming helper_fee_percent names the stamp too (Q1839)", () => {
    // The shared whole-row list: every `.select(JOB_READABLE_COLUMNS)` read.
    const readable = JOB_READABLE_COLUMN_LIST as readonly string[];
    expect(readable).toContain("helper_fee_percent");
    expect(readable).toContain("helper_fee_flat_cents");
    // Every literal column list (a quoted or template string of two or more
    // comma-separated columns) in app code that names helper_fee_percent.
    const lists: { rel: string; cols: string }[] = [];
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "node_modules" || name === "test" && dir.endsWith("/src") || name === "integrations") continue;
          out.push(...walk(p));
        } else if (/\.(ts|tsx|mjs)$/.test(p) && !/\.(test|spec)\.(ts|tsx|mjs)$/.test(p) && !p.endsWith(".d.ts")) out.push(p);
      }
      return out;
    };
    for (const root of ["src", "e2e", "scripts"]) {
      for (const abs of walk(path.join(ROOT, root))) {
        const code = blankComments(readFileSync(abs, "utf8"));
        // A list names the percent, or names the Helpr's pay inputs (urgent_fee
        // and helpers_needed: every browse / detail / map list the take-home
        // is computed from; the map-pin and deep-link dialog lists dropped the
        // stamp, lh-money-escrow review of this guard, #2-#4).
        for (const m of code.matchAll(/(["'`])([^"'`\n]*,[^"'`\n]*)\1/g)) {
          const c = m[2];
          if (/\bhelper_fee_percent\b/.test(c) || (/\burgent_fee\b/.test(c) && /\bhelpers_needed\b/.test(c))) {
            lists.push({ rel: path.relative(ROOT, abs), cols: c });
          }
        }
      }
    }
    // EXACT inventory (measured 2026-10-17), so a list added or removed moves
    // it in either direction: 8 name the percent, 6 more name the pay inputs.
    const MEASURED_LISTS = [
      "src/boot/guestJobsPrefetch.ts",
      "src/components/admin/AdminDisputes.tsx",
      "src/components/admin/AdminDisputes.tsx",
      "src/components/admin/AdminDisputes.tsx",
      "src/components/admin/AdminExport.tsx",
      "src/components/admin/adminusers/useOpenProfile.ts",
      "src/components/admin/useAdminUserSummaries.ts",
      "src/components/browseMap/fetchJobForPin.ts",
      "src/components/jobDone/JobDoneSummary.tsx",
      // The home Live now take-home (lead-prices-1, 2026-10-25): names the pay
      // inputs and the stamp, priced with computeNet like the /browse card.
      "src/components/landing/LiveJobsSection.tsx",
      // The chat job card's Helpr take-home (audit 2026-10-28 F2): names the pay
      // inputs and the stamp (helper_fee_flat_cents), priced by useHelprTakeHome.
      "src/components/messages/chatView/DealCard.tsx",
      "src/components/profile/EarningsForecastCard.tsx",
      "src/hooks/useDashboardData.ts",
      "src/lib/guestJobsQuery.ts",
      "src/pages/home/QuickApplyHandler.tsx",
      // The guest job preview's take-home (lead 10-31): the guest card's own figure, so it names the stamp too.
      "src/pages/jobs/JobDetail.tsx",
      "src/pages/jobs/jobPage/useJobPage.ts",
      "src/pages/jobs/jobPage/useJobPage.ts",
      "src/pages/profile/HelprWrapped.tsx",
      "src/pages/tips/TipMoment.tsx",
    ];
    expect(lists.map((l) => l.rel).sort()).toEqual(MEASURED_LISTS);
    const missing = lists
      .filter((l) => !/\bhelper_fee_flat_cents\b/.test(l.cols))
      .map((l) => `${l.rel}: ${l.cols.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(missing).toEqual([]);
  });

  it("(G) the poster's cancel dialog is handed the job's stamp (Q1839)", () => {
    const src = blankComments(readFileSync(path.join(ROOT, "src/components/job-card/ActivityDialogs.tsx"), "utf8"));
    const open = src.indexOf("<CancellationDialog");
    expect(open).toBeGreaterThan(-1);
    const tag = src.slice(open, src.indexOf("/>", open));
    expect(tag).toMatch(/\bfeeStamp=\{props\.cancelDialogJob\}/);
  });
});
