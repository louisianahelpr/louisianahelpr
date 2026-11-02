/**
 * Q2259 shipping S6 part 2g: an admin buyer-fault refund of a shipped order AFTER the handover (parcel delivered) leaves
 * the spent label's shipping out, so the amount matches declutter_record_refund's keep_buyer_fee check (it raised
 * refund_amount_unknown, so the admin could not decide for the buyer). Read from the newest
 * declutter_refund_after_handover. Behaviour proven in PGlite: src/test/pglite/shippingBuyerFaultAfterDelivery.pglite.mjs
 * (50/50; skip 5 FAIL incl. refund_amount_unknown; plants RED).
 *
 * @mutate supabase/migrations/20261102063343_declutter_seller_out_after_payment.sql |   v_paid := o.total_cents - v_reserved - v_ship; |   v_paid := o.total_cents - v_reserved;
 * @mutate supabase/migrations/20261102063343_declutter_seller_out_after_payment.sql |   IF p_reason = 'admin_buyer_fault' THEN\n    v_ship | IF p_reason IN ('admin_buyer_fault', 'admin_no_fault') THEN\n    v_ship
 * @mutate supabase/migrations/20261102063343_declutter_seller_out_after_payment.sql | THEN format(' The $%s for shipping is not refunded: the parcel was sent.', | THEN format(' %s',
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const flat = (s: string) => s.replace(/\s+/g, " ");
const newest = (re: RegExp) => {
  for (const f of [...files].reverse()) {
    const sql = flat(blankSqlComments(readFileSync(join(DIR, f), "utf8")));
    if (re.test(sql)) return { file: f, sql };
  }
  throw new Error(`no migration matches ${re}`);
};

describe("an admin buyer-fault refund after a shipped order is delivered keeps the spent label's shipping", () => {
  const { file, sql } = newest(/FUNCTION public\.declutter_refund_after_handover\(/);
  const start = sql.indexOf("FUNCTION public.declutter_refund_after_handover(");
  const tag = /AS (\$[a-z_]*\$)/i.exec(sql.slice(start))?.[1] ?? "$$";
  const open = sql.indexOf(tag, start);
  const fn = sql.slice(open, sql.indexOf(tag, open + tag.length));

  it("only admin_buyer_fault leaves the reserved shipping out of the amount passed", () => {
    expect(file >= "20261102060324").toBe(true);
    expect(fn).toContain("IF p_reason = 'admin_buyer_fault' THEN v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0); END IF; v_paid := o.total_cents - v_reserved - v_ship;");
    expect(fn.match(/v_ship :=/g)?.length).toBe(1);
    expect(files.length).toBeGreaterThan(100);
  });
  it("the buyer is told the shipping stays, and the function stays service-role only", () => {
    expect(fn).toContain("WHEN p_reason = 'admin_buyer_fault' AND v_ship > 0 THEN format(' The $%s for shipping is not refunded: the parcel was sent.'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) FROM PUBLIC, anon, authenticated;");
  });
});
