/**
 * BUY-17 (Declutter buying audit 10-30 #17; owner 11-03 ~2:45 PM, OWNER-DECISIONS.md; lead call for the photo half):
 * a porch sale finishes, and the seller's pay starts, only after the seller's porch photo (declutter_handovers.
 * set_out_at). Before it, the buyer's "I got it" (declutter_confirm_handover) and the buyer's "Picked up" photo
 * (declutter_porch_photo, buyer side) both raise porch_photo_not_in, whatever the day; the client greys "I got it"
 * out with the reason (declutterHandoverViews.test.tsx). Migration 20261103202118.
 * Reads the EFFECTIVE definitions. Backend proof: src/test/pglite/declutterPorchGotItWaitsForPhoto.pglite.mjs (3x;
 * RED on prod's bodies with NEW_MIGRATION=skip; RED with either gate planted out).
 */
// @mutate supabase/migrations/20261104175521_q2390_last_member_not_found_is_404.sql |   IF o.handover = 'porch' AND NOT EXISTS ( |   IF false AND NOT EXISTS (
// @mutate supabase/migrations/20261104175521_q2390_last_member_not_found_is_404.sql |   IF v_side = 'buyer' AND NOT EXISTS ( |   IF false AND NOT EXISTS (
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { DECLUTTER_ERROR_COPY } from "@/lib/declutter/errors";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const GATE = "NOT EXISTS ( SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN RAISE EXCEPTION 'porch_photo_not_in'";

describe("BUY-17: a porch sale waits for the seller's porch photo", () => {
  it("reads both definitions (floor)", () => {
    expect(flat("declutter_confirm_handover").length).toBeGreaterThan(800);
    expect(flat("declutter_porch_photo").length).toBeGreaterThan(800);
  });

  it("\"I got it\" on a porch pickup refuses before set_out_at, after the side check and before the call that pays", () => {
    const c = flat("declutter_confirm_handover");
    expect(c).toContain(`IF o.handover = 'porch' AND ${GATE}`);
    expect(c.indexOf("'wrong_side'")).toBeLessThan(c.indexOf("'porch_photo_not_in'"));
    expect(c.indexOf("'porch_photo_not_in'")).toBeLessThan(c.indexOf("RETURN public.declutter_complete_handover(o.id, p_method);"));
  });

  it("the buyer's porch pickup photo refuses before set_out_at, before anything is written or paid", () => {
    const p = flat("declutter_porch_photo");
    expect(p).toContain(`IF v_side = 'buyer' AND ${GATE}`);
    expect(p.indexOf("'porch_photo_not_in'")).toBeLessThan(p.indexOf("SET picked_up_photo_path = p_photo_path"));
    expect(p.indexOf("'porch_photo_not_in'")).toBeLessThan(p.indexOf("public.declutter_complete_handover(o.id, 'porch')"));
  });

  it("the refusal has plain words that say what to do", () => {
    expect(DECLUTTER_ERROR_COPY.porch_photo_not_in).toMatch(/porch photo/);
    expect(DECLUTTER_ERROR_COPY.porch_photo_not_in).toMatch(/report a problem/);
  });
});
