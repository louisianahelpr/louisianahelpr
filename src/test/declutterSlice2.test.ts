/**
 * Declutter slice 2 (20261014200728_declutter_slice2_followups; owner decisions
 * and build decisions B5, B8, B9, B16, B18-B21 in docs/specs/declutter-auctions.md).
 * The fast half of the proof, read from the NEWEST definitions the migrations
 * leave (effectiveDefs), so a later restatement that drops a gate fails here.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/declutterSlice2.pglite.mjs
 * (66 PASS; NEW_MIGRATION=skip 52 FAIL; 19 planted defects each caught,
 * measured 2026-10-14).
 *
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |     WHEN v_ai_checked IS NULL OR v_ai_flag IS NOT NULL THEN 'pending_review'\n | \n
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |     AND NOT EXISTS (SELECT 1 FROM public.declutter_item_photos p WHERE p.storage_path = objects.name)\n | \n
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |     AND (storage.foldername(name))[2] = 'declutter'\n | \n
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |   IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN | IF false THEN
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql | REVOKE ALL ON FUNCTION public.declutter_area_label_problem(text, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_area_label_problem(text, text) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql | AFTER INSERT OR DELETE ON public.declutter_item_photos | AFTER INSERT ON public.declutter_item_photos
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |   IF v_seller = v_uid THEN | IF false THEN
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |        OR public.declutter_active_strike_count(v_seller) >= 3 |        OR false
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |     OR v_item.category IS DISTINCT FROM p_category THEN\n    UPDATE public.declutter_item_private\n       SET ai_checked_at = NULL | OR v_item.category IS DISTINCT FROM p_category THEN\n    UPDATE public.declutter_item_private\n       SET ai_checked_at = ai_checked_at
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |     RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001'; |     NULL;
 * @mutate supabase/migrations/20261014200728_declutter_slice2_followups.sql |     NEW.is_seed := true;\n  END IF;\n  RETURN NEW;\nEND;\n$fn$;\nREVOKE ALL ON FUNCTION public.declutter_items_seed_from_seller | \n  END IF;\n  RETURN NEW;\nEND;\n$fn$;\nREVOKE ALL ON FUNCTION public.declutter_items_seed_from_seller
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261014200728_declutter_slice2_followups.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const NEW_CLIENT_RPCS = [
  "declutter_update_draft",
  "declutter_withdraw_item",
  "declutter_admin_pending_items",
  "declutter_admin_review_item",
  "declutter_my_item_review",
];
const WRITE_RPCS = ["declutter_update_draft", "declutter_withdraw_item", "declutter_admin_review_item"];
const INTERNAL = ["declutter_area_label_problem", "declutter_items_seed_from_seller", "declutter_photos_void_ai_check", "declutter_record_ai_check"];

describe("Declutter slice 2: follow-ups behind the switch (20261014200728)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of [...NEW_CLIENT_RPCS, ...INTERNAL]) expect(body(fn), fn).not.toBe("");
    expect(MIG.length).toBeGreaterThan(10_000);
  });

  it("every new client RPC starts with require_feature('declutter'); every write names is_caller_banned()", () => {
    for (const fn of NEW_CLIENT_RPCS) expect(body(fn), fn).toMatch(/\bBEGIN\s+PERFORM\s+public\.require_feature\('declutter'\);/);
    for (const fn of WRITE_RPCS) expect(body(fn), fn).toMatch(/public\.is_caller_banned\(\)/);
    expect(body("declutter_update_draft")).toMatch(/declutter_assert_member\(true\)/);
  });

  it("each acts on the caller's own rows, or is admin-only", () => {
    expect(flat(body("declutter_update_draft"))).toContain("WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE");
    expect(flat(body("declutter_update_draft"))).toContain("IF v_item.status <> 'draft' THEN RAISE EXCEPTION 'item_not_editable'");
    expect(flat(body("declutter_withdraw_item"))).toContain("WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE");
    expect(flat(body("declutter_my_item_review"))).toContain("AND p.seller_id = (SELECT auth.uid())");
    for (const fn of ["declutter_admin_pending_items", "declutter_admin_review_item"]) {
      expect(flat(body(fn)), fn).toMatch(/IF NOT public\.has_role\(.{1,40}?, 'admin'::public\.app_role\) THEN RAISE EXCEPTION 'not_admin'/);
    }
    expect(body("declutter_admin_review_item")).toContain("INSERT INTO public.admin_audit_log");
  });

  it("publish keeps an unchecked or AI-flagged listing for an admin (row 34, B19)", () => {
    expect(flat(body("declutter_publish_item"))).toContain(
      "WHEN v_approved < 3 THEN 'pending_review' WHEN v_ai_checked IS NULL OR v_ai_flag IS NOT NULL THEN 'pending_review' ELSE 'live'",
    );
    expect(flat(MIG)).toContain("AFTER INSERT OR DELETE ON public.declutter_item_photos FOR EACH ROW EXECUTE FUNCTION public.declutter_photos_void_ai_check()");
  });

  it("lh-authz-rls review fixes: no self-approval, approval re-checks the seller, edits void the AI check, stale verdicts refused", () => {
    const review = flat(body("declutter_admin_review_item"));
    expect(review).toContain("IF v_seller = v_uid THEN RAISE EXCEPTION 'own_listing'");
    for (const gate of ["pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')", "OR public.declutter_active_strike_count(v_seller) >= 3",
      "OR public.member_under_18(v_seller)", "OR public.helper_award_block_reason(v_seller) IS NOT NULL) THEN RAISE EXCEPTION 'seller_not_eligible'"]) {
      expect(review).toContain(gate);
    }
    expect(flat(body("declutter_update_draft"))).toContain(
      "OR v_item.category IS DISTINCT FROM p_category THEN UPDATE public.declutter_item_private SET ai_checked_at = NULL, ai_flag_reason = NULL",
    );
    const rec = flat(body("declutter_record_ai_check"));
    expect(rec).toContain("AND status = 'draft' FOR UPDATE");
    expect(rec).toContain("RAISE EXCEPTION 'ai_check_stale'");
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.declutter_record_ai_check\([^)]*\) TO service_role;/);
    expect(flat(body("declutter_publish_item"))).toContain("FROM public.declutter_item_private WHERE item_id = p_item_id FOR UPDATE;");
  });

  it("create and edit refuse an address in the public area label", () => {
    for (const fn of ["declutter_create_item", "declutter_update_draft"]) {
      expect(body(fn), fn).toContain("IF public.declutter_area_label_problem(p_area_label, p_pickup_address) IS NOT NULL THEN");
    }
  });

  it("B5: the storage DELETE policy reaches only the seller's own UNATTACHED declutter photos", () => {
    const pol = flat(/CREATE POLICY "Sellers delete own unattached declutter photos"[\s\S]*?\);/.exec(MIG)?.[0] ?? "");
    expect(pol).toContain("FOR DELETE TO authenticated");
    expect(pol).toContain("bucket_id = 'job-photos'");
    expect(pol).toContain("(storage.foldername(name))[1] = (SELECT auth.uid())::text");
    expect(pol).toContain("(storage.foldername(name))[2] = 'declutter'");
    expect(pol).toContain("NOT EXISTS (SELECT 1 FROM public.declutter_item_photos p WHERE p.storage_path = objects.name)");
  });

  it("B16: listings are seed at birth when the seller is", () => {
    expect(flat(body("declutter_items_seed_from_seller"))).toContain("p.user_id = NEW.seller_id AND p.is_seed ) THEN NEW.is_seed := true;");
    expect(flat(MIG)).toContain("BEFORE INSERT ON public.declutter_items FOR EACH ROW EXECUTE FUNCTION public.declutter_items_seed_from_seller()");
  });

  it("the internal helpers are not client-callable; no new function is anon-callable", () => {
    for (const fn of INTERNAL) {
      expect(MIG, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    }
    for (const fn of NEW_CLIENT_RPCS) expect(MIG, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
  });
});
