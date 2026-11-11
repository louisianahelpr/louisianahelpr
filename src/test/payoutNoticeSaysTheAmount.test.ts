/**
 * F479 (whole-app audit 11-10, Worker 6, Medium): the "Payout released" notice and its email gave no amount.
 * Migration 20261111200206: notify_on_payment_escrowed quotes the Helpr's own live payout_transfers row (pending or
 * paid), each crew member their own; with no row the old words stay, so no amount is computed or guessed.
 *
 * Reads the EFFECTIVE definition (newest CREATE, any dollar tag, comments blanked). Behaviour (real Postgres):
 * src/test/pglite/payoutNoticeSaysTheAmount.pglite.mjs (8 PASS; 4 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261111200206_payout_notice_says_the_amount.sql |                               WHERE t.job_id = NEW.id AND t.helper_id = NEW.helper_id AND t.status IN ('pending', 'paid') |                               WHERE t.job_id = NEW.id AND t.helper_id = NEW.helper_id
 * @mutate supabase/migrations/20261111200206_payout_notice_says_the_amount.sql |                                 WHERE t.job_id = NEW.id AND t.helper_id = v_member AND t.status IN ('pending', 'paid') |                                 WHERE t.job_id = NEW.id AND t.status IN ('pending', 'paid')
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");

describe("the payout notice says the amount (F479)", () => {
  it("both payout sentences read the recipient's own live transfer row", () => {
    const b = blankSqlComments(defs.get("notify_on_payment_escrowed")?.stmt ?? "").replace(/\s+/g, " ");
    expect(b.length).toBeGreaterThan(2000);
    expect(b).toContain("WHERE t.job_id = NEW.id AND t.helper_id = NEW.helper_id AND t.status IN ('pending', 'paid')");
    expect(b).toContain("WHERE t.job_id = NEW.id AND t.helper_id = v_member AND t.status IN ('pending', 'paid')");
    expect(b.match(/'\$' \|\| to_char\(t\.amount_cents \/ 100\.0, 'FM999990\.00'\)/g)?.length).toBe(2);
    expect(b).not.toContain(`'Your payout for "' || NEW.title`);
  });
});
