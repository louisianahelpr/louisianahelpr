/**
 * Declutter slice 1 (20261014193955_declutter_foundation; owner decisions in
 * docs/specs/declutter-auctions.md). The fast half of the proof: the shape
 * every later slice must keep, read from the NEWEST definitions the migrations
 * leave (effectiveDefs), so a later restatement that drops a gate fails here.
 *
 *   1. Every client-callable declutter_* RPC starts with
 *      PERFORM public.require_feature('declutter') (hidden switch, server side).
 *   2. Every VOLATILE one names is_caller_banned() in its own body (the Q281
 *      class check reads the RPC's body) and runs declutter_assert_member():
 *      seller RPCs with true (adds under 18, row 53), buyer RPCs with false;
 *      the caller is read with auth.uid() in the RPC's own body; a blocked
 *      pair cannot watch or ask; the daily question cap is serialized.
 *   3. declutter_assert_member refuses 3 active Declutter strikes (rows 16/17)
 *      and under-18 sellers; publish keeps payout setup (row 23), 3-12 photos
 *      (row 31), the tax confirmations (row 54), pickup times (row 52), the
 *      first-3-listings review (row 33) and offers-only (row 55).
 *   4. PRIVACY (rows 8/56, 27): the public declutter_items row has no floor or
 *      address column; declutter_item_private is granted to no client role and
 *      has no policy; the address hook (declutter_address_access) is
 *      server-only; no app code reads the private table.
 *   5. The switch is created OFF.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/declutterFoundation.pglite.mjs
 * (71 PASS on the migration; NEW_MIGRATION=skip 0 PASS / 71 FAIL; 14 planted
 * defects each caught, measured 2026-10-14).
 */
// @mutate supabase/migrations/20261020033623_declutter_items_seed_boundary.sql | BEGIN\n  PERFORM public.require_feature('declutter');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  PERFORM public.declutter_assert_member(false);\n  v_uid := (SELECT auth.uid());\n\n  IF p_watch | BEGIN\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  PERFORM public.declutter_assert_member(false);\n  v_uid := (SELECT auth.uid());\n\n  IF p_watch
// @mutate supabase/migrations/20261031160546_declutter_create_item_with_id.sql |   PERFORM public.declutter_assert_member(true);\n  v_uid := (SELECT auth.uid());\n  -- The gates above |   PERFORM public.declutter_assert_member(true);\n  v_uid := public.declutter_assert_member(true);\n  -- The gates above
// @mutate supabase/migrations/20261031160546_declutter_create_item_with_id.sql |   v_uid := (SELECT auth.uid());\n\n  IF p_item_id IS NULL THEN |   v_uid := public.declutter_assert_member(true);\n\n  IF p_item_id IS NULL THEN
// @mutate supabase/migrations/20261031160546_declutter_create_item_with_id.sql |     gen_random_uuid(), p_title, | p_title, p_title,
// @mutate supabase/migrations/20261020033623_declutter_items_seed_boundary.sql |   IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid)\n     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_seller = v_uid THEN\n    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';\n  END IF;\n  -- One |   IF NOT FOUND\n     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_seller = v_uid THEN\n    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';\n  END IF;\n  -- One
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   IF p_selling IS NOT FALSE AND public.member_under_18(v_uid) THEN |   IF false THEN
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   IF public.declutter_active_strike_count(v_uid) >= 3 THEN |   IF public.declutter_active_strike_count(v_uid) >= 4 THEN
// @mutate supabase/migrations/20261031152545_declutter_check_after_post.sql |   -- Row 23 (payout setup before the first listing) is dropped (owner |   PERFORM public.helper_award_block_reason(v_uid); -- Row 23 (owner
// @mutate supabase/migrations/20261031152545_declutter_check_after_post.sql |   IF v_photos < 1 OR v_photos > 12 THEN |   IF v_photos < 0 OR v_photos > 12 THEN
// @mutate supabase/migrations/20261031152545_declutter_check_after_post.sql |     ELSE 'live'\n  END;\n\n  UPDATE public.declutter_items | ELSE 'pending_review'\n  END;\n\n  UPDATE public.declutter_items
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql | GRANT ALL ON TABLE public.declutter_item_private TO service_role; | GRANT ALL ON TABLE public.declutter_item_private TO service_role, authenticated;
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql | REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   area_label text NOT NULL CHECK | floor_price_cents integer, area_label text NOT NULL CHECK
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql | VALUES ('declutter', 'off', | VALUES ('declutter', 'testers',
// @mutate supabase/migrations/20261031152545_declutter_check_after_post.sql |   IF v_item.sale_mode <> 'offers' THEN |   IF false THEN
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261014193955_declutter_foundation.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const SELLER_RPCS = [
  "declutter_create_item",
  "declutter_add_item_photo",
  "declutter_remove_item_photo",
  "declutter_attest_item",
  "declutter_set_pickup_windows",
  "declutter_publish_item",
  "declutter_answer_question",
];
const BUYER_RPCS = ["declutter_set_watch", "declutter_ask_question"];
const READ_RPCS = ["declutter_seller_item_private", "declutter_item_address"];
const INTERNAL = ["declutter_active_strike_count", "declutter_address_access", "declutter_assert_member"];

/** Functions the migrations GRANT EXECUTE to authenticated (newest statement wins per name). */
function clientCallable(): Set<string> {
  const out = new Set<string>();
  for (const m of MIG.matchAll(/(GRANT\s+EXECUTE|REVOKE\s+ALL)\s+ON\s+FUNCTION\s+public\.(declutter_\w+)\s*\([^)]*\)\s+(?:TO|FROM)\s+([^;]+);/gi)) {
    const roles = m[3].toLowerCase();
    if (/^grant/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.add(m[2]);
    if (/^revoke/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.delete(m[2]);
  }
  return out;
}

describe("Declutter slice 1: hidden, gated, private (20261014193955)", () => {
  const callable = clientCallable();

  it("reads a real inventory (floors)", () => {
    expect(DEFS.has("declutter_publish_item")).toBe(true);
    expect(callable.size).toBe(SELLER_RPCS.length + BUYER_RPCS.length + READ_RPCS.length);
    expect([...callable].sort()).toEqual([...SELLER_RPCS, ...BUYER_RPCS, ...READ_RPCS].sort());
  });

  it("1. every client-callable Declutter RPC starts with require_feature('declutter')", () => {
    // Slice 4 (20261015042253, row 62): the two readers skip the switch ONLY for
    // a side of an agreed sale on that item (and the paid buyer's address).
    const missing = [...callable].filter((fn) => !READ_RPCS.includes(fn)).filter(
      (fn) => !/\bBEGIN\s+PERFORM\s+public\.require_feature\('declutter'\);/i.test(body(fn)),
    );
    expect(missing).toEqual([]);
    for (const fn of READ_RPCS) {
      expect(flat(body(fn)), fn).toMatch(
        /NOT public\.declutter_in_agreed_sale\(p_item_id, \(SELECT auth\.uid\(\)\)\) THEN PERFORM public\.require_feature\('declutter'\); END IF;/,
      );
    }
  });

  it("2. every write RPC names is_caller_banned() and runs the member gates (sellers with the under-18 rule)", () => {
    for (const fn of [...SELLER_RPCS, ...BUYER_RPCS]) {
      const b = body(fn);
      expect(b, `${fn} must not be STABLE/IMMUTABLE (it writes)`).not.toMatch(/\b(STABLE|IMMUTABLE)\b/i);
      expect(b, `${fn} names is_caller_banned()`).toMatch(/public\.is_caller_banned\(\)/);
    }
    for (const fn of SELLER_RPCS) expect(body(fn), fn).toMatch(/declutter_assert_member\(true\)/);
    // The caller comes from auth.uid() in the RPC's own body: the live Q1284
    // rule (scripts/check-live-privileges.mjs) cannot see it through a helper.
    for (const fn of [...SELLER_RPCS, ...BUYER_RPCS]) expect(body(fn), fn).toContain("v_uid := (SELECT auth.uid());");
    for (const fn of BUYER_RPCS) expect(body(fn), fn).toContain("IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid)");
    expect(body("declutter_ask_question")).toContain("pg_advisory_xact_lock(hashtext('declutter_ask:' || v_uid::text))");
    expect(body("declutter_add_item_photo")).toContain("AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')");
    for (const fn of BUYER_RPCS) expect(body(fn), fn).toMatch(/declutter_assert_member\(false\)/);
    // LEAD-POST-SLOW (a): declutter_create_item makes its item through declutter_create_item_with_id (the app's own
    // id), which runs every gate itself too, for auth.uid().
    const withId = body("declutter_create_item_with_id");
    expect(withId).toMatch(/\bBEGIN\s+PERFORM\s+public\.require_feature\('declutter'\);/);
    for (const must of ["public.is_caller_banned()", "PERFORM public.declutter_assert_member(true);", "v_uid := (SELECT auth.uid());"]) expect(withId, must).toContain(must);
  });

  it("3. the gates themselves", () => {
    const gate = flat(body("declutter_assert_member"));
    expect(gate).toContain("IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'");
    expect(gate).toContain("IF public.declutter_active_strike_count(v_uid) >= 3 THEN");
    expect(gate).toContain("IF p_selling IS NOT FALSE AND public.member_under_18(v_uid) THEN");
    const strikes = flat(body("declutter_active_strike_count"));
    expect(strikes).toContain("s.removed_at IS NULL AND s.expires_at > now()");
    expect(flat(body("declutter_strike_expiry"))).toContain("NEW.expires_at := NEW.given_at + interval '1 year'");
    const pub = flat(body("declutter_publish_item"));
    // Row 23 dropped (owner 2026-10-27, list first, set up at first sale).
    expect(pub).not.toContain("helper_award_block_reason");
    for (const must of [
      "IF v_photos < 1 OR v_photos > 12 THEN", // owner 2026-10-20: one photo (was 3)
      "IF v_item.sale_mode <> 'offers' THEN",
      "FROM public.declutter_tax_attestations a WHERE a.item_id = p_item_id AND a.seller_id = v_uid",
      "FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid",
      // Slice 2 (20261014200728) added the AI gate; item B (owner 2026-10-29, 20261030071816) dropped row 33's "first 3" hold.
      "v_status := CASE WHEN v_ai_checked IS NOT NULL AND v_ai_flag IS NOT NULL THEN 'pending_review' ELSE 'live' END;",
    ]) expect(pub).toContain(must);
    expect(flat(body("declutter_create_item_with_id"))).toContain("p_item_id, v_uid, 'offers', 'draft'");
    expect(flat(body("declutter_create_item"))).toContain("RETURN public.declutter_create_item_with_id( gen_random_uuid(), p_title,");
  });

  it("4. the floor price and exact address never sit where a buyer can read them", () => {
    const items = /CREATE TABLE IF NOT EXISTS public\.declutter_items \(([\s\S]*?)\n\);/.exec(MIG)?.[1] ?? "";
    expect(items).toContain("price_cents");
    expect(items).not.toMatch(/floor|address|pickup_lat|pickup_lng/i);
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.declutter_item_private \([\s\S]*?floor_price_cents[\s\S]*?pickup_address/);
    // No client privilege, no policy, on the private table.
    expect(MIG).not.toMatch(/GRANT\s+[^;]*\bON\s+(?:TABLE\s+)?public\.declutter_item_private\b[^;]*\b(anon|authenticated|PUBLIC)\b/i);
    expect(MIG).not.toMatch(/CREATE\s+POLICY[^;]*\bON\s+public\.declutter_item_private\b/i);
    expect(MIG).toContain("REVOKE ALL ON TABLE public.declutter_item_private FROM PUBLIC, anon, authenticated;");
    // The address hook and the counters are server-only.
    for (const fn of INTERNAL) {
      expect(callable.has(fn), `${fn} must not be client-callable`).toBe(false);
      expect(MIG, fn).toMatch(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.${fn}\([^)]*\) FROM PUBLIC, anon, authenticated;`));
    }
    // The readers: the seller's private half is the seller's; the address goes through the hook.
    expect(flat(body("declutter_seller_item_private"))).toContain("AND p.seller_id = (SELECT auth.uid());");
    expect(flat(body("declutter_item_address"))).toContain("v_access text := public.declutter_address_access(p_item_id, (SELECT auth.uid()));");
    expect(flat(body("declutter_item_address"))).toContain("IF v_access IS NULL THEN RAISE EXCEPTION 'item_not_found'");
    expect(flat(body("declutter_item_address"))).not.toMatch(/floor/);
    // The seller, and (slice 4, row 98) the buyer of a PAID order holding the item: nobody else.
    expect(flat(body("declutter_address_access"))).toContain("WHEN i.seller_id = p_user_id THEN 'seller'");
    // Seller delivery (20261027153244): a buyer the seller delivers to never gets the seller's address.
    expect(flat(body("declutter_address_access"))).toContain("AND o.status = 'paid' AND o.buyer_id = p_user_id AND o.handover NOT IN ('seller_delivery', 'meetup', 'ship')) THEN 'paid_buyer' END");
    // Shipping S2 (20261030000030): nor does the buyer of a shipped order (the line above).
    // Q2425 (20261027204500): nor does a buyer meeting at a safe public spot (the line above).
  });

  it("4b. no app code reads the private table directly", () => {
    const hits: string[] = [];
    const files = walkSource([join(ROOT, "src"), join(ROOT, "supabase/functions")]);
    expect(files.length).toBeGreaterThan(1000);
    for (const f of files) {
      if (/\.test\.|\/test\/|integrations\/supabase\/types/.test(f)) continue;
      const code = readSource(f);
      if (code && /declutter_item_private/.test(blankComments(code))) hits.push(f.slice(ROOT.length + 1));
    }
    // EXACT both ways. ship-rates (Shipping S2, Q2259) runs as the service role and reads ONLY pickup_address of the
    // signed-in buyer's own in-cart items, to take the seller's ZIP for a postage quote; the address is never returned
    // and only the ZIP goes to EasyPost (src/test/shipRatesFunction.test.ts).
    expect(hits.sort()).toEqual(["supabase/functions/ship-rates/index.ts"]);
  });

  it("5. the switch is created OFF and the behaviour proof exists", () => {
    expect(flat(MIG)).toContain("VALUES ('declutter', 'off',");
    const proof = join(ROOT, "src/test/pglite/declutterFoundation.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    expect(readFileSync(proof, "utf8")).toContain(FILE);
  });
});
