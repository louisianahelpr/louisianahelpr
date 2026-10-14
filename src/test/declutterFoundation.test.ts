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
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql | BEGIN\n  PERFORM public.require_feature('declutter');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  PERFORM public.declutter_assert_member(false);\n  v_uid := (SELECT auth.uid());\n\n  IF p_watch | BEGIN\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  PERFORM public.declutter_assert_member(false);\n  v_uid := (SELECT auth.uid());\n\n  IF p_watch
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   PERFORM public.declutter_assert_member(true);\n  v_uid := (SELECT auth.uid());\n\n  IF p_price_cents |   PERFORM public.declutter_assert_member(true);\n  v_uid := public.declutter_assert_member(true);\n\n  IF p_price_cents
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid) THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_seller = v_uid THEN\n    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';\n  END IF;\n  -- One |   IF NOT FOUND THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_seller = v_uid THEN\n    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';\n  END IF;\n  -- One
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   IF p_selling IS NOT FALSE AND public.member_under_18(v_uid) THEN |   IF false THEN
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   IF public.declutter_active_strike_count(v_uid) >= 3 THEN |   IF public.declutter_active_strike_count(v_uid) >= 4 THEN
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   v_payout := public.helper_award_block_reason(v_uid); |   v_payout := NULL;
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   IF v_photos < 3 OR v_photos > 12 THEN |   IF v_photos < 1 OR v_photos > 12 THEN
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   v_status := CASE WHEN v_approved < 3 THEN 'pending_review' ELSE 'live' END; |   v_status := 'live';
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql | GRANT ALL ON TABLE public.declutter_item_private TO service_role; | GRANT ALL ON TABLE public.declutter_item_private TO service_role, authenticated;
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql | REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   area_label text NOT NULL CHECK | floor_price_cents integer, area_label text NOT NULL CHECK
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql | VALUES ('declutter', 'off', | VALUES ('declutter', 'testers',
// @mutate supabase/migrations/20261014193955_declutter_foundation.sql |   IF v_item.sale_mode <> 'offers' THEN |   IF false THEN
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
    const missing = [...callable].filter(
      (fn) => !/\bBEGIN\s+PERFORM\s+public\.require_feature\('declutter'\);/i.test(body(fn)),
    );
    expect(missing).toEqual([]);
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
    for (const fn of BUYER_RPCS) expect(body(fn), fn).toContain("IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid) THEN");
    expect(body("declutter_ask_question")).toContain("pg_advisory_xact_lock(hashtext('declutter_ask:' || v_uid::text))");
    expect(body("declutter_add_item_photo")).toContain("AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')");
    for (const fn of BUYER_RPCS) expect(body(fn), fn).toMatch(/declutter_assert_member\(false\)/);
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
    for (const must of [
      "v_payout := public.helper_award_block_reason(v_uid); IF v_payout IS NOT NULL THEN",
      "IF v_photos < 3 OR v_photos > 12 THEN",
      "IF v_item.sale_mode <> 'offers' THEN",
      "FROM public.declutter_tax_attestations a WHERE a.item_id = p_item_id AND a.seller_id = v_uid",
      "FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid",
      "v_status := CASE WHEN v_approved < 3 THEN 'pending_review' ELSE 'live' END;",
    ]) expect(pub).toContain(must);
    expect(flat(body("declutter_create_item"))).toContain("v_uid, 'offers', 'draft'");
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
    expect(flat(body("declutter_item_address"))).toContain("IF public.declutter_address_access(p_item_id, (SELECT auth.uid())) IS NULL THEN");
    expect(flat(body("declutter_item_address"))).not.toMatch(/floor/);
    expect(flat(body("declutter_address_access"))).toContain("SELECT CASE WHEN i.seller_id = p_user_id THEN 'seller' END");
  });

  it("4b. no app code reads the private table directly", () => {
    const hits: string[] = [];
    const files = walkSource([join(ROOT, "src"), join(ROOT, "supabase/functions")]);
    expect(files.length).toBeGreaterThan(1000);
    for (const f of files) {
      if (/\.test\.|\/test\/|integrations\/supabase\/types/.test(f)) continue;
      const code = readSource(f);
      if (code && /declutter_item_private/.test(blankComments(code))) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("5. the switch is created OFF and the behaviour proof exists", () => {
    expect(flat(MIG)).toContain("VALUES ('declutter', 'off',");
    const proof = join(ROOT, "src/test/pglite/declutterFoundation.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    expect(readFileSync(proof, "utf8")).toContain(FILE);
  });
});
