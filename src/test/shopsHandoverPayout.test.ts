/**
 * Shops M2 (20261018211820_shops_handover_payout; docs/specs/local-shops-prep.md
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
 *   6. THE BUYER MUST CONFIRM (owner pop-up via the lead, 2026-10-18 ~21:00Z):
 *      only the buyer's "I got it", the clock or an admin finishes an order;
 *      the shop's own "Picked up" never does (no such RPC, no 'shop' method).
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsHandoverPayout.pglite.mjs
 * (78 PASS; NEW_MIGRATION=skip and planted defects red; bbeb5d877's migration, which still had the shop's
 * "Picked up", fails 4, and a planted shop RPC finishing via 'auto' fails 4, measured 2026-10-18 ~21:40Z).
 */
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql |        AND (o.handover_mode = 'in_person' OR h.ready_photo_path IS NOT NULL) |        AND true
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql | REVOKE ALL ON FUNCTION public.shop_payouts_due(integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shop_payouts_due(integer) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql |   v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' \|\| o.id::text, o.items_cents); |   v_debt := 0;
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql |   VALUES (o.id, o.items_cents, v_debt, o.items_cents - v_debt, |   VALUES (o.id, o.total_cents, v_debt, o.total_cents - v_debt,
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql |   IF p_how <> 'admin' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN |   IF false THEN
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql |   IF p_how IS NULL OR p_how NOT IN ('buyer', 'auto', 'admin') THEN |   IF p_how IS NULL OR p_how NOT IN ('buyer', 'shop', 'auto', 'admin') THEN
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql | confirmed_how IN ('buyer', 'auto', 'admin')), | confirmed_how IN ('buyer', 'shop', 'auto', 'admin')),
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql | DROP FUNCTION IF EXISTS public.shops_mark_picked_up(uuid); | SELECT 1;
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql | REVOKE ALL ON FUNCTION public.shops_confirm_pickup(uuid) FROM PUBLIC, anon; | CREATE OR REPLACE FUNCTION public.shops_mark_picked_up(p uuid) RETURNS jsonb LANGUAGE sql AS $m$ SELECT public.shop_complete_handover(p, 'auto') $m$; REVOKE ALL ON FUNCTION public.shops_confirm_pickup(uuid) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql |   IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF o.status = 'handed_over' THEN\n    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);\n  END IF;\n  RETURN public.shop_complete_handover(o.id, 'buyer'); |   IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF o.status = 'handed_over' THEN\n    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);\n  END IF;\n  RETURN public.shop_complete_handover(o.id, 'buyer');
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql | CREATE OR REPLACE FUNCTION public.shops_confirm_pickup(p_order_id uuid)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO 'public', 'pg_temp'\nAS $fn$\nDECLARE\n  v_uid uuid := (SELECT auth.uid());\n  o public.shop_orders;\nBEGIN\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF; | CREATE OR REPLACE FUNCTION public.shops_confirm_pickup(p_order_id uuid)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO 'public', 'pg_temp'\nAS $fn$\nDECLARE\n  v_uid uuid := (SELECT auth.uid());\n  o public.shop_orders;\nBEGIN\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;
// @mutate supabase/migrations/20261019013802_shop_free_cancel_ready_tap_day_before.sql | greatest(COALESCE(h.ready_at, 'infinity'::timestamptz), | greatest(COALESCE(o.handed_over_at, 'infinity'::timestamptz),
// @mutate supabase/migrations/20261019013802_shop_free_cancel_ready_tap_day_before.sql | ((o.ready_date - 1)::timestamp AT TIME ZONE 'America/Chicago'))) | '-infinity'::timestamptz))
// @mutate src/lib/shops/orders.ts | label: "Free to cancel until your order is ready", | label: "Free to cancel any time before you pick it up",
// @mutate src/lib/shops/orders.ts | until your ready date begins. If the shop marks your order ready, free cancel ends then, but never before the day before your ready date. | until pickup.
// @mutate src/lib/shops/orders.ts | , but never before the day before your ready date. | .
// @mutate supabase/migrations/20261019013802_shop_free_cancel_ready_tap_day_before.sql |            WHEN o.status IS DISTINCT FROM 'accepted' OR o.handed_over_at IS NOT NULL THEN '-infinity'::timestamptz |            WHEN o.status IS DISTINCT FROM 'accepted' THEN '-infinity'::timestamptz
// @mutate supabase/migrations/20261019013802_shop_free_cancel_ready_tap_day_before.sql | REVOKE ALL ON FUNCTION public.shop_order_free_cancel_until(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shop_order_free_cancel_until(uuid) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261019013802_shop_free_cancel_ready_tap_day_before.sql | row lock (FOR UPDATE) before refunding, and record | before refunding, and record
// @mutate supabase/migrations/20261018211820_shops_handover_payout.sql | REVOKE ALL ON FUNCTION public.shop_order_free_cancel_until(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shop_order_free_cancel_until(uuid) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.shop_order_free_cancel_until(uuid) TO authenticated;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261018211820_shops_handover_payout.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");

const MEMBER = ["shops_mark_ready", "shops_confirm_pickup", "shops_report_not_received"];
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

describe("Shops M2: the handover and the shop's payout keep their gates (20261018211820)", () => {
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

  it("6. the BUYER must confirm: only \"I got it\", the clock or an admin finishes an order, never the shop (owner 2026-10-18 ~21:00Z)", () => {
    const done = body("shop_complete_handover");
    // The transition takes exactly these ways an order is finished, and the table records no other.
    expect(done).toMatch(/IF\s+p_how\s+IS\s+NULL\s+OR\s+p_how\s+NOT\s+IN\s*\(\s*'buyer',\s*'auto',\s*'admin'\s*\)\s+THEN\s+RAISE\s+EXCEPTION\s+'invalid_method'/i);
    expect(done).not.toMatch(/'shop'/);
    expect(MIG).toMatch(/confirmed_how\s+text\s+CHECK\s*\(\s*confirmed_how\s+IS\s+NULL\s+OR\s+confirmed_how\s+IN\s*\(\s*'buyer',\s*'auto',\s*'admin'\s*\)\s*\)/i);
    // Every function any migration leaves that calls the transition: the buyer's tap and the clock, nothing else.
    const callers = [...DEFS.entries()]
      .filter(([name, d]) => name !== "shop_complete_handover" && /\bshop_complete_handover\s*\(/i.test(blankSqlComments(d.stmt)))
      .map(([name]) => name).sort();
    expect(callers).toEqual(["shop_handover_sweep", "shops_confirm_pickup"]);
    expect(DEFS.has("shops_mark_picked_up")).toBe(false);
    // And the transition stays the ONLY writer of a finished handover: no other function marks the
    // order handed over, stamps confirmed_at or writes a payout row (authz review of 201265b4c).
    const writers = (re: RegExp) => [...DEFS.entries()].filter(([, d]) => re.test(blankSqlComments(d.stmt))).map(([n]) => n).sort();
    expect(writers(/UPDATE\s+public\.shop_orders\b[^;]*?\bSET\s+status\s*=\s*'handed_over'/i)).toEqual(["shop_complete_handover"]);
    expect(writers(/(UPDATE\s+public\.shop_handovers\b[^;]*?\bconfirmed_at\s*=|INSERT\s+INTO\s+public\.shop_handovers\s*\([^)]*\bconfirmed_at\b)/i)).toEqual(["shop_complete_handover"]);
    expect(writers(/INSERT\s+INTO\s+public\.shop_payouts\b/i)).toEqual(["shop_complete_handover"]);
    expect(MIG).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.shops_mark_picked_up\(uuid\)/i);
    // "I got it" acts only for the order's BUYER, and the clock passes 'auto'.
    const got = body("shops_confirm_pickup");
    expect(got).toMatch(/IF\s+NOT\s+FOUND\s+OR\s+o\.buyer_id\s+IS\s+DISTINCT\s+FROM\s+v_uid\s+THEN\s+RAISE\s+EXCEPTION\s+'order_not_found'/i);
    expect(got).not.toMatch(/seller_id/i);
    expect(got).toMatch(/public\.shop_complete_handover\(o\.id,\s*'buyer'\)/i);
    expect(body("shop_handover_sweep")).toMatch(/public\.shop_complete_handover\(r\.id,\s*'auto'\)/i);
    // No delayed payout for a shop tap any more: once finished, the shop is owed at once.
    expect(done).not.toMatch(/interval\s+'24 hours/i);
    expect(body("shops_report_not_received")).toMatch(/ur\.role\s*=\s*'admin'/i);
  });

  it("7. 'cancel any time before pickup' closes free cancel when the ready date begins or at the shop's ready tap counted only from the day before, never at the handover (owner 2026-10-18 ~22:30Z + 2026-10-19 ~01:30Z, Q2155)", () => {
    const fn = body("shop_order_free_cancel_until");
    expect(fn.length).toBeGreaterThan(200);
    const branch = /WHEN\s+'until_handover'\s+THEN([\s\S]*?)(?=\bWHEN\b|\bEND\b)/i.exec(fn)?.[1] ?? "";
    expect(branch).toMatch(/\bleast\s*\(/i);
    expect(branch).toMatch(/o\.ready_date\b/);
    expect(branch).toMatch(/h\.ready_at\b/);
    // Owner 2026-10-19 ~01:30Z: a ready tap counts only from the start of the day before the ready date
    // (Louisiana time), so an early tap never cuts the window short.
    expect(branch).toMatch(/\bgreatest\s*\(\s*COALESCE\s*\(\s*h\.ready_at\s*,\s*'infinity'::timestamptz\s*\)\s*,\s*\(\(o\.ready_date\s*-\s*1\)::timestamp\s+AT\s+TIME\s+ZONE\s+'America\/Chicago'\)\s*\)/i);
    // The old window ran until the handover, which only the buyer (or the clock) records now.
    expect(branch).not.toMatch(/handed_over|confirmed_at|confirmed_how|status/i);
    // Only an accepted order not yet handed over has a window (an early "I got it" closes it under every
    // preset; lh-money-escrow of 1edece85d #1).
    expect(fn).toMatch(/CASE\s+WHEN\s+o\.status\s+IS\s+DISTINCT\s+FROM\s+'accepted'\s+OR\s+o\.handed_over_at\s+IS\s+NOT\s+NULL\s+THEN\s+'-infinity'::timestamptz\s+ELSE\s+CASE\s+o\.cancel_policy\b/i);
    // Service only, and the ONE place a preset becomes a time: no other function reads 'until_handover'
    // except the preset's own validator (M3's cancel of an accepted order must call this one).
    const SQL = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.shop_order_free_cancel_until[\s\S]*?REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.shop_order_free_cancel_until\(uuid\)\s+FROM\s+([^;]+);/i.exec(MIG);
    expect(SQL?.[1] ?? "").toMatch(/\bauthenticated\b/);
    // The newest definition restates the grants (service_role only) and tells M3 to read it under the row lock.
    const NEWEST = blankSqlComments(readFileSync(join(MIG_DIR, DEFS.get("shop_order_free_cancel_until")?.file ?? FILE), "utf8"));
    expect(NEWEST).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.shop_order_free_cancel_until\(uuid\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated;\s*GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.shop_order_free_cancel_until\(uuid\)\s+TO\s+service_role;/i);
    expect(NEWEST).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.shop_order_free_cancel_until\(uuid\)\s+TO\s+[^;]*\b(authenticated|anon|PUBLIC)\b/i);
    expect(NEWEST).toMatch(/COMMENT\s+ON\s+FUNCTION\s+public\.shop_order_free_cancel_until\(uuid\)\s+IS\s+'[^;]*row lock \(FOR UPDATE\) before refunding, and record free\/late on the order[^']*before that commit; call Stripe only after it/i);
    expect(MIG).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.shop_order_free_cancel_until\(uuid\)\s+TO\s+[^;]*\b(authenticated|anon|PUBLIC)\b/i);
    const readers = [...DEFS.entries()].filter(([, d]) => /'until_handover'/.test(blankSqlComments(d.stmt))).map(([n]) => n).sort();
    expect(readers).toEqual(["shop_order_free_cancel_until", "shops_set_cancel_policy"]);
    // The buyer reads the same promise before paying: ready, never pickup.
    const ts = blankComments(readFileSync(join(ROOT, "src/lib/shops/orders.ts"), "utf8"));
    const words = /until_handover:\s*\{([\s\S]*?)\}/.exec(ts)?.[1] ?? "";
    expect(words).toMatch(/label:\s*"[^"]*\bready\b[^"]*"/i);
    expect(words).toMatch(/detail:\s*"[^"]*ready date begins[^"]*marks your order ready[^"]*never before the day before your ready date[^"]*"/i);
    expect(words).not.toMatch(/pick\s*(it\s*)?up|pickup|handover|hand(ed)?\s+over/i);
  });

  it("5. no code anywhere in the Shops handover (owner 2026-10-18)", () => {
    for (const fn of [...MEMBER, ...SERVICE]) expect(body(fn), fn).not.toMatch(/\bp_code\b|handover_code|wrong_attempts/i);
  });
});
