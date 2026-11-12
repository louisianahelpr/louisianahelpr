/**
 * Shops slice 1 (20261017061155_shops_profiles; owner decisions in
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
// @mutate supabase/migrations/20261017061155_shops_profiles.sql | BEGIN\n  PERFORM public.require_feature('shops');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  v_uid := public.shops_assert_owner_eligible();\n\n  IF p_name | BEGIN\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  v_uid := public.shops_assert_owner_eligible();\n\n  IF p_name
// @mutate supabase/migrations/20261027163240_payout_setup_only_when_owed.sql |   IF public.member_under_18(v_uid) THEN\n    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to have a shop.'; |   IF false THEN\n    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to have a shop.';
// @mutate supabase/migrations/20261027163240_payout_setup_only_when_owed.sql |   IF public.shop_active_strike_count(v_uid) >= 3 THEN\n    RAISE EXCEPTION 'shop_strikes_blocked'\n      USING | IF public.shop_active_strike_count(v_uid) >= 4 THEN\n    RAISE EXCEPTION 'shop_strikes_blocked'\n      USING
// @mutate supabase/migrations/20261027163240_payout_setup_only_when_owed.sql |   IF public.shop_active_strike_count(v_uid) >= 3 THEN\n    RAISE EXCEPTION 'shop_strikes_blocked'\n      USING | IF public.declutter_active_strike_count(v_uid) >= 3 THEN\n    RAISE EXCEPTION 'shop_strikes_blocked'\n      USING
// @mutate supabase/migrations/20261027163240_payout_setup_only_when_owed.sql |   -- L3 (payout setup before opening) is dropped: owner 2026-10-27, the same |   PERFORM public.helper_award_block_reason(v_uid); -- L3 dropped: owner 2026-10-27, the same
// @mutate supabase/migrations/20261017061155_shops_profiles.sql | VALUES ('shops', 'off', | VALUES ('shops', 'testers',
// @mutate supabase/migrations/20261103083559_shops_declutter_owner_actions_not_found_is_404.sql | IF EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid AND hidden_at IS NOT NULL) THEN | IF false THEN
// @mutate supabase/migrations/20261017061155_shops_profiles.sql | REVOKE ALL ON FUNCTION public.shops_assert_owner_eligible() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shops_assert_owner_eligible() FROM PUBLIC, anon;
// @mutate src/lib/shops/errors.ts |   invalid_hours: "Each time needs a day, and an opening time before its closing time.",\n | \n
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { SHOPS_ERROR_COPY } from "@/lib/shops/errors";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261017061155_shops_profiles.sql";
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

describe("Shops slice 1: hidden, gated, no contact details (20261017061155)", () => {
  const callable = clientCallable();
  const rpcs = [...OWNER_RPCS, ...MEMBER_WRITE_RPCS, ...READ_RPCS, ...ADMIN_RPCS];

  it("reads a real inventory (floors)", () => {
    expect(DEFS.has("shops_save_my_shop")).toBe(true);
    // The RPCs plus the standing helper the shops read policy calls.
    expect([...callable].sort()).toEqual([...rpcs, "shop_publicly_visible"].sort());
    expect(callable.size).toBeGreaterThan(12);
  });

  it("1. every client-callable shops_* RPC starts with require_feature('shops'); the admin RPCs only for a non-admin", () => {
    const missing = rpcs.filter((fn) => !ADMIN_RPCS.includes(fn) && !/\bBEGIN\s+PERFORM\s+public\.require_feature\('shops'\);/i.test(body(fn)));
    expect(missing).toEqual([]);
    // Q1952 (lh-authz-rls review of d439419a1 note 2, 20261110195956): an admin skips the switch, so a switch set
    // back to off never stops an admin hiding a shop; a non-admin still meets require_feature, then not_admin.
    for (const fn of ADMIN_RPCS) {
      expect(flat(body(fn)), fn).toMatch(
        /BEGIN IF v_uid IS NULL OR NOT public\.has_role\(v_uid, 'admin'\) THEN PERFORM public\.require_feature\('shops'\); RAISE EXCEPTION 'not_admin'/,
      );
    }
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
      // Per section (owner 2026-10-18): Shops' own strikes, never Declutter's.
      "IF public.shop_active_strike_count(v_uid) >= 3 THEN RAISE EXCEPTION 'shop_strikes_blocked'",
    ]) expect(gate).toContain(must);
    // L3 dropped (owner 2026-10-27): opening a shop needs no payout account.
    expect(gate).not.toContain("helper_award_block_reason");
    expect(flat(body("shops_close_my_shop"))).toContain(
      "IF EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid AND hidden_at IS NOT NULL) THEN RAISE EXCEPTION 'shop_hidden'",
    );
    for (const fn of ADMIN_RPCS) {
      expect(flat(body(fn)), fn).toContain("IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN PERFORM public.require_feature('shops'); RAISE EXCEPTION 'not_admin'");
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

  it("6. SHOPS_ERROR_COPY is exact against the codes the shops migrations raise (slice 1 + slice 2 items + M1 orders + M1b pickup address + M2 handover + the ready-tap choice + SH12 FAQs + M3 refunds)", () => {
    const ITEMS = blankSqlComments(readFileSync(join(MIG_DIR, "20261017061157_shops_items.sql"), "utf8"));
    const ORDERS = blankSqlComments(readFileSync(join(MIG_DIR, "20261018164442_shops_orders_checkout.sql"), "utf8"));
    const PICKUP = blankSqlComments(readFileSync(join(MIG_DIR, "20261018210400_shops_pickup_address.sql"), "utf8"));
    const HANDOVER = blankSqlComments(readFileSync(join(MIG_DIR, "20261018211820_shops_handover_payout.sql"), "utf8"));
    const READY_TAP = blankSqlComments(readFileSync(join(MIG_DIR, "20261019015018_shop_ready_tap_cancel_choice.sql"), "utf8"));
    const FAQS = blankSqlComments(readFileSync(join(MIG_DIR, "20261019072541_shops_faqs.sql"), "utf8"));
    const REFUNDS = blankSqlComments(readFileSync(join(MIG_DIR, "20261019071055_shops_refunds_cancels_strikes.sql"), "utf8"));
    // Shops H5 (20261105182903): the seller's "Handed over" tap (porch_uses_photo, not_ready_date_yet).
    const HANDOVER_RULE = blankSqlComments(readFileSync(join(MIG_DIR, "20261105182903_shops_handover_rule.sql"), "utf8"));
    // Shops H1 chats (20261105185006): the chat codes are SHOPS_ERROR_COPY's too (lander, train l92). Q1947's
    // 20261105225245 is left out: it restates the shared reports trigger (report_* codes are the ReportDialog's, not
    // SHOPS_ERROR_COPY's), and its shops_open_order_talk raises only codes the files here already raise.
    const TALK = blankSqlComments(readFileSync(join(MIG_DIR, "20261105185006_shops_talk.sql"), "utf8"));
    // Shops H9 reviews (20261105230819).
    const REVIEWS = blankSqlComments(readFileSync(join(MIG_DIR, "20261105230819_shops_reviews_and_rating.sql"), "utf8"));
    // Shops variants (20261106165310).
    const VARIANTS = blankSqlComments(readFileSync(join(MIG_DIR, "20261106165310_shops_item_variants.sql"), "utf8"));
    // Shops H8 at-home cleaning (20261106164313) and Louisiana-only pickup ZIPs (20261106180540).
    const AT_BUYER = blankSqlComments(readFileSync(join(MIG_DIR, "20261106164313_shops_service_at_buyer.sql"), "utf8"));
    const PICKUP_ZIP = blankSqlComments(readFileSync(join(MIG_DIR, "20261106180540_shops_pickup_zip_louisiana_only.sql"), "utf8"));
    // Shops delivery (20261106180902).
    const DELIVERY = blankSqlComments(readFileSync(join(MIG_DIR, "20261106180902_shops_delivery.sql"), "utf8"));
    // Shops custom orders: requests (20261106202917), the shop's price and the buyer's order (20261106205852), the
    // deposit plan (20261106212437, 20261106215722, 20261106221300).
    const CUSTOM = ["20261106202917_shops_custom_requests.sql", "20261106205852_shops_custom_order_accept.sql",
      "20261106212437_shops_custom_deposit_split.sql", "20261106215722_shops_custom_deposit_balance.sql",
      "20261106221300_shops_custom_balance_edge.sql"].map((f) => blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"))).join("\n");
    // Shops preorders (20261108184654): the shop's settings, the buyer's preorder and cancel, the two guards.
    const PREORDERS = blankSqlComments(readFileSync(join(MIG_DIR, "20261108184654_shops_preorders.sql"), "utf8"));
    // Digital downloads: files and the download rule (20261108182917), buying one (20261108185110).
    const DIGITAL = ["20261108182917_shops_digital_downloads.sql", "20261108185110_shops_digital_checkout.sql"]
      .map((f) => blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"))).join("\n");
    const raised = new Set([...(MIG + ITEMS + ORDERS + PICKUP + HANDOVER + READY_TAP + FAQS + REFUNDS + HANDOVER_RULE + TALK + REVIEWS + VARIANTS + AT_BUYER + PICKUP_ZIP + DELIVERY + CUSTOM + PREORDERS + DIGITAL).matchAll(/RAISE EXCEPTION '([a-z0-9_]+)'/g)].map((m) => m[1]));
    raised.add("feature_disabled"); // require_feature's code
    // A buyer's under_18 (shops_send_custom_request, shops_request_order) has its own words: SHOPS_RPC_ERROR_COPY maps
    // under_18 -> under_18_to_order for those calls, so the key is a word set, not a raised code.
    raised.add("under_18_to_order");
    // The shop owner's custom_orders_off (shops_quote_custom_request) has its own words too.
    raised.add("custom_orders_off_shop");
    // shop-checkout's own answer when Stripe refuses the pickup address (M1b part 2), not a SQL code.
    const CHECKOUT = readFileSync(join(process.cwd(), "supabase/functions/shop-checkout/index.ts"), "utf8");
    expect(CHECKOUT).toMatch(/error: atHome \? "service_address_unusable" : "pickup_address_unusable"/);
    raised.add("pickup_address_unusable");
    raised.add("service_address_unusable");
    // H8: shop-checkout's own checks of the at-home address, before the order freezes.
    // Restack (l106 + delivery): an at-home order asks for no delivery (at_buyer_no_delivery), checked there too.
    for (const code of ["service_address_needed", "invalid_service_address", "at_buyer_no_delivery"]) {
      expect(CHECKOUT).toContain(`error: "${code}"`);
      raised.add(code);
    }
    // Helpr delivery (20261106194913) and the shop's "the Helpr didn't come" (20261106211136): only the codes a shop
    // member meets through the Shops screens (those migrations also raise service-only codes with no member copy).
    const HELPR_FILES: Record<string, string[]> = {
      "20261106194913_shops_helpr_delivery.sql": ["shop_no_helpr_delivery", "pickup_point_missing", "invalid_choice"],
      "20261106211136_shops_report_helpr_no_show.sql": ["not_a_helpr_delivery", "no_helpr_booked", "already_handed_over", "too_early"],
      // Half up front is closed (shops audit 11-10 F15): shops_set_custom_orders refuses 'deposit_50'.
      "20261108195900_shops_deposit_hidden_pickup_private.sql": ["deposit_orders_closed"],
      // Shops audit 11-12 Highs: S004 (no buyer no-show on a Helpr delivery) and S002 ("I got it" waits for ready).
      "20261112073633_shops_audit_highs.sql": ["helpr_delivery_no_show", "not_ready_yet"],
    };
    for (const [file, codes] of Object.entries(HELPR_FILES)) {
      const sql = blankSqlComments(readFileSync(join(MIG_DIR, file), "utf8"));
      for (const code of codes) {
        expect(sql).toContain(`RAISE EXCEPTION '${code}'`);
        raised.add(code);
      }
    }
    expect(raised.size).toBeGreaterThan(20);
    expect([...raised].filter((c) => !(c in SHOPS_ERROR_COPY)).sort()).toEqual([]);
    expect(Object.keys(SHOPS_ERROR_COPY).filter((c) => !raised.has(c)).sort()).toEqual([]);
  });
});
