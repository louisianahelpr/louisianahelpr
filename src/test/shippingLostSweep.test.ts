/**
 * Q2259 shipping lost sweep (spec 5.3 "ship_lost"; decision 5: lost in the mail = the seller): the newest
 * declutter_ship_sweep closes a paid, captured ship order whose label was accepted 10+ days ago with no delivered scan
 * (never one waiting for pickup, never with an open problem) as declutter_close_paid_order(o, 'ship_lost', NULL strike);
 * ship_lost is a seller-fault close (item withdrawn) whose card fee is the seller's debt, and the spent label becomes a
 * ship_label debt. Behaviour proven in PGlite: src/test/pglite/shippingLostSweep.pglite.mjs (57/57; 8 planted defects RED).
 *
 * @mutate supabase/migrations/20261103203204_shipping_lost_sweep.sql | PERFORM public.declutter_close_paid_order(o.id, 'ship_lost', NULL, NULL, | PERFORM public.declutter_close_paid_order(o.id, 'ship_lost', 'seller', 'item_gone_after_sale',
 * @mutate supabase/migrations/20261105052751_declutter_gift_delivery_refunds.sql | v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out', 'ship_lost'); | v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out');
 * @mutate supabase/migrations/20261103203204_shipping_lost_sweep.sql |        AND s.tracking_status IS DISTINCT FROM 'available_for_pickup'\n       AND NOT EXISTS |        AND NOT EXISTS
 * @mutate supabase/migrations/20261103203204_shipping_lost_sweep.sql | AND s.accepted_at IS NOT NULL AND s.accepted_at + interval '10 days' <= now()\n       AND s.delivered_at IS NULL | AND s.accepted_at IS NOT NULL AND s.accepted_at + interval '1 day' <= now()\n       AND s.delivered_at IS NULL
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
it("reads the real migration list (inventory floor)", () => expect(files.length).toBeGreaterThan(1500));
const flat = (s: string) => s.replace(/\s+/g, " ");

/** The newest CREATE of a function, any dollar tag, comments blanked. */
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
    const end = sql.indexOf(tag[1], start);
    return { file: f, body: flat(sql.slice(at, end)) };
  }
  throw new Error(`no ${name}`);
}

describe("a parcel the carrier never delivered in 10 days is refunded on the seller", () => {
  const sweep = newest("declutter_ship_sweep");
  const lostAt = sweep.body.indexOf("s.accepted_at IS NOT NULL AND s.accepted_at + interval '10 days' <= now()");

  it("the newest sweep has the lost loop with every condition, twice (query and re-check under the lock)", () => {
    expect(sweep.file >= "20261103203204").toBe(true);
    expect(lostAt).toBeGreaterThan(0);
    const loop = sweep.body.slice(lostAt - 300);
    for (const cond of [
      "o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'",
      "s.delivered_at IS NULL AND s.tracking_status IS DISTINCT FROM 'delivered'",
      "s.tracking_status IS DISTINCT FROM 'available_for_pickup' AND NOT EXISTS",
      "o := public.declutter_lock_order(r.id);",
      "PERFORM public.declutter_close_paid_order(o.id, 'ship_lost', NULL, NULL,",
      "'lost_closed', v_lost",
    ]) expect(loop, cond).toContain(cond);
    expect(sweep.body.split("interval '10 days'").length - 1).toBe(2);
    expect(sweep.body.split("IS DISTINCT FROM 'available_for_pickup'").length - 1).toBe(2);
  });

  it("ship_lost is a seller-fault close whose card fee and spent label are the seller's", () => {
    const close = newest("declutter_close_paid_order").body;
    expect(close).toContain("v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out', 'ship_lost');");
    const rr = newest("declutter_record_refund").body;
    expect(rr).toContain("'helpr_fault', 'ship_lost') THEN 'full_seller_pays_fee'");
    const label = newest("declutter_ship_no_fault_label").body;
    expect(label).toContain("NEW.reason NOT IN ('admin_no_fault', 'ship_lost',");
  });
});
