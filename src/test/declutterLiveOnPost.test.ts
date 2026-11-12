/**
 * Item B of the Declutter Selling audit (owner 2026-10-29: "Admin shouldn't need to review nearly anything unless
 * something is reported"). The class: a listing is held for an admin by anything other than a FAILED automatic
 * check, or a member has no way to report a listing to an admin. Read from the NEWEST migration definitions and the
 * screens that publish, edit and report, so a later restatement that brings back the "first 3" hold, closes offers
 * on every edit, drops the retry, or loses the report path fails here.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/declutterLiveOnPost.pglite.mjs
 * (40 PASS after; NEW_MIGRATION=skip 32 FAIL, measured 2026-10-30).
 *
 * @mutate supabase/migrations/20261103220428_q2390_publish_manager_takedown_return_problem_free_request_not_found_is_404.sql |     WHEN v_ai_checked IS NOT NULL AND v_ai_flag IS NOT NULL THEN 'pending_review'\n    ELSE 'live' |     WHEN v_ai_checked IS NULL OR v_ai_flag IS NOT NULL THEN 'pending_review'\n    ELSE 'live'
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql |       UPDATE public.declutter_items\n         SET status = 'live', updated_at = v_at | UPDATE public.declutter_items\n         SET status = 'pending_review', updated_at = v_at
 * @mutate supabase/migrations/20261103224137_q2390_edit_manage_offer_draft_wanted_reply_not_found_is_404.sql |     PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing updated',\n      format('The seller updated |     UPDATE public.declutter_offers SET status = 'voided' WHERE item_id = p_item_id AND status = 'open';\n    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing updated',\n      format('The seller updated
 * @mutate supabase/migrations/20261030225143_declutter_wanted_report_block_photo_check.sql |  'application'::text, 'declutter_item'::text, 'declutter_wanted'::text])); |  'application'::text, 'declutter_wanted'::text]));
 * @mutate supabase/migrations/20261103220428_q2390_publish_manager_takedown_return_problem_free_request_not_found_is_404.sql |   IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN |   IF v_uid IS NULL THEN
 * @mutate supabase/migrations/20261103220428_q2390_publish_manager_takedown_return_problem_free_request_not_found_is_404.sql |           jsonb_build_object('note', v_note, 'report_id', p_report_id, 'was', v_item.status)); |           jsonb_build_object('note', v_note, 'was', v_item.status));
 * @mutate src/lib/declutter/api.ts |   for (let attempt = 1; attempt <= tries; attempt++) { |   for (let attempt = 1; attempt <= 1; attempt++) {
 * @mutate src/components/declutter/useSellFlowState.ts |       void requestAiCheckWithRetry(id); |       void id;
 * @mutate src/components/declutter/DeclutterEditListing.tsx |       await requestAiCheckWithRetry(item.id, { tries: 2 }); |       void item.id;
 * @mutate src/components/declutter/DeclutterItemView.tsx |           {!ownListing && user && <DeclutterReportListing itemId={itemId} />} |           {null}
 * @mutate src/lib/i18n/enDeclutter.ts | "Our automatic check flagged something, or it didn't finish, | "Someone from Louisiana Helpr checks a new seller's first 3 listings, and
 * @mutate src/pages/info/legal/TermsSection.tsx | a listing goes live when you post it. | your first 3 listings wait for a Louisiana Helpr admin.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { newestCheckBody, newestFunction } from "./helpers/parityReaders";
import { REASONS } from "@/components/reportDialog/reportReasons";

const sql = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const code = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("item B: a listing goes live when posted; only a failed automatic check holds it", () => {
  it("reads the newest definitions (floor)", () => {
    expect(newestFunction("declutter_admin_reported_items").file).toContain("20261030071816");
    // LEAD-POST-SLOW (owner 2026-10-31): publish and the check restated so the check runs right after Post.
    // Q2390 p39 (20261103224955) restated it verbatim with its not-found as PT404 only.
    // Part 3 F197/F193 (20261109224952) restated it from LIVE, wording only.
    expect(newestFunction("declutter_record_ai_check").file).toContain("20261109224952");
    // Q2390 p35 (20261103220428) restated publish and the take-down with their not-found as PT404 only.
    for (const n of ["declutter_admin_take_down_item", "declutter_publish_item"]) {
      expect(newestFunction(n).file, n).toContain("20261103220428");
    }
    // BUY-11 (20261031083708) restated the edit with the small-edit notice; the rules read here are unchanged.
    // Q2390 p38 (20261103224137) restated it verbatim with its not-found as PT404 only.
    expect(newestFunction("declutter_edit_listing").file).toContain("20261103224137");
  });

  it("publish holds a listing only on a flagged check (no 'first 3 listings' hold; the check runs after Post)", () => {
    const pub = sql("declutter_publish_item");
    expect(pub).toContain("v_status := CASE WHEN v_ai_checked IS NOT NULL AND v_ai_flag IS NOT NULL THEN 'pending_review' ELSE 'live' END;");
    // A check that never comes back is still held (B19), by the sweep, after 15 minutes.
    expect(sql("declutter_hold_unchecked_listings")).toContain("WHERE i.status = 'live' AND i.live_at < now() - interval '15 minutes'");
    expect(pub).not.toMatch(/admin_approved_at|v_approved/);
  });

  it("an edited listing is re-checked: clean goes back live by itself, a flag holds it and closes its offers", () => {
    const rec = sql("declutter_record_ai_check");
    expect(rec).toContain("i.status = 'pending_review' AND i.live_at IS NOT NULL");
    expect(rec).toContain("pv.ai_checked_at IS NULL");
    expect(rec).toMatch(/IF v_flag IS NULL AND NOT EXISTS \(SELECT 1 FROM public\.profiles pr .*public\.declutter_active_strike_count\(v_item\.seller_id\) < 3 AND NOT public\.member_under_18\(v_item\.seller_id\) THEN UPDATE public\.declutter_items SET status = 'live'/);
    expect(rec).toMatch(/ELSIF v_flag IS NOT NULL THEN FOR r IN UPDATE public\.declutter_offers SET status = 'voided'/);
    const edit = sql("declutter_edit_listing");
    // Lead 2026-10-30: offers stay open on a big edit; their buyers are told.
    expect(edit).not.toContain("SET status = 'voided'");
    expect(edit).toContain("'Listing updated', format('The seller updated \"%s\". Check it before your offer is answered.', v_title)");
    expect(edit).toContain("SET ai_checked_at = NULL, ai_flag_reason = NULL");
  });

  it("a member can report a listing, and only an admin takes one down (with the report id logged)", () => {
    expect(newestCheckBody("reports_reported_type_check")?.body).toContain("'declutter_item'");
    const down = sql("declutter_admin_take_down_item");
    expect(down).toContain("PERFORM public.require_feature('declutter');");
    expect(down).toContain("IF public.is_caller_banned() THEN");
    expect(down).toContain("IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN RAISE EXCEPTION 'not_admin'");
    expect(down).toContain("IF v_item.seller_id = v_uid THEN RAISE EXCEPTION 'own_listing'");
    expect(down).toContain("IF v_item.status NOT IN ('live', 'paused', 'pending_review') THEN RAISE EXCEPTION 'item_not_removable'");
    expect(down).toContain("jsonb_build_object('note', v_note, 'report_id', p_report_id, 'was', v_item.status)");
    expect(sql("declutter_admin_reported_items")).toContain("IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN RAISE EXCEPTION 'not_admin'");
    // Each function's own newest migration, found through its newest definition (never a pinned file name).
    const migOf = (fn: string) => readFileSync(join("supabase/migrations", basename(newestFunction(fn).file)), "utf8");
    const mig = migOf("declutter_admin_reported_items");
    for (const [fn, sig] of [["declutter_admin_take_down_item", "declutter_admin_take_down_item(uuid, text, uuid)"],
      ["declutter_admin_reported_items", "declutter_admin_reported_items(uuid[])"], ["declutter_publish_item", "declutter_publish_item(uuid)"]]) {
      expect(migOf(fn), sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`);
    }
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) FROM PUBLIC, anon, authenticated;");
    // The lead's six reasons (2026-10-30).
    expect(REASONS.declutter_item.map((r) => r.label)).toEqual([
      "Prohibited item", "Scam or fake", "Wrong category or misleading", "Offensive", "Shares contact info", "Something else",
    ]);
  });

  it("every screen that publishes or edits asks for the check twice before leaving it held", () => {
    const api = code("src/lib/declutter/api.ts");
    // Asked at least twice (owner 10-31: a posted listing retries up to 4 times, waiting between; Edit asks twice).
    expect(api).toMatch(/export async function requestAiCheckWithRetry[\s\S]{0,400}for \(let attempt = 1; attempt <= tries; attempt\+\+\)/);
    expect(api).toMatch(/\{ tries = CHECK_RETRY_WAITS_MS\.length \+ 1,/);
    const callers = ["src/components/declutter/useSellFlowState.ts", "src/lib/declutter/moves.ts", "src/components/declutter/DeclutterEditListing.tsx"];
    let calls = 0;
    for (const p of callers) {
      const s = code(p);
      // Awaited where it is asked, or (Post, LEAD-POST-SLOW) asked right after publishing, not awaited.
      const n = (s.match(/(?:await|void) requestAiCheckWithRetry\(/g) ?? []).length;
      expect(n, p).toBe(1);
      calls += n;
      // The single-try call is gone from every caller.
      expect(s, p).not.toMatch(/await requestAiCheck\(/);
    }
    expect(calls).toBeGreaterThan(2);
    expect(REASONS.declutter_item.length).toBeGreaterThan(5);
    // The edit screen tells the seller what really happened, read back from the row.
    expect(code("src/components/declutter/DeclutterEditListing.tsx")).toContain('return now?.status === "live" ? "live_again" : "held";');
  });

  it("the item page offers 'Report this listing' to everyone but the seller; the seller's copy has no 'first 3'", () => {
    expect(code("src/components/declutter/DeclutterItemView.tsx")).toContain("{!ownListing && user && <DeclutterReportListing itemId={itemId} />}");
    expect(code("src/components/declutter/DeclutterReportListing.tsx")).toContain('reportedType="declutter_item"');
    // AUD31-59: the Terms still said "your first 3 listings ... wait for a Louisiana Helpr admin".
    for (const p of ["src/lib/i18n/enDeclutter.ts", "src/components/admin/settings/DeclutterReviewCard.tsx", "src/pages/info/legal/TermsSection.tsx"]) {
      expect(code(p), p).not.toMatch(/first (?:3|three) listings|of 3 approved/);
    }
  });
});
