/**
 * Shops slice 2: items (20261017061157_shops_items; owner decisions in
 * docs/specs/local-shops-prep.md L5-L22, L51, L52 and the lane's dated D1-D11
 * defaults). The fast half of the proof, read from the NEWEST definitions the
 * migrations leave (effectiveDefs), so a later restatement that drops a gate
 * fails here:
 *
 *   1. Every client-callable item RPC starts with require_feature('shops'),
 *      names is_caller_banned() and (owner writes) runs the owner gate.
 *   2. Publish keeps every gate: order days, 3 photos, the confirmations, the
 *      home-food yearly confirmation and limit, and the admin-review rule
 *      (a rejection or the 30-day hold, an AI flag, a word-check hit; no
 *      first-3 hold and an unanswered AI check fails open since H3,
 *      20261105173912, proved in pglite/shopsItemsLiveAtOnce.pglite.mjs).
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
// @mutate supabase/migrations/20261103124851_money_free_switch_handovers_shop_item_not_found_is_404.sql | BEGIN\n  PERFORM public.require_feature('shops');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  v_uid := public.shops_assert_owner_eligible();\n  SELECT * INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE; | BEGIN\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  v_uid := public.shops_assert_owner_eligible();\n  SELECT * INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
// @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |     WHEN v_priv.ai_checked_at IS NOT NULL AND v_priv.ai_flag_reason IS NOT NULL THEN 'pending_review' |     WHEN v_priv.ai_checked_at IS NULL OR v_priv.ai_flag_reason IS NOT NULL THEN 'pending_review'
// @mutate supabase/migrations/20261105173912_shops_items_live_at_once.sql |   IF v_item.status = 'live'\n | IF false\n
// @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |     WHEN v_text_flag IS NOT NULL THEN 'pending_review'\n | \n
// @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |     WHEN v_priv.admin_rejected_at IS NOT NULL THEN 'pending_review'\n | \n
// @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |     WHEN v_recent_rejection THEN 'pending_review'\n | \n
// @mutate supabase/migrations/20261112194629_shops_owner_review_notices.sql | jsonb_build_object('note', v_note, 'owner_id', v_owner, 'shop_id', v_shop)); | jsonb_build_object('note', v_note));
// @mutate supabase/migrations/20261112194629_shops_owner_review_notices.sql |            rj.created_at, rj.details->>'note', |            NULL::timestamptz, NULL::text,
// @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |     IF public.shop_cottage_cap_reached(v_uid) THEN | IF false THEN
// @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |   IF v_photos < 3 OR v_photos > 12 THEN | IF v_photos < 1 OR v_photos > 12 THEN
// @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |     WHEN 'home_food' THEN ARRAY['made_in_my_home_kitchen', 'low_risk_no_meat_fish', 'label_says_home_kitchen', | WHEN 'home_food' THEN ARRAY['made_in_my_home_kitchen', 'low_risk_no_meat_fish',
// @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |   IF p_kind IS NULL OR p_kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental', 'digital') THEN |   IF p_kind IS NULL OR p_kind NOT IN ('made', 'home_food', 'farm', 'service', 'digital') THEN
// @mutate supabase/migrations/20261017061157_shops_items.sql | REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261112081700_shops_export_rest.sql |   v_out := v_out \|\| jsonb_build_object('shop_items', | v_out := v_out \|\| jsonb_build_object('shop_items_gone',
// @mutate supabase/migrations/20261112194629_shops_owner_review_notices.sql |   IF v_submitted IS DISTINCT FROM p_submitted_at THEN | IF false THEN
// @mutate supabase/migrations/20261017061157_shops_items.sql |      SET admin_approved_at = NULL\n   WHERE id = (CASE | SET updated_at = updated_at\n   WHERE id = (CASE
// @mutate supabase/migrations/20261112194629_shops_owner_review_notices.sql |   SELECT owner_id, shop_id, kind, submitted_at, title INTO | SELECT owner_id, shop_id, kind, p_submitted_at, title INTO
// @mutate supabase/functions/declutter-ai-draft/shopItemSanitize.ts |   const flagged = r.possibly_banned !== false; |   const flagged = r.possibly_banned === true;
// @mutate supabase/functions/declutter-ai-draft/index.ts |   const refused = await requireFeature(admin, shopItem ? "shops" : "declutter", authData.user, corsHeaders); |   const refused = await requireFeature(admin, "declutter", authData.user, corsHeaders);
// @mutate src/lib/shops/items.ts |   if (subtype === "eggs") return ["own_hens", "kept_cold", "no_cracked_dirty", "not_banned"]; |   if (subtype === "eggs") return ["own_hens", "kept_cold", "not_banned"];
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { formatCents } from "@/lib/shops/formatCents";
import { requiredStatements, SHOP_ITEM_STATEMENTS, SHOP_ITEM_TYPE_LABEL, readinessLabel, formatItemPrice } from "@/lib/shops/items";
import { sanitizeShopItemDraft, SHOP_ITEM_TYPES, type ShopItemKind } from "../../supabase/functions/declutter-ai-draft/shopItemSanitize";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261017061157_shops_items.sql";
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
  for (const k of ["made", "home_food", "service", "rental", "digital"]) {
    const m = new RegExp(String.raw`WHEN '${k}' THEN ARRAY\[([^\]]*)\]`).exec(b);
    out.set(k, m ? arr(m[1]) : []);
  }
  for (const t of ["eggs", "produce"]) {
    const m = new RegExp(String.raw`WHEN '${t}' THEN ARRAY\[([^\]]*)\]`).exec(b);
    out.set(`farm/${t}`, m ? arr(m[1]) : []);
  }
  return out;
}

/** (slug, kind) rows seeded into shop_item_subtypes: slice 2's, plus Shops H8's services and rentals (20261105235833). */
const H8 = blankSqlComments(readFileSync(join(MIG_DIR, "20261105235833_shops_every_category_sells.sql"), "utf8"));
// Digital downloads (20261108182917): the five digital types.
const DIGITAL = blankSqlComments(readFileSync(join(MIG_DIR, "20261108182917_shops_digital_downloads.sql"), "utf8"));
function sqlSubtypes(): Map<string, string> {
  const rows = [MIG, H8, DIGITAL].flatMap((sql) => {
    const ins = /INSERT INTO public\.shop_item_subtypes \(slug, kind, label, position(?:, tax_kind)?\) VALUES([\s\S]*?)ON CONFLICT/.exec(sql)?.[1] ?? "";
    return [...ins.matchAll(/\('([a-z_]+)', '([a-z_]+)'/g)].map((m) => [m[1], m[2]] as [string, string]);
  });
  return new Map(rows);
}

describe("Shops slice 2: items, hidden and gated (20261017061157)", () => {
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
      "WHEN v_priv.admin_rejected_at IS NOT NULL THEN 'pending_review'",
      // Owner 2026-11-05 (answer 2, H3): live at once when the automatic checks
      // pass; an AI check that never answered fails open to the word check.
      "WHEN v_priv.ai_checked_at IS NOT NULL AND v_priv.ai_flag_reason IS NOT NULL THEN 'pending_review'",
      "WHEN v_text_flag IS NOT NULL THEN 'pending_review'",
      // Hold after a rejection (owner 2026-10-17): 30 days of every publish
      // waiting for an admin, read from the log the owner cannot write.
      "WHEN v_recent_rejection THEN 'pending_review'",
      "WHERE l.action = 'shop_item_rejected' AND l.details->>'owner_id' = v_uid::text AND l.created_at > now() - interval '30 days'",
    ]) expect(p).toContain(must);
    // No first-3 admin hold (owner 2026-11-05, answer 2): nothing counts approvals.
    expect(p).not.toMatch(/admin_approved_at|v_approved/);
    expect(flat(body("shops_admin_review_item"))).toContain("jsonb_build_object('note', v_note, 'owner_id', v_owner, 'shop_id', v_shop)");
    // The admin sees why a held item waits: the owner's last rejection (lh-silent-failure finding 1).
    const q = flat(body("shops_admin_pending_items"));
    expect(q).toContain("owner_last_rejected_at timestamptz, owner_last_rejection_note text");
    expect(q).toContain("rj.created_at, rj.details->>'note'");
    expect(q).toContain("WHERE l.action = 'shop_item_rejected' AND l.details->>'owner_id' = i.owner_id::text");
    // A live item's edit that keeps its kind and type stays live (owner
    // 2026-11-05, answer 2); new words re-run the word check and the 30-day
    // hold. Any other content edit makes it a draft and clears what was judged (D10).
    const u = flat(body("shops_update_item"));
    expect(u).toContain("IF v_item.status = 'live' AND v_item.kind IS NOT DISTINCT FROM p_kind AND v_item.subtype IS NOT DISTINCT FROM p_subtype THEN v_status := 'live';");
    expect(u).toContain("IF v_text_flag IS NOT NULL OR EXISTS ( SELECT 1 FROM public.admin_audit_log l WHERE l.action = 'shop_item_rejected' AND l.details->>'owner_id' = v_uid::text AND l.created_at > now() - interval '30 days') THEN v_status := 'pending_review';");
    expect(u).toContain("status = 'draft'");
    expect(u).toContain("SET ai_checked_at = NULL, ai_flag_reason = NULL, text_flag_reason = NULL");
    expect(u).toContain("DELETE FROM public.shop_item_attestations WHERE item_id = p_item_id");
    expect(u).toContain("UPDATE public.shop_items SET admin_approved_at = NULL WHERE id = p_item_id");
    // A rejection holds every later publish for an admin; only an approval clears it.
    expect(flat(body("shops_admin_review_item"))).toContain("admin_rejected_at = CASE WHEN p_approve THEN NULL ELSE now() END");
  });

  it("3. services and rentals sell (owner 11-05, H8); the not-at-launch things have no type", () => {
    expect(MIG).toMatch(/kind text NOT NULL CHECK \(kind IN \('made', 'home_food', 'farm', 'rental'\)\)/);
    // Owner 11-05 answer 1 (20261105235833): rental_not_available is gone; the five kinds sell.
    expect(flat(body("shops_check_item_fields"))).not.toContain("rental_not_available");
    expect(flat(body("shops_check_item_fields"))).toContain("p_kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental'");
    const subs = sqlSubtypes();
    // 17 slice-2 types + 13 service + 2 rental types (H8, 2026-11-05) + 5 digital types (20261108182917, 2026-11-08).
    expect(subs.size).toBe(37);
    expect([...subs.values()].filter((k) => k === "digital").length).toBe(5);
    expect([...subs.values()].filter((k) => k === "rental").length).toBe(2);
    for (const inflatable of ["bounce_houses", "bounce_house", "inflatables", "water_slides"]) expect(subs.has(inflatable), inflatable).toBe(false);
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
    expect(requiredStatements("service", "lessons")).toEqual(sql.get("service"));
    expect(requiredStatements("rental", "party_rental")).toEqual(sql.get("rental"));
    expect(requiredStatements("digital", "digital_coloring")).toEqual(sql.get("digital"));
    expect(sql.get("rental")).toContain("not_inflatable");
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
    // A kind the model may answer that no table admits: an untrusted AI answer, not a shop_items row
    // (fixtureSchemaContract lists this draft shape under NOT_ROWS).
    expect(sanitizeShopItemDraft({ title: "Fig jam", kind: "auction", subtype: "jams_jellies", possibly_banned: false })).toMatchObject({
      kind: "made", subtype: "crafts",
    });
    expect(sanitizeShopItemDraft({ title: "x" })).toBeNull();
    const edge = blankComments(readFileSync(join(ROOT, "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
    expect(edge).toContain('const refused = await requireFeature(admin, shopItem ? "shops" : "declutter", authData.user, corsHeaders);');
    expect(edge).toContain('admin.rpc("shops_record_item_ai_check"');
    // S009 (11-12): a `check` may also judge the owner's LIVE item; a draft request still reads only a draft.
    expect(edge).toMatch(/from\("shop_items"\)[\s\S]{0,120}\.eq\("owner_id", userId\)\.in\("status", mode === "check" \? \["draft", "live"\] : \["draft"\]\)/);
    // Fail closed: a model error, an unparsable answer or an unreadable photo records NO verdict.
    expect(edge).toMatch(/if \(!answer\.ok\) \{[\s\S]{0,200}return json\(\{ error: "ai_unavailable" \}/);
    expect(edge).toContain('if (!shopDraft) return json({ error: "ai_unavailable" }, 502);');
    expect(edge).toMatch(/if \(mode === "check"\) return json\(\{ error: "ai_unavailable" \}, 502\);/);
  });

  it("8. the app's words for an item's readiness and price", () => {
    expect(readinessLabel({ stock_count: 6, lead_time_days: 2 })).toBe("Ready now (6 left)");
    expect(readinessLabel({ stock_count: 0, lead_time_days: 2 })).toBe("Sold out for now");
    expect(readinessLabel({ stock_count: null, lead_time_days: 0 })).toBe("Ready the same day");
    expect(readinessLabel({ stock_count: null, lead_time_days: 1 })).toBe("Ready in 1 day");
    expect(formatItemPrice(1800)).toBe("$18");
    expect(formatItemPrice(1850)).toBe("$18.50");
    // S027 (Shops audit 11-12): thousands get a comma, as everywhere else in the app.
    expect(formatItemPrice(500000)).toBe("$5,000");
    expect(formatItemPrice(123450)).toBe("$1,234.50");
    expect(formatCents(500000)).toBe("$5,000.00");
    expect(formatCents(1250)).toBe("$12.50");
  });

  it("9. an admin's decision and approval cover what the admin saw (lh-authz-rls re-review N1, N3)", () => {
    // N1: the decision names the submission the queue showed.
    expect(flat(body("shops_admin_pending_items"))).toMatch(/submitted_at timestamptz,[\s\S]*i\.submitted_at, p\.ai_checked_at/);
    const r = flat(body("shops_admin_review_item"));
    expect(r).toMatch(/shops_admin_review_item\(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamptz\)/);
    expect(r).toContain("SELECT owner_id, shop_id, kind, submitted_at, title INTO v_owner, v_shop, v_kind, v_submitted, v_title FROM public.shop_items WHERE id = p_item_id AND status = 'pending_review' FOR UPDATE");
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
