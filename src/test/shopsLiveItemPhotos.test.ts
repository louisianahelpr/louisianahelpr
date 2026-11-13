/**
 * Shops audit 11-12 S009: photos change on a LIVE item. Reads the EFFECTIVE (newest) bodies; behaviour on a real
 * database is src/test/pglite/shopsLiveItemPhotos.pglite.mjs (3x; skip red; 12 planted defects red).
 *
 * @mutate supabase/migrations/20261112204756_shops_live_item_photos.sql | IF v_item.status = 'live' AND (SELECT count(*) FROM public.shop_item_photos WHERE item_id = v_item_id) <= 3 THEN | IF false THEN
 * @mutate supabase/migrations/20261112222000_shops_item_rules_s2.sql |   IF v_item.status = 'live' AND (v_flag IS NOT NULL OR v_recent_reject) THEN |   IF false THEN
 * @mutate supabase/functions/declutter-ai-draft/index.ts | .in("status", mode === "check" ? ["draft", "live"] : ["draft"]) | .in("status", ["draft"])
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("S009: photos on a live shop item", () => {
  it("add: draft or live, still byte-stamped and refused for a held shop", () => {
    const b = flat("shops_add_item_photo");
    expect(b).toContain("IF v_item.status NOT IN ('draft', 'live') THEN RAISE EXCEPTION 'item_not_editable'");
    expect(b).toContain("IF public.shop_photos_held(v_item.shop_id) THEN RAISE EXCEPTION 'shop_hidden'");
    expect(b).toContain("FROM public.shop_photo_byte_checks c JOIN storage.objects so ON so.id = c.object_id");
  });

  it("remove: draft or live, and a live item keeps 3 photos", () => {
    const b = flat("shops_remove_item_photo");
    expect(b).toContain("IF v_item.status NOT IN ('draft', 'live') THEN RAISE EXCEPTION 'item_not_editable'");
    expect(b).toContain("IF v_item.status = 'live' AND (SELECT count(*) FROM public.shop_item_photos WHERE item_id = v_item_id) <= 3 THEN RAISE EXCEPTION 'photos_required'");
  });

  it("the AI check judges a changed live item once and holds it on a flag or inside the 30-day hold (S2-002)", () => {
    const b = flat("shops_record_item_ai_check");
    expect(b).toContain("AND (i.status = 'draft' OR (i.status = 'live' AND i.admin_approved_at IS NULL AND EXISTS (SELECT 1 FROM public.shop_item_private pv WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL))) FOR UPDATE;");
    // S2-002 (20261112222000): a rejection in the last 30 days holds a live photo change on a clean check too.
    expect(b).toContain("IF v_item.status = 'live' AND (v_flag IS NOT NULL OR v_recent_reject) THEN UPDATE public.shop_items SET status = 'pending_review', submitted_at = v_at, live_at = NULL, updated_at = v_at WHERE id = p_item_id AND status = 'live';");
    expect(b).toContain("WHERE l.action = 'shop_item_rejected' AND l.details->>'owner_id' = v_item.owner_id::text AND l.created_at > now() - interval '30 days');");
    expect(b).toContain("RAISE EXCEPTION 'ai_check_stale'");
    const edge = readFileSync(resolve(__dirname, "../../supabase/functions/declutter-ai-draft/index.ts"), "utf8");
    expect(edge).toContain('.in("status", mode === "check" ? ["draft", "live"] : ["draft"])');
  });
});
