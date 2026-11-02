/**
 * Q1415 (e): a late cancel charges no fee for a confirmed Helpr who is banned or under an open ban review. The SQL
 * (poster_cancel_job) decides it with cancel_fee_payee_frozen; every money layer must agree, or the poster is charged
 * a fee the dialog never showed (void-cancelled-payments re-pricing the 0 on the ladder) or refused quote_changed
 * (create-payment's quote sending the ladder fee). The layers, read from the source:
 *   - poster_cancel_job (newest definition) asks cancel_fee_payee_frozen AND writes a job_cancel_id_waivers row with
 *     reason 'payee_frozen' (what void-cancelled-payments and money-reconciliation settle a single job's 0 from);
 *   - void-cancelled-payments and money-reconciliation read that table for single jobs;
 *   - create-payment's cancel quote asks cancel_fee_payee_frozen.
 * Behaviour: src/test/pglite/cancelFeeWaivedPayeeUnderReview.pglite.mjs and
 * src/test/edge/posterCancelQuoteMatchesRefund.test.ts (quote == sweep refund for a frozen Helpr).
 *
 * @mutate supabase/migrations/20261102074317_cancel_fee_waived_payee_under_review.sql |     INSERT INTO public.job_cancel_id_waivers (job_id, reason) VALUES (v_job.id, 'payee_frozen') ON CONFLICT (job_id) DO NOTHING; |     NULL;
 * @mutate supabase/functions/create-payment/index.ts | await supabaseAdmin.rpc("cancel_fee_payee_frozen", { p_user: qJob.helper_id }) | { data: false, error: null }
 * @mutate supabase/functions/void-cancelled-payments/index.ts |         .from("job_cancel_id_waivers") |         .from("job_cancel_waivers_gone")
 * @mutate supabase/functions/_shared/crewShares.ts |   const pct = cancellationFeePercent(committed, hoursUntilStart); |   const pct = cancellationFeePercent(true, hoursUntilStart);
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { crewCancellationFee } from "../../supabase/functions/_shared/crewShares";

const ROOT = path.resolve(__dirname, "../..");
const code = (p: string) => blankComments(fs.readFileSync(path.join(ROOT, p), "utf8"));

describe("a frozen Helpr's waived cancel fee: SQL and every edge caller agree", () => {
  const body = newestFunction("poster_cancel_job").body;

  it("poster_cancel_job asks cancel_fee_payee_frozen and records the waiver for the money paths", () => {
    const asks = body.match(/public\.cancel_fee_payee_frozen\(/g) ?? [];
    expect(asks.length).toBeGreaterThan(3);
    expect(body).toMatch(/INSERT INTO public\.job_cancel_id_waivers \(job_id, reason\) VALUES \(v_job\.id, 'payee_frozen'\)/);
  });

  it("both settlement paths read the waiver table", () => {
    for (const f of ["supabase/functions/void-cancelled-payments/index.ts", "supabase/functions/money-reconciliation/index.ts"]) {
      expect(code(f), f).toMatch(/\.from\("job_cancel_id_waivers"\)/);
    }
  });

  it("create-payment's cancel quote asks the same function, so its fee is the one the SQL records", () => {
    const cp = code("supabase/functions/create-payment/index.ts");
    const start = cp.indexOf('action === "cancel_quote"');
    expect(start).toBeGreaterThan(0);
    const quote = cp.slice(start, start + 6000);
    expect(quote).toMatch(/\.rpc\("cancel_fee_payee_frozen", \{ p_user: qJob\.helper_id \}\)/);
  });

  // The crew path needs no waiver: poster_cancel_job stores a frozen member's share as committed=false at 0%, and the
  // sweep and money-reconciliation re-price each share from its OWN committed flag (no "share does not match" page).
  it("a crew's frozen member share (committed=false, $0) re-prices clean; the others keep theirs", () => {
    const at = new Date(Date.now() + 5 * 3600 * 1000);
    const date = at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const time = at.toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour12: false });
    const priced = crewCancellationFee(
      { budget: 200, date_needed: date, start_time: time, cancelled_at: new Date().toISOString() },
      [
        { helper_id: "frozen", committed: false, share_basis_cents: 10000, share_amount: "0" },
        { helper_id: "other", committed: true, share_basis_cents: 10000, share_amount: "25" },
      ],
    );
    expect(priced).toEqual({ total: 25, mismatch: null });
  });
});
