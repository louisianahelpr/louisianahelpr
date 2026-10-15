/**
 * Shops slice 1 (20261015123029_shops_profiles; owner decisions in
 * docs/specs/local-shops-prep.md "Owner answers"). The fast half of the proof:
 * the shape every later slice must keep, read from the NEWEST definitions the
 * migrations leave (effectiveDefs), so a later restatement that drops a gate
 * fails here.
 *
 *   1. Every client-callable shops_* RPC starts with
 *      PERFORM public.require_feature('shops') (hidden switch, server side).
 *   2. Every VOLATILE one names is_caller_banned() in its own body (the Q281
 *      class check reads the RPC's body); the owner writes run
 *      shops_assert_owner_eligible (18+, strikes, payouts: L3, L45, L82).
 *   3. The owner gate keeps every refusal; a hidden shop cannot be closed
 *      (L75); admins cannot act on their own shop.
 *   4. No phone, email or website column (L49) and no client read of who
 *      hid or checked a shop (column grants).
 *   5. The switch is created OFF.
 *   6. SHOPS_ERROR_COPY is exact both ways against the codes the migration raises.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsProfiles.pglite.mjs
 * (94 PASS on the migration, 3x replay; NEW_MIGRATION=skip 0 PASS / 94 FAIL; 8 planted defects each caught, measured
 * 2026-10-15).
 */
// @mutate supabase/migrations/20261015123029_shops_profiles.sql | BEGIN\n  PERFORM public.require_feature('shops');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  v_uid := public.shops_assert_owner_eligible();\n\n  IF p_name | BEGIN\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  v_uid := public.shops_assert_owner_eligible();\n\n  IF p_name
// @mutate supabase/migrations/20261015123029_shops_profiles.sql |   IF public.member_under_18(v_uid) THEN | IF false THEN
// @mutate supabase/migrations/20261015123029_shops_profiles.sql |   IF public.declutter_active_strike_count(v_uid) >= 3 THEN | IF public.declutter_active_strike_count(v_uid) >= 4 THEN
// @mutate supabase/migrations/20261015123029_shops_profiles.sql |   IF public.helper_award_block_reason(v_uid) IS NOT NULL THEN | IF false THEN
// @mutate supabase/migrations/20261015123029_shops_profiles.sql | VALUES ('shops', 'off', | VALUES ('shops', 'testers',
// @mutate supabase/migrations/20261015123029_shops_profiles.sql |   IF EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid AND hidden_at IS NOT NULL) THEN | IF false THEN
// @mutate supabase/migrations/20261015123029_shops_profiles.sql | REVOKE ALL ON FUNCTION public.shops_assert_owner_eligible() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shops_assert_owner_eligible() FROM PUBLIC, anon;
// @mutate src/lib/shops/errors.ts |   invalid_hours: "Each time needs a day, and an opening time before its closing time.",\n | \n
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { SHOPS_ERROR_COPY } from "@/lib/shops/errors";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261015123029_shops_profiles.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const OWNER_RPCS = ["shops_save_my_shop", "shops_set_hours", "shops_attach_photo"];
const MEMBER_WRITE_RPCS = ["shops_set_paused", "shops_remove_photo", "shops_close_my_shop", "shops_set_follow"];
const READ_RPCS = ["shops_get_shop", "shops_my_shop_id", "shops_browse"];
const ADMIN_RPCS = ["shops_admin_check_registration", "shops_admin_set_hidden"];
const INTERNAL = ["shops_assert_owner_eligible", "shop_owner_in_good_standing", "shop_badges", "shop_owner_rating", "shop_visible_to"];

/** Functions the migration GRANTs EXECUTE to authenticated (newest statement wins per name). */
function clientCallable(): Set<string> {
  const out = new Set<string>();
  for (const m of MIG.matchAll(/(GRANT\s+EXECUTE|REVOKE\s+ALL)\s+ON\s+FUNCTION\s+public\.(shops?_\w+)\s*\([^)]*\)\s+(?:TO|FROM)\s+([^;]+);/gi)) {
    const roles = m[3].toLowerCase();
    if (/^grant/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.add(m[2]);
    if (/^revoke/i.test(m[1]) && /\bauthenticated\b/.test(roles)) out.delete(m[2]);
  }
  return out;
}

describe("Shops slice 1: hidden, gated, no contact details (20261015123029)", () => {
  const callable = clientCallable();
  const rpcs = [...OWNER_RPCS, ...MEMBER_WRITE_RPCS, ...READ_RPCS, ...ADMIN_RPCS];

  it("reads a real inventory (floors)", () => {
    expect(DEFS.has("shops_save_my_shop")).toBe(true);
    // The RPCs plus the standing helper the shops read policy calls.
    expect([...callable].sort()).toEqual([...rpcs, "shop_publicly_visible"].sort());
    expect(callable.size).toBeGreaterThan(12);
  });

  it("1. every client-callable shops_* RPC starts with require_feature('shops')", () => {
    const missing = rpcs.filter((fn) => !/\bBEGIN\s+PERFORM\s+public\.require_feature\('shops'\);/i.test(body(fn)));
    expect(missing).toEqual([]);
  });

  it("2. every write RPC names is_caller_banned(); owner writes run the owner gate", () => {
    for (const fn of [...OWNER_RPCS, ...MEMBER_WRITE_RPCS, ...ADMIN_RPCS]) {
      const b = body(fn);
      expect(b, `${fn} must not be STABLE/IMMUTABLE (it writes)`).not.toMatch(/\b(STABLE|IMMUTABLE)\b/i);
      expect(b, `${fn} names is_caller_banned()`).toMatch(/public\.is_caller_banned\(\)/);
    }
    for (const fn of OWNER_RPCS) expect(body(fn), fn).toContain("v_uid := public.shops_assert_owner_eligible();");
  });

  it("3. the gates themselves", () => {
    const gate = flat(body("shops_assert_owner_eligible"));
    for (const must of [
      "IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'",
      "IF public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted'",
      "IF public.member_under_18(v_uid) THEN RAISE EXCEPTION 'under_18'",
      "IF public.declutter_active_strike_count(v_uid) >= 3 THEN RAISE EXCEPTION 'shop_strikes_blocked'",
      "IF public.helper_award_block_reason(v_uid) IS NOT NULL THEN RAISE EXCEPTION 'payout_setup_incomplete'",
    ]) expect(gate).toContain(must);
    expect(flat(body("shops_close_my_shop"))).toContain(
      "IF EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid AND hidden_at IS NOT NULL) THEN RAISE EXCEPTION 'shop_hidden'",
    );
    for (const fn of ADMIN_RPCS) {
      expect(flat(body(fn)), fn).toContain("IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'not_admin'");
      expect(flat(body(fn)), fn).toContain("IF v_owner = v_uid THEN RAISE EXCEPTION 'own_shop'");
      expect(body(fn), fn).toContain("INSERT INTO public.admin_audit_log");
    }
    for (const fn of INTERNAL) {
      expect(MIG, `${fn} is not client-callable`).toMatch(
        new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.${fn}\([^)]*\) FROM PUBLIC, anon, authenticated;`),
      );
      expect(callable.has(fn), fn).toBe(false);
    }
  });

  it("4. no contact column (L49); who hid or checked a shop is not client-readable", () => {
    const shops = /CREATE TABLE IF NOT EXISTS public\.shops \(([\s\S]*?)\n\);/.exec(MIG)?.[1] ?? "";
    expect(shops).toContain("area_label");
    expect(shops).not.toMatch(/\b(phone|email|website|url)\b/i);
    expect(MIG).not.toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.shops\s+TO\s+authenticated/i);
    const cols = /GRANT SELECT \(([^)]*)\)\s+ON TABLE public\.shops TO authenticated;/.exec(MIG)?.[1] ?? "";
    expect(cols).toContain("owner_id");
    expect(cols).not.toMatch(/sos_number|sos_verified_by|hidden_by|hidden_reason/);
    expect(MIG).toContain("CREATE TRIGGER trg_reject_contact_leak_in_shop");
  });

  it("5. the switch is created OFF", () => {
    expect(MIG).toMatch(/INSERT INTO public\.feature_switches \(key, audience, description\)\s+VALUES \('shops', 'off',/);
  });

  it("6. SHOPS_ERROR_COPY is exact against the codes the migration raises", () => {
    const raised = new Set([...MIG.matchAll(/RAISE EXCEPTION '([a-z0-9_]+)'/g)].map((m) => m[1]));
    raised.add("feature_disabled"); // require_feature's code
    expect(raised.size).toBeGreaterThan(20);
    expect([...raised].filter((c) => !(c in SHOPS_ERROR_COPY)).sort()).toEqual([]);
    expect(Object.keys(SHOPS_ERROR_COPY).filter((c) => !raised.has(c)).sort()).toEqual([]);
  });
});
