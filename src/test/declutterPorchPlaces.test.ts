/**
 * Porch places (D-NEW14, migration 20261030164712; owner-approved design 2026-10-29): a seller saves up to 5 porch
 * pickup places, each with its own weekdays; the buyer picks one; it is FROZEN on the order at checkout; only the
 * chosen address is shared after paying; Helpr delivery picks up there.
 *
 * The class this guards: a reader of "where is this order's pickup" that reads the item's own address
 * (declutter_item_private) instead of the order's frozen place. Every newest definition that measures a handover
 * photo against the pickup, offers or accepts a porch day, reveals the address to the buyer, prices a Helpr delivery
 * or opens its task must read the order / the buyer's pick; checkout must freeze the pick before any payment page.
 * Behaviour per account: src/test/pglite/declutterPorchPlaces.pglite.mjs (51 checks; NEW_MIGRATION=skip is red).
 *
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |     FROM public.declutter_order_pickup_points(o.id) pt;\n  IF v_m IS NULL OR v_m > 200 THEN\n    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.'; |     FROM (SELECT p.pickup_lat AS lat, p.pickup_lng AS lng FROM public.declutter_cart_items c JOIN public.declutter_item_private p ON p.item_id = c.item_id WHERE c.order_id = o.id) pt;\n  IF v_m IS NULL OR v_m > 200 THEN\n    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |   IF NOT public.declutter_order_is_porch_day(o.id, extract(dow FROM p_day)::smallint) THEN |   IF NOT public.declutter_is_porch_day(o.seller_id, extract(dow FROM p_day)::smallint) THEN
 * @mutate supabase/migrations/20261101201500_shipping_s3_checkout_claim.sql |   IF v_place.id IS NOT NULL THEN\n    INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)\n    VALUES (v_order, p_seller_id, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);\n  END IF;\n\n  IF p_handover = 'meetup' THEN | \n  IF p_handover = 'meetup' THEN
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |     v_area := v_pp.area; |     v_area := v_area;
 * @mutate supabase/migrations/20261101054401_declutter_places_city_only_for_buyers.sql |   v_open := v_side = 'seller' OR o.status IN ('paid', 'handed_over'); |   v_open := true;
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql | REVOKE ALL ON FUNCTION public.declutter_order_pickup_points(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_order_pickup_points(uuid) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |     FROM public.declutter_order_pickup_points(o.id) pt;\n  IF v_m IS NULL OR v_m > 200 THEN\n    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the seller''s pickup address.'; |     FROM (SELECT p.pickup_lat AS lat, p.pickup_lng AS lng FROM public.declutter_cart_items c JOIN public.declutter_item_private p ON p.item_id = c.item_id WHERE c.order_id = o.id) pt;\n  IF v_m IS NULL OR v_m > 200 THEN\n    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the seller''s pickup address.';
 * @mutate supabase/migrations/20261101140006_export_my_data_instant_book.sql | ELSE to_jsonb(t) - 'address' - 'lat' - 'lng' - 'seller_id' - 'label' END) | ELSE to_jsonb(t) END)
 * @mutate supabase/migrations/20261101140006_export_my_data_instant_book.sql |   v_out := v_out \|\| jsonb_build_object('declutter_order_porch_places', | v_out := v_out; PERFORM ('declutter_order_porch_places',
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_FILE = "20261030164712_declutter_porch_places.sql";
const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(process.cwd(), "supabase/migrations", MIG_FILE), "utf8")).replace(/\s+/g, " ");

const READERS = ["declutter_return_dropped_off", "declutter_porch_photo", "declutter_porch_days", "declutter_book_porch_day", "declutter_item_address",
  "declutter_delivery_compute", "declutter_delivery_open_task", "declutter_start_checkout", "declutter_checkout_free"];

describe("porch places: every pickup reader reads the order's place", () => {
  it("reads the newest definitions (floors)", () => {
    for (const fn of [...READERS, "declutter_order_pickup_points", "declutter_order_is_porch_day", "declutter_save_porch_place",
      "declutter_seller_porch_places", "declutter_set_porch_place", "declutter_order_place"]) {
      expect(body(fn).length, fn).toBeGreaterThan(200);
    }
    expect(READERS.length).toBeGreaterThan(7);
  });

  it("the porch photo measures from the order's pickup points, never item_private directly", () => {
    const p = body("declutter_porch_photo");
    expect(p).toMatch(/FROM public\.declutter_order_pickup_points\(o\.id\) pt/);
    expect(p).not.toMatch(/declutter_item_private/);
    expect(body("declutter_order_pickup_points")).toMatch(/FROM public\.declutter_order_porch_places pp WHERE pp\.order_id = p_order_id/);
  });

  it("Q2486: the return drop-off measures from the order's pickup points, never item_private directly", () => {
    const d = body("declutter_return_dropped_off");
    expect(d).toMatch(/FROM public\.declutter_order_pickup_points\(o\.id\) pt/);
    expect(d).not.toMatch(/declutter_item_private/);
  });

  it("Download My Data: the buyer's copy of a frozen place has no address, point, seller id or label", () => {
    const e = body("export_my_data");
    expect(e).toMatch(/jsonb_build_object\('declutter_porch_places', .*? WHERE t\.seller_id = v_uid/);
    expect(e).toMatch(/jsonb_build_object\('declutter_porch_place_choices', .*? WHERE t\.buyer_id = v_uid/);
    expect(e).toMatch(/jsonb_build_object\('declutter_order_porch_places', .*?ELSE to_jsonb\(t\) - 'address' - 'lat' - 'lng' - 'seller_id' - 'label' END\)/);
  });

  it("porch days offered and accepted read the order's frozen weekdays", () => {
    expect(body("declutter_porch_days")).toMatch(/public\.declutter_order_is_porch_day\(o\.id, extract\(dow FROM d::date\)::smallint\)/);
    expect(body("declutter_book_porch_day")).toMatch(/IF NOT public\.declutter_order_is_porch_day\(o\.id, extract\(dow FROM p_day\)::smallint\) THEN RAISE EXCEPTION 'invalid_day'/);
    expect(body("declutter_order_is_porch_day")).toMatch(/p_dow = ANY \(pp\.weekdays\)/);
  });

  it("checkout (paid and free) requires the pick for a seller with places and freezes it", () => {
    for (const fn of ["declutter_start_checkout", "declutter_checkout_free"]) {
      const b = body(fn);
      expect(b, fn).toMatch(/RAISE EXCEPTION 'porch_place_needed'/);
      expect(b, fn).toMatch(/INSERT INTO public\.declutter_order_porch_places \(order_id, seller_id, place_id, label, address, area, lat, lng, weekdays\)/);
      expect(b, fn).toMatch(/FOR SHARE OF pl/);
    }
    // LEAD-PLACE-TIMES (owner 2026-10-31, 20261031164337): a door pickup is at the chosen place too.
    expect(body("declutter_start_checkout")).toMatch(/IF p_handover IN \('porch', 'pickup_home', 'delivery'\)/);
    expect(body("declutter_checkout_free")).toMatch(/IF p_handover IN \('porch', 'pickup_home'\)\s+AND EXISTS \(SELECT 1 FROM public\.declutter_porch_places/);
    expect(body("declutter_start_checkout")).toMatch(/AND v_existing\.porch_key IS NOT DISTINCT FROM/);
  });

  it("the buyer gets the chosen address only after paying; Helpr delivery picks up at the place", () => {
    expect(body("declutter_item_address")).toMatch(/IF v_access = 'paid_buyer' THEN SELECT pp\.\* INTO v_pp/);
    expect(body("declutter_order_place")).toMatch(/v_open := v_side = 'seller' OR o\.status IN \('paid', 'handed_over'\)/);
    expect(body("declutter_seller_porch_places")).not.toMatch(/pl\.address|pl\.lat|pl\.lng/);
    expect(body("declutter_delivery_compute")).toMatch(/v_addr := v_place\.address; v_lat := v_place\.lat; v_lng := v_place\.lng;/);
    expect(body("declutter_delivery_open_task")).toMatch(/v_addr := v_pp\.address; v_lat := v_pp\.lat; v_lng := v_pp\.lng; v_area := v_pp\.area;/);
  });

  it("tables have no client privilege; helpers are internal; the RPCs refuse anon; the Q807 gate runs", () => {
    for (const t of ["declutter_porch_places", "declutter_porch_place_choices", "declutter_order_porch_places"]) {
      expect(MIG, t).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(MIG, t).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    }
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_order_pickup_points(uuid) FROM PUBLIC, anon, authenticated;");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_order_is_porch_day(uuid, smallint) FROM PUBLIC, anon, authenticated;");
    for (const sig of ["declutter_save_porch_place(uuid, text, text, text, numeric, numeric, smallint[])", "declutter_delete_porch_place(uuid)",
      "declutter_my_porch_places()", "declutter_seller_porch_places(uuid)", "declutter_set_porch_place(uuid, uuid)", "declutter_order_place(uuid)"]) {
      expect(MIG, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`);
    }
    expect(MIG).toMatch(/PERFORM public\.attach_unconfirmed_email_gate\(\);/);
  });
});
