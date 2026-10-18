/**
 * Shops M2 (20261018184113_shops_handover_payout; docs/specs/local-shops-prep.md
 * L23, L40; owner pop-up 2026-10-18: the shop picks "left out" (required photo)
 * or "in person", NO codes). The fast half of the proof, read from the NEWEST
 * definitions the migrations leave (effectiveDefs), so a later restatement that
 * drops a gate fails here:
 *
 *   1. The handover RPCs never need the 'shops' switch (L91: an accepted order
 *      finishes) and each names is_caller_banned() in its own body.
 *   2. The transition, the sweep and the payout queue are closed to members.
 *   3. The payout is the item price minus the shared card-fee debt, never the
 *      buyer's fee or the tax, and the debt is taken under the order's own ref.
 *   4. The automatic finish of a left-out order needs the shop's ready photo,
 *      and a reported problem stops the clock and the payout.
 *   5. No code anywhere in the handover (owner: "NO codes anywhere").
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsHandoverPayout.pglite.mjs
 * (79 PASS; NEW_MIGRATION=skip and planted defects red; the pre-review migration 819e55ce3 fails 9, measured 2026-10-18).
 */
// @mutate supabase/migrations/20261018184113_shops_handover_payout.sql |        AND (o.handover_mode = 'in_person' OR h.ready_photo_path IS NOT NULL) |        AND true
// @mutate supabase/migrations/20261018184113_shops_handover_payout.sql | REVOKE ALL ON FUNCTION public.shop_payouts_due(integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shop_payouts_due(integer) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261018184113_shops_handover_payout.sql |   v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' \|\| o.id::text, o.items_cents); |   v_debt := 0;
// @mutate supabase/migrations/20261018184113_shops_handover_payout.sql |   VALUES (o.id, o.items_cents, v_debt, o.items_cents - v_debt, |   VALUES (o.id, o.total_cents, v_debt, o.total_cents - v_debt,
// @mutate supabase/migrations/20261018184113_shops_handover_payout.sql |   IF p_how <> 'admin' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN |   IF false THEN
// @mutate supabase/migrations/20261018184113_shops_handover_payout.sql |   IF p_how = 'shop' AND public.shop_local_today() < o.ready_date THEN |   IF false THEN
// @mutate supabase/migrations/20261018184113_shops_handover_payout.sql |           CASE WHEN p_how = 'shop' THEN now() + interval '24 hours 15 minutes' ELSE now() END) |           now())
// @mutate supabase/migrations/20261018184113_shops_handover_payout.sql | CREATE OR REPLACE FUNCTION public.shops_confirm_pickup(p_order_id uuid)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO 'public', 'pg_temp'\nAS $fn$\nDECLARE\n  v_uid uuid := (SELECT auth.uid());\n  o public.shop_orders;\nBEGIN\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF; | CREATE OR REPLACE FUNCTION public.shops_confirm_pickup(p_order_id uuid)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO 'public', 'pg_temp'\nAS $fn$\nDECLARE\n  v_uid uuid := (SELECT auth.uid());\n  o public.shop_orders;\nBEGIN\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261018184113_shops_handover_payout.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");

const MEMBER = ["shops_mark_ready", "shops_confirm_pickup", "shops_mark_picked_up", "shops_report_not_received"];
const SERVICE = ["shop_complete_handover", "shop_handover_sweep", "shop_payouts_due", "shop_payout_executed"];

/** Functions of this migration whose last REVOKE/GRANT leaves EXECUTE with authenticated (prod's default ACL grants it). */
function grantedToAuthenticated(): Set<string> {
  const out = new Set<string>();
  for (const m of MIG.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(shops?_\w+)\s*\(/gi)) out.add(m[1]);
  for (const m of MIG.matchAll(/(GRANT\s+EXECUTE|REVOKE\s+ALL)\s+ON\s+FUNCTION\s+public\.(shops?_\w+)\s*\([^)]*\)\s+(?:TO|FROM)\s+([^;]+);/gi)) {
    const roles = m[3].toLowerCase();
    if (/^grant/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.add(m[2]);
    if (/^revoke/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.delete(m[2]);
  }
  return out;
}

describe("Shops M2: the handover and the shop's payout keep their gates (20261018184113)", () => {
  const granted = grantedToAuthenticated();

  it("reads a real inventory (floors)", () => {
    for (const fn of [...MEMBER, ...SERVICE, "shops_set_handover_mode"]) expect(DEFS.has(fn), fn).toBe(true);
    expect(granted.size).toBeGreaterThan(3);
  });

  it("1. the handover RPCs never need the switch (L91) and each refuses a banned caller", () => {
    for (const fn of MEMBER) {
      expect(body(fn), fn).not.toMatch(/require_feature\('shops'\)/i);
      expect(body(fn), fn).toMatch(/public\.is_caller_banned\(\)/i);
    }
    expect(body("shops_set_handover_mode")).toMatch(/\bBEGIN\s+PERFORM\s+public\.require_feature\('shops'\);/i);
  });

  it("2. members can call exactly the handover RPCs and the setting; the money steps are closed to them", () => {
    expect([...granted].filter((f) => SERVICE.includes(f))).toEqual([]);
    expect([...granted].sort()).toEqual([...MEMBER, "shops_set_handover_mode", "shop_handover_photo_access"].sort());
  });

  it("3. the payout is the item price minus the shared card-fee debt, under the order's own ref", () => {
    const done = body("shop_complete_handover");
    expect(done).toMatch(/v_debt\s*:=\s*public\.declutter_consume_fee_debt\(o\.seller_id,\s*'shop_order_'\s*\|\|\s*o\.id::text,\s*o\.items_cents\)/i);
    expect(done).toMatch(/VALUES\s*\(o\.id,\s*o\.items_cents,\s*v_debt,\s*o\.items_cents\s*-\s*v_debt,/i);
    expect(done).not.toMatch(/total_cents|premium_cents|tax_cents/i);
    expect(MIG).toMatch(/CONSTRAINT\s+shop_payouts_amount\s+CHECK\s*\(\s*amount_cents\s*=\s*items_cents\s*-\s*debt_cents\s+AND\s+amount_cents\s*>=\s*0\s*\)/i);
    expect(MIG).toMatch(/order_id\s+uuid\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+public\.shop_orders\(id\)/i);
  });

  it("4. a left-out order finishes on its own only with the ready photo; a reported problem stops the clock and the payout", () => {
    const sweep = body("shop_handover_sweep");
    expect(sweep).toMatch(/o\.handover_mode\s*=\s*'in_person'\s+OR\s+h\.ready_photo_path\s+IS\s+NOT\s+NULL/i);
    expect(sweep).toMatch(/h\.problem_at\s+IS\s+NULL/i);
    expect(body("shop_complete_handover")).toMatch(/IF\s+p_how\s*<>\s*'admin'\s+AND\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.shop_handovers\s+h\s+WHERE\s+h\.order_id\s*=\s*o\.id\s+AND\s+h\.problem_at\s+IS\s+NOT\s+NULL\)/i);
    expect(body("shop_payouts_due")).toMatch(/h\.problem_at\s+IS\s+NOT\s+NULL/i);
    expect(body("shops_mark_ready")).toMatch(/so\.bucket_id\s*=\s*'shop-handover'/i);
  });

  it("6. the shop's own \"Picked up\" waits for the ready date, and its payout waits 24 hours for the buyer (reviews of 819e55ce3)", () => {
    const done = body("shop_complete_handover");
    expect(done).toMatch(/IF\s+p_how\s*=\s*'shop'\s+AND\s+public\.shop_local_today\(\)\s*<\s*o\.ready_date\s+THEN\s+RAISE\s+EXCEPTION\s+'before_ready_date'/i);
    expect(done).toMatch(/CASE\s+WHEN\s+p_how\s*=\s*'shop'\s+THEN\s+now\(\)\s*\+\s*interval\s+'24 hours 15 minutes'\s+ELSE\s+now\(\)\s+END\)/i);
    const report = body("shops_report_not_received");
    expect(report).toMatch(/h\.confirmed_how\s*=\s*'shop'\s+AND\s+o\.handed_over_at\s*>\s*now\(\)\s*-\s*interval\s+'24 hours'/i);
    expect(report).toMatch(/ur\.role\s*=\s*'admin'/i);
  });

  it("5. no code anywhere in the Shops handover (owner 2026-10-18)", () => {
    for (const fn of [...MEMBER, ...SERVICE]) expect(body(fn), fn).not.toMatch(/\bp_code\b|handover_code|wrong_attempts/i);
  });
});
