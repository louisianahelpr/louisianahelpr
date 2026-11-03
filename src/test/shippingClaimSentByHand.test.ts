/**
 * Owner 11-03: the rest of a carrier claim (after the seller's debts on that order) is sent to the seller BY AN ADMIN BY
 * HAND, never automatically. The newest declutter_admin_mark_ship_claim_sent is admin only behind declutter_shipping and
 * moves a 'seller_due' claim to 'seller_paid' once; the table ties 'seller_paid' to a send time; nothing transfers money.
 * Behaviour proven in PGlite: src/test/pglite/shippingClaimSentByHand.pglite.mjs (64/64; NEW_MIGRATION=skip 16 FAIL;
 * 5 planted defects RED).
 *
 * @mutate supabase/migrations/20261103214253_shipping_claim_sent_by_hand.sql |   IF c.status <> 'seller_due' THEN |   IF false THEN
 * @mutate supabase/migrations/20261103214253_shipping_claim_sent_by_hand.sql |   ((status = 'seller_paid') = (sent_at IS NOT NULL)) |   true
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");

function newestWith(marker: string): { file: string; sql: string } {
  for (const f of [...files].reverse()) {
    const sql = flat(blankSqlComments(readFileSync(join(DIR, f), "utf8")));
    if (sql.includes(marker)) return { file: f, sql };
  }
  throw new Error(`no migration has ${marker}`);
}

describe("a carrier claim's rest is sent by an admin by hand, never automatically", () => {
  it("only an admin, behind the switch, marks a seller_due claim sent, once", () => {
    const { file, sql } = newestWith("CREATE OR REPLACE FUNCTION public.declutter_admin_mark_ship_claim_sent(");
    expect(file >= "20261103214253").toBe(true);
    const must = [
      "PERFORM public.require_feature('declutter_shipping');",
      "IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'admin_only'",
      "IF c.status <> 'seller_due' THEN RAISE EXCEPTION 'nothing_due'",
      "UPDATE public.shipping_claim_payouts SET status = 'seller_paid', sent_at = now(), sent_ref = v_ref WHERE id = c.id;",
      "INSERT INTO public.admin_audit_log",
    ];
    for (const m of must) expect(sql, m).toContain(m);
    expect(must.length).toBeGreaterThan(4);
    // By hand: this function moves no money.
    expect(sql).not.toMatch(/declutter_payouts|transfers|stripe/i);
  });
  it("the table ties seller_paid to a send time", () => {
    const { sql } = newestWith("ADD CONSTRAINT shipping_claim_sent_by_hand CHECK");
    expect(sql).toContain("((status = 'seller_paid') = (sent_at IS NOT NULL))");
  });
});
