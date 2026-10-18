/**
 * Shops M1b part 2 (20261018180859_shops_pickup_address; lead decision
 * 2026-10-18; tax memo Q3). The fast half of the proof, read from the NEWEST
 * definitions the migrations leave (effectiveDefs), so a later restatement
 * that widens who sees the address fails here:
 *
 *   1. No member or anon reads shop_pickup_addresses directly (REVOKE from
 *      PUBLIC, anon, authenticated; no GRANT to a member role).
 *   2. The order's buyer sees the address only once the maker accepted
 *      (status accepted or handed_over); the seller always.
 *   3. Saving it needs the 'shops' switch and refuses a banned caller.
 *   4. No function anon can run, and none of the public shop reads
 *      (shops_get_shop, shops_browse), touches the table.
 *   5. A new order needs the address (the BEFORE INSERT trigger on shop_orders).
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsPickupAddress.pglite.mjs
 * (45 PASS; the review-fixed buyer branch and updated_at rule put back to the
 * old code: 5 FAIL; measured 2026-10-18).
 */
// @mutate supabase/migrations/20261018180859_shops_pickup_address.sql | REVOKE ALL ON TABLE public.shop_pickup_addresses FROM PUBLIC, anon, authenticated; | GRANT SELECT ON TABLE public.shop_pickup_addresses TO authenticated;
// @mutate supabase/migrations/20261018180859_shops_pickup_address.sql |              AND o.status = 'accepted'\n | \n
// @mutate supabase/migrations/20261018180859_shops_pickup_address.sql |              AND current_date <= o.ready_date + 7\n | \n
// @mutate supabase/migrations/20261018180859_shops_pickup_address.sql |              AND NOT public.is_caller_banned())); | ));
// @mutate supabase/migrations/20261018180859_shops_pickup_address.sql |   PERFORM public.require_feature('shops');\n  IF public.is_caller_banned() THEN | IF public.is_caller_banned() THEN
// @mutate supabase/migrations/20261018180859_shops_pickup_address.sql |   BEFORE INSERT ON public.shop_orders\n | BEFORE INSERT ON public.shop_order_lines\n
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261018180859_shops_pickup_address.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");

describe("Shops pickup address stays private (20261018180859)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of ["shops_save_my_pickup_address", "shops_my_pickup_address", "shops_order_pickup_address", "shop_orders_need_pickup_address", "shops_get_shop", "shops_browse"]) {
      expect(DEFS.has(fn), fn).toBe(true);
    }
    expect(DEFS.size).toBeGreaterThan(500);
  });

  it("1. members and anon never read the table directly", () => {
    expect(MIG).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.shop_pickup_addresses\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i);
    expect(MIG).not.toMatch(/GRANT\s+[^;]*ON\s+TABLE\s+public\.shop_pickup_addresses\s+TO\s+[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  // Authz review 2026-10-18: accepted ONLY (never after handover, never "forever"),
  // at most a week past the ready date, never a banned buyer.
  it("2. the buyer sees it only while accepted (a week past the ready date at most, never banned); the seller always", () => {
    const b = body("shops_order_pickup_address");
    expect(b).toMatch(/o\.seller_id\s*=\s*auth\.uid\(\)/i);
    expect(b).toMatch(/o\.buyer_id\s*=\s*auth\.uid\(\)\s+AND\s+o\.status\s*=\s*'accepted'\s+AND\s+current_date\s*<=\s*o\.ready_date\s*\+\s*7\s+AND\s+NOT\s+public\.is_caller_banned\(\)/i);
    expect(b).not.toMatch(/handed_over/i);
    // Every buyer test in the body carries the status test (no second, bare buyer branch).
    expect((b.match(/o\.buyer_id\s*=\s*auth\.uid\(\)/gi) ?? []).length).toBe(1);
  });

  it("3. saving needs the switch and refuses a banned caller", () => {
    const b = body("shops_save_my_pickup_address");
    expect(b).toMatch(/\bBEGIN\b[\s\S]*?PERFORM\s+public\.require_feature\('shops'\);\s*IF\s+public\.is_caller_banned\(\)\s+THEN/i);
  });

  it("4. no public read touches the table", () => {
    for (const fn of ["shops_get_shop", "shops_browse"]) expect(body(fn), fn).not.toMatch(/shop_pickup_addresses/i);
    for (const [name, def] of DEFS) {
      if (!/shop_pickup_addresses/i.test(blankSqlComments(def.stmt))) continue;
      expect(["shops_save_my_pickup_address", "shops_my_pickup_address", "shops_order_pickup_address",
        "shop_orders_need_pickup_address", "shop_pickup_addresses_owner_is_shop_owner",
        // Download My Data: the owner's own row only (proven in the PGlite file, section 4b).
        "export_my_data"], name).toContain(name);
    }
  });

  it("5. a new order needs the pickup address", () => {
    expect(MIG).toMatch(/CREATE\s+TRIGGER\s+trg_shop_orders_need_pickup_address\s+BEFORE\s+INSERT\s+ON\s+public\.shop_orders\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.shop_orders_need_pickup_address\(\)/i);
    expect(body("shop_orders_need_pickup_address")).toMatch(/RAISE\s+EXCEPTION\s+'pickup_address_missing'/i);
  });
});
