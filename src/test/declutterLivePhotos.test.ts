/**
 * Audit DC-8 / Q2476: a live Declutter listing's photos can be changed, and a change follows the big-edit rule
 * (20261030043553): hidden for the automatic re-check, open offers stay open and their buyers are told; a flagged
 * listing, a paused or sold one and the last photo are refused. Read from the NEWEST definitions, so a later
 * restatement that goes back to drafts only, skips the re-check, lets a flag be washed off by a photo swap, or lets
 * the last photo go fails here.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/declutterLivePhotos.pglite.mjs
 * (28 PASS after; NEW_MIGRATION=skip 15 FAIL, measured 2026-10-30).
 *
 * @mutate supabase/migrations/20261030061927_declutter_live_listing_photos.sql |   IF v_item.status <> 'draft' AND NOT v_listed THEN\n    RAISE EXCEPTION 'item_not_editable' |   IF v_item.status <> 'draft' THEN\n    RAISE EXCEPTION 'item_not_editable'
 * @mutate supabase/migrations/20261030061927_declutter_live_listing_photos.sql |  WHERE pv.item_id = p_item_id AND pv.ai_checked_at IS NULL AND pv.ai_flag_reason IS NULL)); |  WHERE pv.item_id = p_item_id AND pv.ai_checked_at IS NULL));
 * @mutate supabase/migrations/20261030061927_declutter_live_listing_photos.sql |   IF v_listed AND (SELECT count(*) FROM public.declutter_item_photos ph WHERE ph.item_id = v_item.id) <= 1 THEN | IF false THEN
 * @mutate supabase/migrations/20261030061927_declutter_live_listing_photos.sql |        SET status = 'pending_review', submitted_at = now(), updated_at = now()\n     WHERE id = p_item_id; |        SET updated_at = now()\n     WHERE id = p_item_id;
 */
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { DECLUTTER_ERROR_COPY } from "@/lib/declutter/errors";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

const sql = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const LISTED = "v_item.status = 'live' OR (v_item.status = 'pending_review' AND v_item.live_at IS NOT NULL AND EXISTS ( SELECT 1 FROM public.declutter_item_private pv WHERE pv.item_id =";

describe("DC-8: a live listing's photos can be changed, under the big-edit rule", () => {
  it("reads the newest definitions (floor)", () => {
    let n = 0;
    for (const f of ["declutter_add_item_photo", "declutter_remove_item_photo"]) {
      expect(newestFunction(f).file, f).toContain("20261030061927");
      n++;
    }
    expect(n).toBeGreaterThan(1);
  });

  it("a draft, the seller's live listing, or one whose edit re-check is pending (never a flagged one)", () => {
    for (const f of ["declutter_add_item_photo", "declutter_remove_item_photo"]) {
      const body = sql(f);
      expect(body, f).toContain(LISTED);
      expect(body, f).toContain("AND pv.ai_checked_at IS NULL AND pv.ai_flag_reason IS NULL));");
      expect(body, f).toContain("seller_id = v_uid");
      expect(body, f).toMatch(/PERFORM public\.require_feature\('declutter'\); IF public\.is_caller_banned\(\) THEN/);
    }
    expect(sql("declutter_add_item_photo")).toContain("IF v_item.status <> 'draft' AND NOT v_listed THEN RAISE EXCEPTION 'item_not_editable'");
  });

  it("a change on a live listing sends it to the re-check and tells buyers with open offers; offers stay open", () => {
    for (const f of ["declutter_add_item_photo", "declutter_remove_item_photo"]) {
      const body = sql(f);
      expect(body, f).toMatch(/IF v_item\.status = 'live' THEN FOR r IN SELECT DISTINCT o\.buyer_id FROM public\.declutter_offers o WHERE o\.item_id = (p_item_id|v_item\.id) AND o\.status = 'open'/);
      expect(body, f).toContain("'Listing updated', format('The seller updated \"%s\". Check it before your offer is answered.', v_item.title)");
      expect(body, f).toMatch(/SET status = 'pending_review', submitted_at = now\(\), updated_at = now\(\) WHERE id = (p_item_id|v_item\.id);/);
      expect(body, f).not.toContain("SET status = 'voided'");
    }
  });

  it("the last photo of a listing on sale stays, and the refusal has plain words", () => {
    expect(sql("declutter_remove_item_photo")).toContain("IF v_listed AND (SELECT count(*) FROM public.declutter_item_photos ph WHERE ph.item_id = v_item.id) <= 1 THEN RAISE EXCEPTION 'too_few_photos'");
    expect(DECLUTTER_ERROR_COPY.too_few_photos).toMatch(/at least one photo/);
    expect(RPC_ERROR_COPY.declutter_remove_item_photo?.too_few_photos).toBe(DECLUTTER_ERROR_COPY.too_few_photos);
  });
});
