/**
 * Q2259 spec 5.3 review fix 16: a carrier claim payout on a lost or broken parcel pays THAT order's shipping debt
 * first, then the rest is the seller's. The newest declutter_admin_record_ship_claim is admin only behind
 * declutter_shipping, takes the payout path's advisory lock, pays only debts of that order's refunds and shipments,
 * records the rest as seller_due_cents, and caps the claims at the order total.
 * Behaviour proven in PGlite: src/test/pglite/shippingClaimPayout.pglite.mjs (73/73; NEW_MIGRATION=skip 25 FAIL;
 * 8 planted defects RED, oldest-first among them).
 *
 * @mutate supabase/migrations/20261103213005_shipping_claim_on_damaged_after_handover.sql | AND (x.refund_id IN (SELECT r.id FROM public.declutter_refunds r WHERE r.order_id = o.id) | AND (x.refund_id IS NOT NULL
 * @mutate supabase/migrations/20261103213005_shipping_claim_on_damaged_after_handover.sql | IF v_claimed + p_amount_cents > o.total_cents THEN | IF v_claimed + p_amount_cents > o.total_cents * 2 THEN
 * @mutate supabase/migrations/20261103213005_shipping_claim_on_damaged_after_handover.sql | PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' \|\| o.seller_id::text, 0)); | NULL;
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");

function newest(name: string): { file: string; body: string } {
  for (const f of [...files].reverse()) {
    const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
    const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, "g");
    let m: RegExpExecArray | null;
    let at = -1;
    while ((m = re.exec(sql))) at = m.index;
    if (at < 0) continue;
    const tag = /\bAS (\$\w*\$)/.exec(sql.slice(at));
    if (!tag) continue;
    const start = at + tag.index + tag[0].length;
    return { file: f, body: flat(sql.slice(at, sql.indexOf(tag[1], start))) };
  }
  throw new Error(`no ${name}`);
}

describe("a carrier claim payout pays that order's debt first", () => {
  const fn = newest("declutter_admin_record_ship_claim");
  it("is admin only, behind the switch, on a refunded ship order, capped at the order total", () => {
    expect(fn.file >= "20261103213005").toBe(true);
    for (const s of [
      "PERFORM public.require_feature('declutter_shipping');",
      "IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'admin_only'",
      "o := public.declutter_lock_order(p_order_id);",
      // 20261103213005: or handed_over with a not_as_described refund (a damaged parcel refunded after the handover).
      "IF o.status <> 'refunded' AND NOT (o.status = 'handed_over' AND EXISTS ( SELECT 1 FROM public.declutter_refunds r WHERE r.order_id = o.id AND r.reason = 'not_as_described')) THEN",
      "IF v_claimed + p_amount_cents > o.total_cents THEN",
    ]) expect(fn.body, s).toContain(s);
  });
  it("pays only that order's debts, under the payout path's lock, and records the rest for the seller", () => {
    for (const s of [
      "PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' || o.seller_id::text, 0));",
      "AND (x.refund_id IN (SELECT r.id FROM public.declutter_refunds r WHERE r.order_id = o.id)",
      "AND x.source_ref IN (SELECT s.id FROM public.shipments s WHERE s.declutter_order_id = o.id))",
      // 20261103213005: and that order's return label debt.
      "OR (x.source_kind = 'ship_label' AND x.source_ref IN (SELECT rl.id FROM public.shipping_return_labels rl WHERE rl.order_id = o.id)))",
      "VALUES (d.id, 'ship_claim:' || v_ref, v_take);",
      "UPDATE public.declutter_seller_fee_debts SET remaining_cents = remaining_cents - v_take WHERE id = d.id;",
      "CASE WHEN v_left = 0 THEN 'settled' ELSE 'seller_due' END",
    ]) expect(fn.body, s).toContain(s);
    expect(fn.body.split("FOR UPDATE").length - 1).toBeGreaterThan(0);
  });
});
