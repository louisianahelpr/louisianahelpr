/**
 * Shops M1 (20261018154737_shops_orders_checkout; docs/specs/local-shops-prep.md
 * L17-L22, F1, L82, L91). The fast half of the proof: the shape every later
 * slice must keep, read from the NEWEST definitions the migrations leave
 * (effectiveDefs), so a later restatement that drops a gate fails here.
 *
 *   1. Starting new work needs the 'shops' switch: asking for an order and
 *      accepting one run require_feature('shops') first; letting a buyer's money
 *      go (decline, withdraw) never does (L91).
 *   2. Every client-callable order RPC names is_caller_banned() in its own body.
 *   3. The service steps (holds, captures, sweep) are revoked from authenticated.
 *   4. The fee CHECK on shop_orders is F1 exactly, and the app's preview
 *      (src/lib/declutter/money.ts checkoutAmounts) gives the same numbers.
 *   5. lh-money-escrow review (2026-10-17): the daily cap and the home-food
 *      limit at acceptance are read under FOR UPDATE on the shop row (FOR SHARE
 *      let two accepts both pass), and a hold is marked released by a failed
 *      capture ONLY when Stripe said canceled (p_final).
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsOrders.pglite.mjs
 * (97 PASS; 10 planted defects each caught, measured 2026-10-18; the review
 * fixes' 11 cases red on the pre-review migration).
 */
// @mutate supabase/migrations/20261018154737_shops_orders_checkout.sql | BEGIN\n  PERFORM public.require_feature('shops');\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;\n  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF o.status = 'accepted' THEN | BEGIN\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;\n  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF o.status = 'accepted' THEN
// @mutate supabase/migrations/20261018154737_shops_orders_checkout.sql | REVOKE ALL ON FUNCTION public.shop_hold_released(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shop_hold_released(uuid) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261018154737_shops_orders_checkout.sql |   SELECT daily_order_cap INTO v_cap FROM public.shops WHERE id = o.shop_id FOR UPDATE; |   SELECT daily_order_cap INTO v_cap FROM public.shops WHERE id = o.shop_id FOR SHARE;
// @mutate supabase/migrations/20261018154737_shops_orders_checkout.sql |     PERFORM 1 FROM public.shops WHERE id = v_shop FOR UPDATE; |     PERFORM 1;
// @mutate supabase/migrations/20261018154737_shops_orders_checkout.sql | hold_released_at = CASE WHEN COALESCE(p_final, false) THEN now() ELSE NULL END, | hold_released_at = now(),
// @mutate supabase/migrations/20261018154737_shops_orders_checkout.sql |   CONSTRAINT shop_orders_premium_rule CHECK (premium_cents = round(items_cents * 0.05)::integer + 70), |   CONSTRAINT shop_orders_premium_rule CHECK (premium_cents = round(items_cents * 0.06)::integer + 70),
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { checkoutAmounts } from "@/lib/declutter/money";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261018154737_shops_orders_checkout.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");

const NEW_WORK = ["shops_request_order", "shops_accept_order", "shops_set_cancel_policy", "shops_order_terms"];
const LET_GO = ["shops_decline_order", "shops_cancel_order_request"];
const SERVICE = ["shop_attach_checkout_session", "shop_mark_order_held", "shop_order_captured", "shop_order_capture_failed",
  "shop_captures_due", "shop_holds_to_release", "shop_hold_released", "shop_hold_release_failed", "shop_order_sweep", "shop_line_unit_cents", "shop_day_count"];

/**
 * Functions whose newest REVOKE/GRANT in this migration leaves EXECUTE with
 * authenticated. Prod's pg_default_acl grants EXECUTE on every new function to
 * anon and authenticated, so a function starts granted and only a REVOKE that
 * names authenticated takes it away.
 */
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

describe("Shops M1: orders and the card hold keep their gates (20261018154737)", () => {
  const granted = grantedToAuthenticated();

  it("reads a real inventory (floors)", () => {
    for (const fn of [...NEW_WORK, ...LET_GO, ...SERVICE]) expect(DEFS.has(fn), fn).toBe(true);
    expect(granted.size).toBeGreaterThan(4);
  });

  it("1. new work starts with require_feature('shops'); letting money go never needs the switch (L91)", () => {
    for (const fn of NEW_WORK) expect(body(fn), fn).toMatch(/\bBEGIN\s+PERFORM\s+public\.require_feature\('shops'\);/i);
    for (const fn of LET_GO) expect(body(fn), fn).not.toMatch(/require_feature\('shops'\)/i);
  });

  it("2. every client-callable order RPC names is_caller_banned() in its own body", () => {
    const missing = [...NEW_WORK, ...LET_GO].filter((fn) => !/public\.is_caller_banned\(\)/i.test(body(fn)));
    expect(missing).toEqual([]);
  });

  it("3. members can call exactly the order RPCs; every service step is closed to them", () => {
    expect([...granted].filter((f) => SERVICE.includes(f))).toEqual([]);
    expect([...granted].sort()).toEqual([...NEW_WORK, ...LET_GO, "shop_local_today"].sort());
  });

  it("4. the fee CHECK is F1 exactly, and the app's preview gives the same numbers", () => {
    expect(MIG).toMatch(/CONSTRAINT\s+shop_orders_premium_rule\s+CHECK\s*\(\s*premium_cents\s*=\s*round\(items_cents\s*\*\s*0\.05\)::integer\s*\+\s*70\s*\)/i);
    expect(body("shops_request_order")).toMatch(/public\.declutter_buyer_fee_cents\(v_items\)/);
    for (const items of [100, 1800, 6100, 99999, 100000]) {
      expect(checkoutAmounts([items]).premiumCents, String(items)).toBe(Math.round(items * 0.05) + 70);
    }
  });

  it("5. accepts are serialized on the shop row, and a failed capture marks a hold released only when Stripe said canceled", () => {
    const accept = body("shops_accept_order");
    expect(accept).toMatch(/FROM\s+public\.shops\s+WHERE\s+id\s*=\s*o\.shop_id\s+FOR\s+UPDATE\s*;/i);
    expect(accept).not.toMatch(/FROM\s+public\.shops\s+WHERE[^;]*FOR\s+SHARE/i);
    expect(accept).toMatch(/shop_cottage_sales_cents\(v_uid\)/);
    const held = body("shop_mark_order_held");
    expect(held).toMatch(/FROM\s+public\.shops\s+WHERE\s+id\s*=\s*o\.shop_id\s+FOR\s+UPDATE\s*;/i);
    // Shop row before the order row, as shops_request_order takes them (no deadlock with a re-ask).
    const shopLock = held.search(/FROM\s+public\.shops\s+WHERE\s+id\s*=\s*v_shop\s+FOR\s+UPDATE/i);
    const orderLock = held.search(/FROM\s+public\.shop_orders\s+WHERE\s+stripe_checkout_session_id\s*=\s*p_session_id\s+FOR\s+UPDATE/i);
    expect(shopLock).toBeGreaterThan(-1);
    expect(orderLock).toBeGreaterThan(shopLock);
    const failed = body("shop_order_capture_failed");
    const sets = [...failed.matchAll(/hold_released_at\s*=\s*(CASE\b[\s\S]*?\bEND\b|[^,\n]+)/gi)].map((m) => m[1].trim());
    expect(sets.length).toBeGreaterThan(0);
    for (const v of sets) expect(v).toMatch(/^CASE\s+WHEN\s+COALESCE\(p_final,\s*false\)\s+THEN\s+now\(\)\s+ELSE\s+NULL\s+END$/i);
  });
});
