/**
 * A seller delivery's "I got it" waits for the delivery (deep audit 2026-10-28, Broken #7, server half; client
 * gate 532251e2a7; migration 20261028202844). The buyer could confirm a delivery booked for tomorrow, which
 * marked the order handed over and started the seller's payout clock before anything arrived.
 * declutter_confirm_handover now refuses (not_delivered_yet) unless the seller marked it delivered, or a time is
 * booked and today on the LOUISIANA calendar is the slot's day or later.
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterSdConfirmDeliveryDay.pglite.mjs (3x;
 * 4 FAIL without it; RED on a UTC calendar, the delivered exception dropped, any status, the slot time instead
 * of its day).
 */
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql | AND (now() AT TIME ZONE 'America/Chicago')::date >= (d.slot_start AT TIME ZONE 'America/Chicago')::date | AND (now() AT TIME ZONE 'UTC')::date >= (d.slot_start AT TIME ZONE 'UTC')::date
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF o.handover = 'seller_delivery' AND NOT EXISTS ( |   IF false AND NOT EXISTS (
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = blankSqlComments(DEFS.get("declutter_confirm_handover")?.stmt ?? "").replace(/\s+/g, " ");

describe("a seller delivery's \"I got it\" waits for its day (Louisiana) or the seller's \"Delivered\"", () => {
  it("reads the definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(800);
  });

  it("refuses before then, on the Louisiana calendar, and still pays only through complete_handover", () => {
    expect(flat).toContain("IF o.handover = 'seller_delivery' AND NOT EXISTS ( SELECT 1 FROM public.declutter_seller_deliveries d WHERE d.order_id = o.id AND (d.delivered_at IS NOT NULL OR (d.status = 'booked' AND d.slot_start IS NOT NULL AND (now() AT TIME ZONE 'America/Chicago')::date >= (d.slot_start AT TIME ZONE 'America/Chicago')::date))) THEN RAISE EXCEPTION 'not_delivered_yet'");
    // The check sits after the side check and before the one call that pays.
    expect(flat.indexOf("'wrong_side'")).toBeLessThan(flat.indexOf("'not_delivered_yet'"));
    expect(flat.indexOf("'not_delivered_yet'")).toBeLessThan(flat.indexOf("RETURN public.declutter_complete_handover(o.id, p_method);"));
  });
});
