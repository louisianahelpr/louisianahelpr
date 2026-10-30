/**
 * A seller's pickup windows are readable by the people who need them, and only the windows (lead 2026-10-28,
 * for Broken #2 / #58; migration 20261028195840). declutter_pickup_windows is readable only by its seller (RLS),
 * so a buyer choosing a pickup, or the Helpr on a delivery, could not see when the seller is around.
 *
 * Reads the EFFECTIVE definitions (helpers/effectiveFunctionDefs). Backend proof on a real database:
 * src/test/pglite/declutterPickupWindowReads.pglite.mjs (3x; 25 FAIL without the migration; RED on 9 planted
 * defects: a paused item, a hidden seller, an unpaid buyer, any Helpr, an open task, a stranger, no switch gate,
 * a wrong deadline, anon granted).
 */
// @mutate supabase/migrations/20261028195840_declutter_pickup_window_reads.sql | (o.buyer_id = v_uid AND o.status = 'paid') | (o.buyer_id = v_uid)
// @mutate supabase/migrations/20261028195840_declutter_pickup_window_reads.sql | AND t.source_id = o.id AND t.helpr_id = v_uid | AND t.source_id = o.id
// @mutate supabase/migrations/20261030080020_declutter_buyer_reads_own_item.sql | i.status IN ('live', 'reserved') AND NOT i.seller_hidden | i.status IN ('live', 'reserved', 'paused')
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const ITEM = flat("declutter_item_pickup_windows");
const ORDER = flat("declutter_order_pickup_windows");

describe("Declutter pickup windows: the right people, only the windows", () => {
  it("reads both definitions (floors)", () => {
    expect(ITEM.length).toBeGreaterThan(400);
    expect(ORDER.length).toBeGreaterThan(600);
  });

  it("both return only weekday and times (the order's adds the pickup deadline)", () => {
    expect(ITEM).toContain("RETURNS TABLE(weekday smallint, starts time, ends time)");
    expect(ORDER).toContain("RETURNS TABLE(weekday smallint, starts time, ends time, latest_pickup_at timestamptz)");
    expect(ITEM).toContain("SELECT w.weekday, w.starts_local, w.ends_local FROM public.declutter_pickup_windows w");
    expect(ORDER).toContain("SELECT w.weekday, w.starts_local, w.ends_local, o.paid_at + interval '7 days' FROM public.declutter_pickup_windows w");
  });

  it("behind the switch; an item only while it is for sale or reserved and its seller is not hidden", () => {
    for (const b of [ITEM, ORDER]) expect(b).toMatch(/BEGIN PERFORM public\.require_feature\('declutter'\);/);
    expect(ITEM).toContain("i.status IN ('live', 'reserved') AND NOT i.seller_hidden");
  });

  it("an order only for its paid buyer, its seller, or the Helpr assigned to it", () => {
    expect(ORDER).toContain("(o.buyer_id = v_uid AND o.status = 'paid') OR o.seller_id = v_uid");
    expect(ORDER).toContain("t.source_kind = 'declutter_delivery' AND t.source_id = o.id AND t.helpr_id = v_uid AND t.status IN ('accepted', 'picked_up', 'delivered', 'confirmed')");
    expect(ORDER).toContain("RAISE EXCEPTION 'item_not_found'");
  });
});
