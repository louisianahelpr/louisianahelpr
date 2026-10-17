/**
 * Shops slice 2: items (20261017060556_shops_items; owner decisions in
 * docs/specs/local-shops-prep.md L5-L22, L51, L52 and the lane's dated D1-D11
 * defaults). The fast half of the proof, read from the NEWEST definitions the
 * migrations leave (effectiveDefs), so a later restatement that drops a gate
 * fails here:
 *
 *   1. Every client-callable item RPC starts with require_feature('shops'),
 *      names is_caller_banned() and (owner writes) runs the owner gate.
 *   2. Publish keeps every gate: order days, 3 photos, the confirmations, the
 *      home-food yearly confirmation and limit, and the admin-review rule
 *      (first 3 items, AI unchecked/flagged, word check).
 *   3. 'rental' is reserved, never listable; no permit-food, plant, children's
 *      or skin-product type exists (L6, L11, L12, L14, D1, D11).
 *   4. The type list and the confirmations agree between SQL and the app.
 *   5. Internal helpers are not client-callable; the AI verdict is service-role only.
 *   6. Download My Data has every shop section.
 *   7. The AI answer fails closed; the edge function gates shop items on 'shops'.
 *   9. An admin's decision covers the submission the admin saw (item_changed),
 *      and new or removed photos drop the approval (lh-authz-rls re-review N1, N3).
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsItems.pglite.mjs
 * (156 PASS on the migration, 3x replay; NEW_MIGRATION=skip 0 PASS / 156 FAIL;
 * 9 planted defects each caught, measured 2026-10-16; the N1, N3 and
 * contact-copy steps red on their planted defects, measured 2026-10-17).
 */
// @mutate supabase/migrations/20261017060556_shops_items.sql | BEGIN\n  PERFORM public.require_feature('shops');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  v_uid := public.shops_assert_owner_eligible();\n  SELECT * INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE; | BEGIN\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  v_uid := public.shops_assert_owner_eligible();\n  SELECT * INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
// @mutate supabase/migrations/20261017060556_shops_items.sql |     WHEN v_approved < 3 THEN 'pending_review' |     WHEN v_approved < 0 THEN 'pending_review'
// @mutate supabase/migrations/20261017060556_shops_items.sql |     WHEN v_text_flag IS NOT NULL THEN 'pending_review'\n | \n
// @mutate supabase/migrations/20261017060556_shops_items.sql |     WHEN v_priv.admin_rejected_at IS NOT NULL THEN 'pending_review'\n | \n
// @mutate supabase/migrations/20261017060556_shops_items.sql |     IF public.shop_cottage_cap_reached(v_uid) THEN | IF false THEN
// @mutate supabase/migrations/20261017060556_shops_items.sql |   IF v_photos < 3 OR v_photos > 12 THEN | IF v_photos < 1 OR v_photos > 12 THEN
// @mutate supabase/migrations/20261017060556_shops_items.sql |     WHEN 'home_food' THEN ARRAY['made_in_my_home_kitchen', 'low_risk_no_meat_fish', 'label_says_home_kitchen', | WHEN 'home_food' THEN ARRAY['made_in_my_home_kitchen', 'low_risk_no_meat_fish',
// @mutate supabase/migrations/20261017060556_shops_items.sql |   IF p_kind = 'rental' THEN | IF false THEN
// @mutate supabase/migrations/20261017060556_shops_items.sql | REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261017060556_shops_items.sql |   v_out := v_out \|\| jsonb_build_object('shop_items', | v_out := v_out \|\| jsonb_build_object('shop_items_gone',
// @mutate supabase/migrations/20261017060556_shops_items.sql |   IF v_submitted IS DISTINCT FROM p_submitted_at THEN | IF false THEN
// @mutate supabase/migrations/20261017060556_shops_items.sql |      SET admin_approved_at = NULL\n   WHERE id = (CASE | SET updated_at = updated_at\n   WHERE id = (CASE
// @mutate supabase/migrations/20261017060556_shops_items.sql |   SELECT owner_id, shop_id, kind, submitted_at INTO | SELECT owner_id, shop_id, kind, p_submitted_at INTO
// @mutate supabase/functions/declutter-ai-draft/shopItemSanitize.ts |   const flagged = r.possibly_banned !== false; |   const flagged = r.possibly_banned === true;
// @mutate supabase/functions/declutter-ai-draft/index.ts |   const refused = await requireFeature(admin, shopItem ? "shops" : "declutter", authData.user, corsHeaders); |   const refused = await requireFeature(admin, "declutter", authData.user, corsHeaders);
// @mutate src/lib/shops/items.ts |   if (subtype === "eggs") return ["own_hens", "kept_cold", "no_cracked_dirty", "not_banned"]; |   if (subtype === "eggs") return ["own_hens", "kept_cold", "not_banned"];
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { requiredStatements, SHOP_ITEM_STATEMENTS, SHOP_ITEM_TYPE_LABEL, readinessLabel, formatItemPrice } from "@/lib/shops/items";
import { sanitizeShopItemDraft, SHOP_ITEM_TYPES, type ShopItemKind } from "../../supabase/functions/declutter-ai-draft/shopItemSanitize";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261017060556_shops_items.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const OWNER_RPCS = ["shops_create_item", "shops_update_item", "shops_set_item_stock", "shops_set_daily_order_cap",
  "shops_add_item_photo", "shops_attest_item", "shops_confirm_cottage_year", "shops_publish_item"];
const MEMBER_WRITE_RPCS = ["shops_remove_item_photo", "shops_withdraw_item"];
const READ_RPCS = ["shops_shop_items", "shops_my_item_review", "shops_my_cottage_status"];
const ADMIN_RPCS = ["shops_admin_pending_items", "shops_admin_review_item"];
const INTERNAL = ["shop_owner_sell_block_reason", "shop_item_required_statements", "shop_item_text_flag", "shop_cottage_year", "shop_cottage_sales_cents",
  "shop_cottage_cap_reached", "shops_lock_own_item", "shops_check_item_fields", "shops_record_item_ai_check"];

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

/** The statement arrays of shop_item_required_statements, keyed kind or kind/subtype. */
function sqlStatements(): Map<string, string[]> {
  const b = body("shop_item_required_statements");
  const out = new Map<string, string[]>();
  const arr = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  for (const k of ["made", "home_food"]) {
    const m = new RegExp(String.raw`WHEN '${k}' THEN ARRAY\[([^\]]*)\]`).exec(b);
    out.set(k, m ? arr(m[1]) : []);
  }
  for (const t of ["eggs", "produce"]) {
    const m = new RegExp(String.raw`WHEN '${t}' THEN ARRAY\[([^\]]*)\]`).exec(b);
    out.set(`farm/${t}`, m ? arr(m[1]) : []);
  }
  return out;
}

/** (slug, kind) rows the migration seeds into shop_item_subtypes. */
function sqlSubtypes(): Map<string, string> {
  const ins = /INSERT INTO public\.shop_item_subtypes \(slug, kind, label, position\) VALUES([\s\S]*?)ON CONFLICT/.exec(MIG)?.[1] ?? "";
  return new Map([...ins.matchAll(/\('([a-z_]+)', '([a-z_]+)'/g)].map((m) => [m[1], m[2]]));
}

describe("Shops slice 2: items, hidden and gated (20261017060556)", () => {
  const callable = clientCallable();
  const rpcs = [...OWNER_RPCS, ...MEMBER_WRITE_RPCS, ...READ_RPCS, ...ADMIN_RPCS];

  it("reads a real inventory (floors)", () => {
    expect(DEFS.has("shops_publish_item")).toBe(true);
    // The item RPCs plus slice 1's close, restated here.
    expect([...callable].sort()).toEqual([...rpcs, "shops_close_my_shop"].sort());
    expect(callable.size).toBeGreaterThan(14);
  });

  it("1. every item RPC starts with require_feature('shops'); writes name is_caller_banned(); owner writes run the owner gate", () => {
    expect(rpcs.filter((fn) => !/\bBEGIN\s+PERFORM\s+public\.require_feature\('shops'\);/i.test(body(fn)))).toEqual([]);
    for (const fn of [...OWNER_RPCS, ...MEMBER_WRITE_RPCS, "shops_admin_review_item"]) {
      expect(body(fn), `${fn} must not be STABLE/IMMUTABLE (it writes)`).not.toMatch(/\b(STABLE|IMMUTABLE)\b/i);
      expect(body(fn), `${fn} names is_caller_banned()`).toMatch(/public\.is_caller_banned\(\)/);
    }
    for (const fn of OWNER_RPCS) expect(body(fn), fn).toContain("v_uid := public.shops_assert_owner_eligible();");
    for (const fn of ADMIN_RPCS) expect(flat(body(fn)), fn).toMatch(/NOT public\.has_role\(\(?(SELECT auth\.uid\(\)\)|v_uid), 'admin'::public\.app_role\) THEN RAISE EXCEPTION 'not_admin'/);
    expect(flat(body("shops_admin_review_item"))).toContain("IF v_owner = v_uid THEN RAISE EXCEPTION 'own_item'");
    expect(body("shops_admin_review_item")).toContain("INSERT INTO public.admin_audit_log");
  });

  it("2. publish keeps every gate (L8, L21, L52, D7)", () => {
    const p = flat(body("shops_publish_item"));
    for (const must of [
      "RAISE EXCEPTION 'order_days_required'",
      "IF v_photos < 3 OR v_photos > 12 THEN RAISE EXCEPTION 'photos_required'",
      "RAISE EXCEPTION 'attestation_required'",
      "RAISE EXCEPTION 'cottage_confirmation_required'",
      "IF public.shop_cottage_cap_reached(v_uid) THEN RAISE EXCEPTION 'cottage_cap_reached'",
      "WHEN v_approved < 3 THEN 'pending_review'",
      "WHEN v_priv.admin_rejected_at IS NOT NULL THEN 'pending_review'",
      "WHEN v_priv.ai_checked_at IS NULL OR v_priv.ai_flag_reason IS NOT NULL THEN 'pending_review'",
      "WHEN v_text_flag IS NOT NULL THEN 'pending_review'",
    ]) expect(p).toContain(must);
    // A content edit takes a live item down and clears what was judged (D10).
    const u = flat(body("shops_update_item"));
    expect(u).toContain("status = 'draft'");
    expect(u).toContain("SET ai_checked_at = NULL, ai_flag_reason = NULL, text_flag_reason = NULL");
    expect(u).toContain("DELETE FROM public.shop_item_attestations WHERE item_id = p_item_id");
    expect(u).toContain("UPDATE public.shop_items SET admin_approved_at = NULL WHERE id = p_item_id");
    // A rejection holds every later publish for an admin; only an approval clears it.
    expect(flat(body("shops_admin_review_item"))).toContain("admin_rejected_at = CASE WHEN p_approve THEN NULL ELSE now() END");
  });

  it("3. rental is reserved, never listable; the not-at-launch things have no type", () => {
    expect(MIG).toMatch(/kind text NOT NULL CHECK \(kind IN \('made', 'home_food', 'farm', 'rental'\)\)/);
    expect(flat(body("shops_check_item_fields"))).toContain("IF p_kind = 'rental' THEN RAISE EXCEPTION 'rental_not_available'");
    const subs = sqlSubtypes();
    expect(subs.size).toBe(17);
    expect([...subs.values()]).not.toContain("rental");
    for (const never of ["soap", "lotion", "plants", "seedlings", "toys", "baby", "plate_lunch", "gumbo", "boudin", "seafood"]) {
      expect(subs.has(never), never).toBe(false);
    }
  });

  it("4. the type list and the confirmations agree between SQL and the app (both ways)", () => {
    const subs = sqlSubtypes();
    const app = new Map((Object.keys(SHOP_ITEM_TYPES) as ShopItemKind[]).flatMap((k) => SHOP_ITEM_TYPES[k].map((t) => [t, k] as [string, string])));
    expect([...app].sort()).toEqual([...subs].sort());
    for (const t of subs.keys()) expect(SHOP_ITEM_TYPE_LABEL[t], t).toBeTruthy();
    const sql = sqlStatements();
    expect(sql.get("home_food")).toContain("label_says_home_kitchen");
    expect(requiredStatements("made", "candles")).toEqual(sql.get("made"));
    expect(requiredStatements("home_food", "honey")).toEqual(sql.get("home_food"));
    expect(requiredStatements("farm", "eggs")).toEqual(sql.get("farm/eggs"));
    expect(requiredStatements("farm", "produce")).toEqual(sql.get("farm/produce"));
    const used = new Set([...sql.values()].flat());
    expect(used.size).toBeGreaterThan(12);
    expect(Object.keys(SHOP_ITEM_STATEMENTS).sort()).toEqual([...used].sort());
  });

  it("5. internal helpers are not client-callable; the AI verdict is service-role only", () => {
    for (const fn of INTERNAL) {
      expect(MIG, `${fn} is revoked from authenticated`).toMatch(
        new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.${fn}\([^)]*\) FROM PUBLIC, anon, authenticated;`),
      );
      expect(callable.has(fn), fn).toBe(false);
    }
    expect(MIG).not.toMatch(/GRANT[^;]*ON TABLE public\.shop_item_private TO authenticated/i);
    expect(MIG).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE public\.shop_\w+ TO authenticated/i);
  });

  it("6. Download My Data has every shop section, staff ids and check reasons dropped", () => {
    const ex = flat(body("export_my_data"));
    for (const t of ["shops", "shop_photos", "shop_follows", "shop_items", "shop_item_private", "shop_item_photos",
      "shop_item_attestations", "shop_cottage_confirmations", "shop_cottage_sales"]) {
      expect(ex, t).toContain(`jsonb_build_object('${t}',`);
    }
    expect(ex).toContain("to_jsonb(t) - 'sos_verified_by' - 'hidden_by'");
    expect(ex).toContain("to_jsonb(t) - 'ai_flag_reason' - 'text_flag_reason'");
    // Still the reconciled body: Declutter and Suggest-a-category sections stay.
    expect(ex).toContain("jsonb_build_object('declutter_reviews',");
    expect(ex).toContain("jsonb_build_object('category_suggestions',");
  });

  it("7. the AI answer fails closed; the edge function gates shop items on 'shops'", () => {
    expect(sanitizeShopItemDraft({ title: "Fig jam" })!.flagged).toBe(true);
    expect(sanitizeShopItemDraft({ title: "Fig jam", kind: "home_food", subtype: "gumbo", possibly_banned: false })).toMatchObject({
      kind: "home_food", subtype: "baked_goods", flagged: false,
    });
    expect(sanitizeShopItemDraft({ title: "Fig jam", kind: "rental", subtype: "jams_jellies", possibly_banned: false })).toMatchObject({
      kind: "made", subtype: "crafts",
    });
    expect(sanitizeShopItemDraft({ title: "x" })).toBeNull();
    const edge = blankComments(readFileSync(join(ROOT, "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
    expect(edge).toContain('const refused = await requireFeature(admin, shopItem ? "shops" : "declutter", authData.user, corsHeaders);');
    expect(edge).toContain('admin.rpc("shops_record_item_ai_check"');
    expect(edge).toMatch(/from\("shop_items"\)[\s\S]{0,120}\.eq\("owner_id", userId\)\.eq\("status", "draft"\)/);
  });

  it("8. the app's words for an item's readiness and price", () => {
    expect(readinessLabel({ stock_count: 6, lead_time_days: 2 })).toBe("Ready now (6 left)");
    expect(readinessLabel({ stock_count: 0, lead_time_days: 2 })).toBe("Sold out for now");
    expect(readinessLabel({ stock_count: null, lead_time_days: 0 })).toBe("Ready the same day");
    expect(readinessLabel({ stock_count: null, lead_time_days: 1 })).toBe("Ready in 1 day");
    expect(formatItemPrice(1800)).toBe("$18");
    expect(formatItemPrice(1850)).toBe("$18.50");
  });

  it("9. an admin's decision and approval cover what the admin saw (lh-authz-rls re-review N1, N3)", () => {
    // N1: the decision names the submission the queue showed.
    expect(flat(body("shops_admin_pending_items"))).toMatch(/submitted_at timestamptz,[\s\S]*i\.submitted_at, p\.ai_checked_at/);
    const r = flat(body("shops_admin_review_item"));
    expect(r).toMatch(/shops_admin_review_item\(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamptz\)/);
    expect(r).toContain("SELECT owner_id, shop_id, kind, submitted_at INTO v_owner, v_shop, v_kind, v_submitted FROM public.shop_items WHERE id = p_item_id AND status = 'pending_review' FOR UPDATE");
    expect(r).toContain("IF v_submitted IS DISTINCT FROM p_submitted_at THEN RAISE EXCEPTION 'item_changed'");
    // N3: new or removed photos drop the approval, as a word edit does.
    expect(flat(body("shop_item_photos_void_ai_check"))).toMatch(/UPDATE public\.shop_items SET admin_approved_at = NULL WHERE id = \(CASE WHEN TG_OP = 'DELETE' THEN OLD\.item_id ELSE NEW\.item_id END\)/);
    // The contact-leak refusals no longer point at a Message button (the Shops Message button item in docs/OPEN.md).
    for (const fn of ["reject_contact_leak_in_shop_item", "reject_contact_leak_in_shop"]) {
      expect(body(fn), fn).toContain("does not allow contact details in Shops.");
      expect(body(fn), fn).not.toMatch(/Message button/);
    }
  });
});
