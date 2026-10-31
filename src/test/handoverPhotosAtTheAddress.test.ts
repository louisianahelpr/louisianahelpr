/**
 * Anti-lying #1 (owner 2026-10-28, ~/.lh-wt/declutter-next-queue-1028.md item 1): EVERY Declutter handover photo is
 * taken at the right address. The class, built from the migrations' own inventory (the EFFECTIVE definition of
 * every function that takes a p_photo_path and checks it as a handover photo: an object in the private
 * 'declutter-handover' bucket, or helpr_task_photo_ok for a Helpr's task photo), minus a short reasoned list,
 * must each take the device's position (p_lat, p_lng), refuse without it (location_required) and refuse more than
 * 200 m from ITS place (PLACE below: the pickup point, the drop-off point, the meeting spot). A new handover photo
 * RPC without a place check, or one checked against the wrong place, fails here.
 * Backend proof: src/test/pglite/declutterHandoverPhotosAtAddress.pglite.mjs (3x; RED without it and on 11 plants).
 */
// @mutate supabase/migrations/20261029002010_declutter_handover_photos_live_only.sql |     v_m := public.helpr_task_distance_m(p_lat, p_lng, d.dropoff_lat, d.dropoff_lng); |     v_m := 0;
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |       SELECT public.helpr_task_distance_m(p_lat, p_lng, m.spot_lat, m.spot_lng) INTO v_m |       SELECT 0 INTO v_m
// @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |   IF p_photo_path IS NULL\n     OR split_part(p_photo_path, '/', 1) |   IF v_side = 'seller' THEN RETURN jsonb_build_object('result', 'set_out'); END IF;\n  IF p_photo_path IS NULL\n     OR split_part(p_photo_path, '/', 1)
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql | CREATE OR REPLACE FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text,\n  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL) | CREATE OR REPLACE FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text)
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

// Each handover photo RPC -> the column(s) its distance is measured to (every one of them must be read).
const PLACE: Record<string, string[]> = {
  declutter_porch_photo: ["pt.lat"], // both sides: the order's nearest pickup point (declutter_order_pickup_points, D-NEW14)
  declutter_seller_picked_up: ["m.spot_lat", "p.pickup_lat"], // a safe meeting spot, or a door pickup's pickup point
  declutter_seller_delivered: ["d.dropoff_lat"], // the buyer's drop-off point (seller delivery)
  helpr_task_picked_up: ["t.pickup_lat"],
  helpr_task_delivered: ["t.dropoff_lat"],
  helpr_task_pickup_no_show: ["t.pickup_lat"], // "the seller was not there": a photo at the pickup point
  declutter_return_dropped_off: ["pt.lat"], // returns (Q2486): the buyer drops it at the order's pickup point, its frozen place when it has one
};
// Functions that check a handover-bucket photo but are not a handover photo, and why.
const NOT_A_HANDOVER = new Set([
  "declutter_report_problem", // a problem report's evidence (damage, a wrong item) is wherever the buyer is
  "declutter_handover_photo_access", // the storage policy helper (who may read or write the bucket)
  "helpr_task_photo_ok", // the path check every Helpr task photo RPC calls; the RPCs carry the place check
  "declutter_refund_item_returned", // returns (Q2486): the seller's "I got it back"; its photo is OPTIONAL evidence of the item (the refund is the same without it), taken wherever the seller has it; the drop-off photo carries the place check
]);

function inventory(): string[] {
  const out: string[] = [];
  for (const [name, d] of DEFS) {
    const head = d.stmt.slice(0, d.stmt.search(/\bAS\s+\$/i));
    const body = flat(d.stmt);
    if (!/\bp_photo_path\b/.test(head)) continue;
    if (!/'declutter-handover'|helpr_task_photo_ok\(/.test(body)) continue;
    if (!NOT_A_HANDOVER.has(name)) out.push(name);
  }
  return out.sort();
}

describe("every Declutter handover photo is taken at the right address", () => {
  const inv = inventory();

  it("reads the handover photo RPCs from the migrations (floor)", () => {
    expect(inv.length).toBeGreaterThan(5);
  });

  it("the inventory is exactly the photos with a known place (a new one needs its place here)", () => {
    expect(inv).toEqual(Object.keys(PLACE).sort());
  });

  for (const name of Object.keys(PLACE)) {
    it(`${name}: takes the position, refuses without it, and refuses past 200 m from its place`, () => {
      const d = DEFS.get(name);
      expect(d, name).toBeTruthy();
      const head = (d?.stmt ?? "").slice(0, (d?.stmt ?? "").search(/\bAS\s+\$/i));
      const body = flat(d?.stmt ?? "");
      expect(head).toMatch(/\bp_lat numeric\b/);
      expect(head).toMatch(/\bp_lng numeric\b/);
      expect(body).toContain("RAISE EXCEPTION 'location_required'");
      expect(body).toMatch(/IF v_m IS NULL OR v_m > 200 THEN RAISE EXCEPTION 'not_at_(pickup|dropoff|meetup)'/);
      for (const col of PLACE[name]) expect(body, `${name} measures to ${col}`).toMatch(new RegExp(`\\(p_lat - ${col.replace(".", "\\.")}\\)|p_lat, p_lng, ${col.replace(".", "\\.")}`));
    });
  }

  it("the porch photo is placed BEFORE the seller's branch (the seller's 'Left on porch' is checked too)", () => {
    const body = flat(DEFS.get("declutter_porch_photo")?.stmt ?? "");
    const placed = body.indexOf("RAISE EXCEPTION 'not_at_pickup'");
    // The seller's WRITE branch (20261029201542 added an earlier seller-side refusal before the photo checks: no write).
    const seller = body.indexOf("IF v_side = 'seller' THEN UPDATE public.declutter_handovers SET set_out_photo_path");
    expect(placed).toBeGreaterThan(0);
    expect(seller).toBeGreaterThan(placed);
    // And no seller answer of any kind ("set_out") comes before the check (an early seller return skipped it unseen).
    expect(body.indexOf("'set_out'")).toBeGreaterThan(placed);
  });

  it("no two-argument form is left beside the checked one (an unchecked way in)", () => {
    for (const name of ["declutter_seller_picked_up", "declutter_seller_delivered"]) {
      const head = (DEFS.get(name)?.stmt ?? "").slice(0, 400);
      expect(head, name).toMatch(/p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL/);
    }
    // The two-argument forms are dropped by some migration after their last CREATE (20261028235709 today).
    const dir = resolve(__dirname, "../../supabase/migrations");
    const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => blankSqlComments(readFileSync(resolve(dir, f), "utf8"))).join("\n");
    for (const name of ["declutter_seller_picked_up", "declutter_seller_delivered"]) {
      const lastCreate2 = sql.lastIndexOf(`FUNCTION public.${name}(p_order_id uuid, p_photo_path text)`);
      const drop = sql.lastIndexOf(`DROP FUNCTION IF EXISTS public.${name}(uuid, text);`);
      expect(drop, name).toBeGreaterThan(lastCreate2);
    }
  });
});
