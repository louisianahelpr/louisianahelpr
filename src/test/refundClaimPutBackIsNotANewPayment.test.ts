import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * Q1319 (lh-money-escrow review of Q1290, 2026-10-05): putting a refund claim
 * back is not a new payment.
 *
 * 'cancelling' is a refund-in-flight claim (cancel_escrow from escrow; a full
 * admin refund, Q1290, from whatever the job read). Every stop before a refund
 * can exist puts it BACK, and notify_on_payment_escrowed() (AFTER UPDATE ON
 * jobs, no WHEN) announced that as a change INTO 'escrow' ("Payment secured",
 * "Job funded ... Get to work!") or INTO 'released' ("Payout released").
 *
 * THE INVENTORY is derived from create-payment: every jobs write that is a
 * compare-and-set on payment_status 'cancelling' and puts a state back. A
 * put-back to the state the job was READ in can be any state, so every block
 * the trigger has must be gated on OLD.payment_status IS DISTINCT FROM
 * 'cancelling' in its newest (effective) definition. Behaviour is proved in
 * PGlite by src/test/pglite/refundClaimPutBackIsNotANewPayment.pglite.mjs.
 *
 * @mutate supabase/migrations/20261005064123_refund_claim_put_back_is_not_a_new_payment.sql | AND OLD.payment_status IS DISTINCT FROM 'chargeback'\n     AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN\n    v_title | AND OLD.payment_status IS DISTINCT FROM 'chargeback' THEN\n    v_title
 * @mutate supabase/migrations/20261005064123_refund_claim_put_back_is_not_a_new_payment.sql | AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN\n    SELECT COALESCE | THEN\n    SELECT COALESCE
 * @mutate supabase/migrations/20261005064123_refund_claim_put_back_is_not_a_new_payment.sql | AND OLD.payment_status IS DISTINCT FROM 'cancelling' THEN\n    FOR v_member IN | THEN\n    FOR v_member IN
 */

const REPO = resolve(__dirname, "../..");
const MIGRATIONS = resolve(REPO, "supabase/migrations");
const FIX = "20261005064123_refund_claim_put_back_is_not_a_new_payment.sql";

/** create-payment writes that put a 'cancelling' claim back (CAS on 'cancelling', a payment_status other than a terminal one). */
function putBackSites(): number {
  const src = blankComments(readFileSync(resolve(REPO, "supabase/functions/create-payment/index.ts"), "utf8"));
  let n = 0;
  for (const m of src.matchAll(/\.update\(\{\s*payment_status:\s*([^,\n}]+)\s*\}\)/g)) {
    const chainEnd = src.indexOf(".select(", m.index!);
    const chain = src.slice(m.index!, chainEnd === -1 ? m.index! + 400 : chainEnd);
    if (!/\.eq\("payment_status", "cancelling"\)/.test(chain)) continue;
    if (/"(?:refunded|cancelled|cancelling)"/.test(m[1])) continue;
    n++;
  }
  return n;
}

/** The IF conditions guarding the trigger blocks that announce a payment. */
function announcingBlocks(def: string): string[] {
  return [...def.matchAll(/IF\s+([\s\S]*?)\s+THEN/g)]
    .map((m) => m[1])
    .filter((cond) => /NEW\.payment_status = '(?:escrow|released)'/.test(cond));
}

describe("Q1319: putting a 'cancelling' claim back is not announced as a new payment", () => {
  const def = effectiveDefs(MIGRATIONS).get("notify_on_payment_escrowed")?.stmt ?? "";

  it("finds create-payment's claim put-backs (inventory floor)", () => {
    // cancel_escrow's putCancelClaimBack + the crew re-check, and admin_refund_general's putGeneralClaimBack.
    expect(putBackSites()).toBeGreaterThanOrEqual(3);
  });

  it("every announcing block is gated on OLD.payment_status IS DISTINCT FROM 'cancelling'", () => {
    expect(def, "notify_on_payment_escrowed is not defined by any migration").not.toBe("");
    const blocks = announcingBlocks(def);
    // escrow (poster + Helpr), released (Helpr), released (crew members).
    expect(blocks).toHaveLength(3);
    for (const cond of blocks) expect(cond).toMatch(/OLD\.payment_status IS DISTINCT FROM 'cancelling'/);
  });

  it("is red on the definition before the fix (the check can fail)", () => {
    const before = effectiveDefs(MIGRATIONS, { before: FIX }).get("notify_on_payment_escrowed")?.stmt ?? "";
    expect(announcingBlocks(before).filter((c) => /'cancelling'/.test(c))).toHaveLength(0);
  });

  it("the restatement keeps the trigger function service-role only", () => {
    const file = readFileSync(resolve(MIGRATIONS, FIX), "utf8");
    expect(file).toMatch(/REVOKE ALL ON FUNCTION public\.notify_on_payment_escrowed\(\) FROM PUBLIC, anon, authenticated;/);
    expect(file).toMatch(/GRANT EXECUTE ON FUNCTION public\.notify_on_payment_escrowed\(\) TO service_role;/);
  });
});
