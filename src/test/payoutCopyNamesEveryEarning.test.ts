/**
 * AUD31-56 (Money, Low). The payout account carries more than job pay: Declutter sales and Helpr delivery pay go to the
 * same bank. Yet the "payout account verified" notice said "You can now receive payments for completed jobs." (sent
 * from two places: the Stripe account.updated handler and the status re-sync) and Money's bank card said "Payouts run
 * automatically to your default method when jobs are completed." A seller who only sells on Declutter read that their
 * bank was for something else.
 *
 * CLASS: no copy string in the app or an edge function says payouts or payments are only for jobs. Inventory: every
 * .ts/.tsx under src/ and supabase/functions/ (tests excluded), comments blanked; a string literal or JSX text is an
 * offender when it speaks of payouts/payments/getting paid AND of jobs in general ("for completed jobs", "when jobs
 * are completed"; one job's own line, "this job", is not this class), and names neither Declutter, sales nor
 * deliveries.
 *
 * @mutate supabase/functions/_shared/connectGateSync.ts | message: "Your payout account is fully set up! You can now get paid for jobs, Declutter sales and deliveries.", | message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | message: "Your payout account is fully set up! You can now get paid for jobs, Declutter sales and deliveries.", | message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
 * @mutate src/components/PayoutSetupForm.tsx | Payouts run automatically to your default method when a job, a Declutter sale or a delivery is done. | Payouts run automatically to your default method when jobs are completed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const MONEY = /\b(payouts?|payments?|get paid|paid out)\b/i;
/** Jobs in general (plural, no "this job"): what the money is FOR, not one job's own line. */
const JOBS = /\b(for|from) (completed |finished |your )?jobs\b|\bwhen (your )?jobs (are|get) (completed|done|finished)\b/i;
const OTHER_EARNINGS = /declutter|\bsales?\b|deliver/i;

/** String literals ('..', "..", `..` without ${}) in a source with its comments blanked. */
function literals(src: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** JSX text runs (between > and <) too: the bank card's line is JSX text, not a literal. */
function jsxText(src: string): string[] {
  return [...src.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1].replace(/\s+/g, " ").trim());
}

export function jobOnlyPayoutCopy(src: string): string[] {
  const code = blankComments(src);
  return [...literals(code), ...jsxText(code)].filter((s) => s.includes(" ") && MONEY.test(s) && JOBS.test(s) && !OTHER_EARNINGS.test(s));
}

const files = walkSource([resolve(ROOT, "src"), resolve(ROOT, "supabase/functions")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/src/test/"));

describe("payout copy names every way a member earns, not only jobs (AUD31-56)", () => {
  it("reads a real inventory", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("the detector sees the old wording and passes the new", () => {
    expect(jobOnlyPayoutCopy(`const m = "You can now receive payments for completed jobs.";`)).toHaveLength(1);
    expect(jobOnlyPayoutCopy(`<p>\n  Payouts run automatically to your default method when jobs are completed.\n</p>`)).toHaveLength(1);
    expect(jobOnlyPayoutCopy(`const m = "You can now get paid for jobs, Declutter sales and deliveries.";`)).toHaveLength(0);
  });

  it("no app or edge-function copy says payouts are only for jobs", () => {
    const hits: string[] = [];
    for (const f of files) {
      for (const s of jobOnlyPayoutCopy(readFileSync(f, "utf8"))) hits.push(`${relative(ROOT, f)}: ${s.slice(0, 120)}`);
    }
    expect(hits).toEqual([]);
  });
});
