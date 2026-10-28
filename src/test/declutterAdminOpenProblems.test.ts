/**
 * The admin "Declutter problems" card reads everything it needs to decide in one admin-only call (Declutter
 * audit 2 SH2-4; lead's A2-13; migration 20261028195212). It used to read declutter_problems alone, so an admin
 * saw "Order d07a84de" and a note: no item, amounts, photos or names.
 *
 * Reads the EFFECTIVE definition (helpers/effectiveFunctionDefs). Backend proof on a real database:
 * src/test/pglite/declutterAdminOpenProblems.pglite.mjs (3x; 14 FAIL without the migration; RED on 9 planted
 * defects: no admin check, decided problems shown, test orders shown, not the first photo, full names, a wrong
 * Helpr flag, a switch gate, newest first, anon granted).
 */
// @mutate supabase/migrations/20261028195212_declutter_admin_open_problems.sql |   IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN | IF false THEN
// @mutate supabase/migrations/20261028195212_declutter_admin_open_problems.sql |        AND (COALESCE(p_include_test, false) OR NOT o.is_seed) |        AND true
// @mutate supabase/migrations/20261028195212_declutter_admin_open_problems.sql |      WHERE p.status = 'open' |      WHERE true
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = blankSqlComments(DEFS.get("declutter_admin_open_problems")?.stmt ?? "").replace(/\s+/g, " ");

/** The columns builder 3's card reads (lead 2026-10-28), in order. */
const COLUMNS = ["problem_id", "order_id", "reporter_side", "reason", "note", "problem_photo_paths", "reported_at", "handover",
  "order_status", "items_cents", "bundle_discount_cents", "delivery_cents", "premium_cents", "tax_cents", "total_cents", "paid_at",
  "item_titles", "item_photo_paths", "buyer_id", "buyer_name", "seller_id", "seller_name", "set_out_photo_path", "set_out_at",
  "picked_up_photo_path", "picked_up_at", "picked_up_distance_m", "confirmed_at", "confirmed_by", "helpr_delivery"];

describe("admin Declutter problems: one admin-only read with the whole case", () => {
  it("reads the definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(1500);
    expect(COLUMNS.length).toBeGreaterThan(25);
  });

  it("returns every column the card reads, in order", () => {
    const table = /RETURNS TABLE\((.*?)\) LANGUAGE/.exec(flat)?.[1] ?? "";
    expect(table.split(",").map((c) => c.trim().split(" ")[0])).toEqual(COLUMNS);
  });

  it("admins only, checked first; no switch gate (row 62)", () => {
    expect(flat).toMatch(/AS \$fn\$ BEGIN IF NOT public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\) THEN RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';/);
    expect(flat).not.toContain("require_feature");
  });

  it("open problems only, test orders only on request, names as the app shows them", () => {
    expect(flat).toContain("WHERE p.status = 'open' AND (COALESCE(p_include_test, false) OR NOT o.is_seed) ORDER BY p.created_at, p.id;");
    expect(flat).toContain("public.member_display_name(bp.full_name)");
    expect(flat).toContain("public.member_display_name(sp.full_name)");
    expect(flat).toContain("o.handover = 'delivery' FROM public.declutter_problems p");
  });
});
