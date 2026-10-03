import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * Q805 (2) + the lh-money-escrow review of Q449 (2026-10-03): a job LEAVING a
 * card-dispute block is not a new payment, so the payment notices must not
 * announce one.
 *
 * notify_on_payment_escrowed() (AFTER UPDATE ON jobs, no WHEN) announces every
 * change INTO 'escrow' ("Payment secured" / "Job funded ... Get to work!") and
 * INTO 'released' ("Payout released", to the Helpr and every crew member). The
 * stripe-webhook moves a job OUT of 'chargeback' on the same money: a won
 * dispute after a repaid clawback (-> released), a won dispute on a decided
 * split (-> escrow / payout_pending, Q449), a dismissed inquiry (-> the
 * pre-chargeback state). Each fired a false notice.
 *
 * THE INVENTORY is derived from the handlers: every jobs write in
 * supabase/functions/stripe-webhook/handlers that is a compare-and-set on
 * payment_status 'chargeback' and writes a literal or one of the restore
 * helpers' states. Every target the trigger announces must be gated on
 * OLD.payment_status IS DISTINCT FROM 'chargeback' in the trigger's newest
 * (effective) definition. Behaviour is proved in PGlite by
 * src/test/pglite/chargebackReleaseIsNotANewPayment.pglite.mjs.
 *
 * @mutate supabase/migrations/20261003184911_chargeback_release_is_not_a_new_payment.sql | IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow')\n     AND OLD.payment_status IS DISTINCT FROM 'chargeback' THEN | IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow') THEN
 * @mutate supabase/migrations/20261003184911_chargeback_release_is_not_a_new_payment.sql | AND NEW.helper_id IS NOT NULL\n     AND OLD.payment_status IS DISTINCT FROM 'chargeback' THEN | AND NEW.helper_id IS NOT NULL THEN
 * @mutate supabase/migrations/20261003184911_chargeback_release_is_not_a_new_payment.sql | AND OLD.payment_status IS DISTINCT FROM 'released'\n     AND OLD.payment_status IS DISTINCT FROM 'chargeback' THEN\n    FOR v_member IN | AND OLD.payment_status IS DISTINCT FROM 'released' THEN\n    FOR v_member IN
 */

const REPO = resolve(__dirname, "../..");
const MIGRATIONS = resolve(REPO, "supabase/migrations");
const HANDLERS = "supabase/functions/stripe-webhook/handlers";
const FIX = "20261003184911_chargeback_release_is_not_a_new_payment.sql";

/** The payment_status values a webhook writes when it lifts a 'chargeback' block. */
function targetsOutOfChargeback(): Set<string> {
  const src = blankComments(readFileSync(resolve(REPO, `${HANDLERS}/chargeDisputeClosed.ts`), "utf8"));
  const out = new Set<string>();
  // Each `.update({ payment_status: X ... })` chain that carries
  // `.eq("payment_status", "chargeback")` before its `.select(`.
  for (const m of src.matchAll(/\.update\(\{\s*payment_status:\s*([^,\n}]+)/g)) {
    const chainEnd = src.indexOf(".select(", m.index!);
    const chain = src.slice(m.index!, chainEnd === -1 ? m.index! + 400 : chainEnd);
    if (!/\.eq\("payment_status", "chargeback"\)/.test(chain)) continue;
    const value = m[1].trim();
    const literal = /^"([a-z_]+)"$/.exec(value);
    if (literal) out.add(literal[1]);
    // A variable: both restore helpers answer "escrow" | "payout_pending".
    else for (const v of ["escrow", "payout_pending"]) out.add(v);
  }
  return out;
}

/** The IF condition guarding the trigger block that announces `status`. */
function blocksAnnouncing(def: string, status: string): string[] {
  return [...def.matchAll(/IF\s+([\s\S]*?)\s+THEN/g)]
    .map((m) => m[1])
    .filter((cond) => new RegExp(`NEW\\.payment_status = '${status}'`).test(cond));
}

describe("leaving a chargeback block is not announced as a new payment", () => {
  const def = effectiveDefs(MIGRATIONS).get("notify_on_payment_escrowed")?.stmt ?? "";

  it("finds the webhook's ways out of 'chargeback' (inventory floor)", () => {
    const targets = targetsOutOfChargeback();
    // The repaid clawback (released) and the restores (escrow / payout_pending).
    expect(targets.size).toBeGreaterThanOrEqual(3);
    expect([...targets].sort()).toEqual(["escrow", "payout_pending", "released"]);
  });

  it("every target the trigger announces is gated on OLD.payment_status IS DISTINCT FROM 'chargeback'", () => {
    expect(def, "notify_on_payment_escrowed is not defined by any migration").not.toBe("");
    let announced = 0;
    for (const status of targetsOutOfChargeback()) {
      for (const cond of blocksAnnouncing(def, status)) {
        announced++;
        expect(cond, `the '${status}' notice fires on a job leaving a chargeback block`).toMatch(
          /OLD\.payment_status IS DISTINCT FROM 'chargeback'/,
        );
      }
    }
    // escrow (poster + Helpr), released (Helpr), released (crew members).
    expect(announced).toBe(3);
  });

  it("is red on the definition before the fix (the check can fail)", () => {
    const before = effectiveDefs(MIGRATIONS, { before: FIX }).get("notify_on_payment_escrowed")?.stmt ?? "";
    const gated = blocksAnnouncing(before, "released").concat(blocksAnnouncing(before, "escrow"))
      .filter((c) => /OLD\.payment_status IS DISTINCT FROM 'chargeback'/.test(c));
    expect(gated).toHaveLength(0);
  });

  it("the restatement keeps the trigger function service-role only", () => {
    const file = readFileSync(resolve(MIGRATIONS, FIX), "utf8");
    expect(file).toMatch(/REVOKE ALL ON FUNCTION public\.notify_on_payment_escrowed\(\) FROM PUBLIC, anon, authenticated;/);
    expect(file).toMatch(/GRANT EXECUTE ON FUNCTION public\.notify_on_payment_escrowed\(\) TO service_role;/);
  });
});
