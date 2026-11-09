/**
 * F061 (UI audit 11-09; lead rule 11-09): only a SOLD Declutter item's page may show what it was (its title and cover,
 * greyed, "Sold"); a withdrawn, removed, rejected or hidden item shows nothing of the listing. The SQL is graded from
 * the NEWEST migration that defines each function (newestFunction). PGlite proof:
 * src/test/pglite/declutterSoldItemCard.pglite.mjs (31 pass; NEW_MIGRATION=skip red).
 *
 * @mutate supabase/migrations/20261109194234_declutter_sold_item_card.sql |        SELECT i.status IN ('sold', 'completed') |        SELECT i.status IN ('sold', 'completed', 'withdrawn')
 * @mutate supabase/migrations/20261109194234_declutter_sold_item_card.sql |   RETURN jsonb_build_object(\n    'title', v_title, |   RETURN jsonb_build_object(\n    'title', v_title, 'seller_id', (SELECT seller_id FROM public.declutter_items WHERE id = p_item_id),
 * @mutate supabase/migrations/20261109194234_declutter_sold_item_card.sql |                            WHERE r.reported_type = 'declutter_item' AND r.reported_id = i.id) |                            WHERE r.reported_type = 'declutter_item' AND r.reported_id = i.id AND r.status = 'pending')
 * @mutate supabase/migrations/20261109194234_declutter_sold_item_card.sql | REVOKE ALL ON FUNCTION public.declutter_item_sold_visible(uuid) FROM PUBLIC, anon, authenticated; | GRANT EXECUTE ON FUNCTION public.declutter_item_sold_visible(uuid) TO anon;
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";

const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const fileOf = (name: string) => {
  const f = newestFunction(name).file;
  return blankSqlComments(readFileSync(resolve(f.includes("/") ? f : `supabase/migrations/${f}`), "utf8")).replace(/\s+/g, " ");
};

describe("F061: a sold item's card (SQL)", () => {
  it("the rule is sold or completed only, seller not out, no test item while hidden, Declutter on", () => {
    const rule = code("declutter_item_sold_visible");
    expect(rule.length).toBeGreaterThan(200);
    expect(rule).toContain("i.status IN ('sold', 'completed') AND NOT i.seller_hidden AND (NOT i.is_seed OR NOT public.seed_hidden_in_discovery())");
    expect(rule).toContain("f.key = 'declutter' AND f.audience IN ('testers', 'everyone')");
    // lh-authz-rls 11-09: an admin cannot take down a sold item, so any report on it hides it.
    expect(rule).toContain("AND NOT EXISTS (SELECT 1 FROM public.reports r WHERE r.reported_type = 'declutter_item' AND r.reported_id = i.id)");
  });

  it("the card is exactly the title and the cover photo id, and NULL whenever the rule says no", () => {
    const card = code("declutter_sold_item_card");
    expect(card).toContain("IF p_item_id IS NULL OR NOT public.declutter_item_sold_visible(p_item_id) THEN RETURN NULL;");
    const keys = [...card.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]).sort();
    expect(keys).toEqual(["photo_id", "title"]);
    expect(card).not.toMatch(/seller_id'|description|floor|pickup|storage_path|price|area_label/);
  });

  it("grants: anon may read the card; the rule and the photo path are service_role only", () => {
    const sql = fileOf("declutter_sold_item_card");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.declutter_sold_item_card(uuid) TO anon, authenticated, service_role;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_item_sold_visible(uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.declutter_item_sold_visible\(uuid\) TO [^;]*\b(anon|authenticated)\b/);
    expect(fileOf("declutter_public_photo_path")).toContain("REVOKE ALL ON FUNCTION public.declutter_public_photo_path(uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("the photo path serves a sold item's COVER only (and every photo of a live item, as before)", () => {
    const path = code("declutter_public_photo_path");
    expect(path).toContain("public.declutter_item_link_visible(ph.item_id) OR (public.declutter_item_sold_visible(ph.item_id) AND ph.id = (SELECT c.id FROM public.declutter_item_photos c WHERE c.item_id = ph.item_id ORDER BY c.position, c.id LIMIT 1))");
  });

  it("the app reads it only for the unavailable page's greyed card", () => {
    const api = blankComments(readFileSync(resolve("src/lib/declutter/api.ts"), "utf8"));
    expect(api).toMatch(/supabase\.rpc\("declutter_sold_item_card"/);
    const view = blankComments(readFileSync(resolve("src/components/declutter/DeclutterItemView.tsx"), "utf8"));
    expect(view).toContain("top={item.isError ? null : <SoldItemCard itemId={itemId} />}");
  });
});
