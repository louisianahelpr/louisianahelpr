/**
 * Declutter moving-out mode (20261016053625_declutter_moving_out;
 * docs/specs/declutter-moving-out.md). The fast half of the proof, read from
 * the NEWEST definitions the migrations leave (effectiveDefs), so a later
 * restatement that drops a gate fails here: a bulk path must never skip a
 * rule the one-item path enforces.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/declutterMovingOut.pglite.mjs
 * (74 PASS; NEW_MIGRATION=skip 69 FAIL; 8 of 9 planted defects caught there,
 * the 9th pinned here; measured 2026-10-16).
 *
 * @mutate supabase/migrations/20261016053625_declutter_moving_out.sql |     v_id := public.declutter_create_item( |     v_id := public.declutter_create_item_fast(
 * @mutate supabase/migrations/20261016053625_declutter_moving_out.sql |   v_uid := public.declutter_assert_member(true);\n\n  IF public.declutter_move_out_date_problem | v_uid := (SELECT auth.uid());\n\n  IF public.declutter_move_out_date_problem
 * @mutate supabase/migrations/20261016053625_declutter_moving_out.sql | REVOKE ALL ON FUNCTION public.declutter_create_move_drafts(date, text, text, numeric, numeric, jsonb) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_create_move_drafts(date, text, text, numeric, numeric, jsonb) FROM PUBLIC;
 * @mutate supabase/migrations/20261016053625_declutter_moving_out.sql |    WHERE seller_id = v_uid\n     AND in_moving_sale\n     AND status IN | WHERE in_moving_sale\n     AND status IN
 * @mutate supabase/migrations/20261016053625_declutter_moving_out.sql |        AND i.seller_id = v_uid AND p.seller_id = v_uid\n       AND i.in_moving_sale\n       AND i.status IN ('draft' |        AND i.in_moving_sale\n       AND i.status IN ('draft'
 * @mutate supabase/migrations/20261016053625_declutter_moving_out.sql |   IF v_date IS NULL OR v_date < v_today THEN |   IF v_date IS NULL THEN
 * @mutate supabase/migrations/20261016053625_declutter_moving_out.sql | VALUES ('declutter_moving_out', 'testers', | VALUES ('declutter_moving_out', 'everyone',
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   const refused = await requireFeature(admin, "declutter_moving_out", user, corsHeaders); |   const refused = null;
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   const { error: gateErr } = await anon.rpc("declutter_assert_can_scan_room"); |   const gateErr = null as { message?: string } \| null;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261016053625_declutter_moving_out.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const EDGE = blankComments(readFileSync(join(process.cwd(), "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));

const WRITE_RPCS = ["declutter_create_move_drafts", "declutter_set_move_out_date", "declutter_assert_can_scan_room"];
const CLIENT_RPCS = [...WRITE_RPCS, "declutter_my_move_out_date", "declutter_seller_moving_sale"];

describe("Declutter moving-out mode (20261016053625)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of [...CLIENT_RPCS, "declutter_move_out_date_problem"]) expect(body(fn), fn).not.toBe("");
    expect(MIG.length).toBeGreaterThan(4_000);
    expect(EDGE.length).toBeGreaterThan(5_000);
  });

  it("every client RPC requires BOTH switches first and names is_caller_banned()", () => {
    for (const fn of CLIENT_RPCS) {
      expect(body(fn), fn).toMatch(/\bBEGIN\s+PERFORM\s+public\.require_feature\('declutter'\);\s+PERFORM\s+public\.require_feature\('declutter_moving_out'\);/);
    }
    for (const fn of WRITE_RPCS) expect(body(fn), fn).toMatch(/public\.is_caller_banned\(\)/);
  });

  it("the bulk create keeps every listing rule: member gates, then each draft through declutter_create_item", () => {
    const b = flat(body("declutter_create_move_drafts"));
    expect(b).toContain("v_uid := public.declutter_assert_member(true);");
    expect(b).toContain("v_id := public.declutter_create_item(");
    // It never inserts a listing row itself (that would skip create_item's checks).
    expect(b).not.toMatch(/INSERT\s+INTO\s+public\.declutter_items/i);
    expect(b).toContain("IF v_n < 1 OR v_n > 15 THEN");
    expect(b).toContain("IF v_open + v_n > 60 THEN");
    expect(b).toContain("WHERE id = v_id AND seller_id = v_uid AND status = 'draft'");
    expect(flat(body("declutter_assert_can_scan_room"))).toContain("PERFORM public.declutter_assert_member(true);");
  });

  it("there is no bulk publish: declutter_publish_item stays the only publish function", () => {
    const publishFns = [...DEFS.keys()].filter((k) => /^declutter_.*publish/.test(k));
    expect(publishFns).toEqual(["declutter_publish_item"]);
  });

  it("the date RPC changes only the caller's own items still in play", () => {
    const b = flat(body("declutter_set_move_out_date"));
    expect(b).toContain("AND i.seller_id = v_uid AND p.seller_id = v_uid AND i.in_moving_sale AND i.status IN ('draft', 'pending_review', 'live', 'reserved')");
    expect(b).toContain("WHERE seller_id = v_uid AND in_moving_sale AND status IN ('draft', 'pending_review', 'live', 'reserved')");
    // Setting a date takes the selling gates (review nit 3).
    expect(b).toMatch(/IF p_move_out_on IS NOT NULL THEN PERFORM public\.declutter_assert_member\(true\);/);
  });

  it("the date lives on the private half; other members get only 'soon' or the month, and nothing after the date", () => {
    expect(flat(MIG)).toContain("ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS move_out_on date;");
    expect(MIG).not.toMatch(/ALTER TABLE public\.declutter_items ADD COLUMN IF NOT EXISTS move_out_on/);
    const r = flat(body("declutter_seller_moving_sale"));
    expect(r).toContain("RETURNS TABLE(moving_soon boolean, move_month date)");
    expect(r).toContain("IF v_date IS NULL OR v_date < v_today THEN RETURN;");
    expect(r).toContain("public.declutter_seller_hidden(p_seller_id)");
    expect(r).toContain("public.are_users_blocked(v_uid, p_seller_id)");
    expect(r).toContain("move_month := date_trunc('month', v_date)::date;");
  });

  it("anon is revoked from each client RPC, and the date helper is internal", () => {
    for (const sig of [
      "declutter_create_move_drafts(date, text, text, numeric, numeric, jsonb)",
      "declutter_set_move_out_date(date)",
      "declutter_assert_can_scan_room()",
      "declutter_my_move_out_date()",
      "declutter_seller_moving_sale(uuid)",
    ]) expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`);
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_move_out_date_problem(date) FROM PUBLIC, anon, authenticated;");
  });

  it("the switch is created at testers, never everyone", () => {
    expect(flat(MIG)).toContain("VALUES ('declutter_moving_out', 'testers',");
  });

  it("the room scan checks its own switch and the member gates before spending on the model", () => {
    const room = EDGE.slice(EDGE.indexOf("async function roomScan("));
    expect(room.length).toBeGreaterThan(500);
    const sw = room.indexOf('requireFeature(admin, "declutter_moving_out", user, corsHeaders)');
    const gate = room.indexOf('anon.rpc("declutter_assert_can_scan_room")');
    const model = room.indexOf("askModel(");
    expect(sw).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(sw);
    expect(model).toBeGreaterThan(gate);
    expect(room).toContain('keyPrefix: "declutter-ai-room"');
    // The room photos are never written to storage.
    expect(room).not.toMatch(/storage\s*\.\s*from\([^)]*\)\s*\.\s*upload/);
  });
});
