/**
 * Shops audit 11-12 S043: shops_browse searches on the server (p_query): every word must be in the shop's name,
 * category label or area, or in one of its LIVE item titles, by plain strpos (no LIKE pattern). Reads the EFFECTIVE
 * (newest) shops_browse; behaviour on a real database is src/test/pglite/shopsBrowseSearch.pglite.mjs (3x; skip red;
 * 14 planted defects red). Speed: one query, the item test reads the partial covering index shop_items_live_title_idx.
 *
 * @mutate supabase/migrations/20261112203620_shops_browse_searches_item_titles.sql | AND i.shop_id = s.id AND i.status = 'live' AND strpos(lower(i.title), qw.w) > 0))) | AND i.shop_id = s.id AND strpos(lower(i.title), qw.w) > 0)))
 * @mutate supabase/migrations/20261112203620_shops_browse_searches_item_titles.sql | WHERE s.offers_selling AND NOT s.paused | WHERE true
 * @mutate supabase/migrations/20261112203620_shops_browse_searches_item_titles.sql | DROP FUNCTION IF EXISTS public.shops_browse(numeric, numeric, text, text, integer, integer); |
 * @mutate supabase/migrations/20261112203620_shops_browse_searches_item_titles.sql | CREATE INDEX IF NOT EXISTS shop_items_live_title_idx ON public.shop_items (shop_id) INCLUDE (title) WHERE status = 'live'; |
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const FILE = "20261112203620_shops_browse_searches_item_titles.sql";
const MIG = blankSqlComments(readFileSync(resolve(MIG_DIR, FILE), "utf8")).replace(/\s+/g, " ");

describe("S043: shops_browse searches item titles on the server", () => {
  it("the newest shops_browse takes p_query and matches name, category, area or a live item title", () => {
    const b = flat("shops_browse");
    expect(b).toContain("p_offset integer DEFAULT 0, p_query text DEFAULT NULL )");
    expect(b).toContain("FROM regexp_split_to_table(lower(left(btrim(COALESCE(p_query, '')), 80)), '\\s+') AS w WHERE w <> '' LIMIT 6) q;");
    expect(b).toContain(
      "AND (v_words IS NULL OR NOT EXISTS ( SELECT 1 FROM unnest(v_words) AS qw(w) WHERE strpos(lower(COALESCE(s.name, '') || ' ' || COALESCE(c.label, '') || ' ' || COALESCE(s.area_label, '')), qw.w) = 0 AND NOT EXISTS (SELECT 1 FROM public.shop_items i WHERE s.offers_selling AND NOT s.paused AND i.shop_id = s.id AND i.status = 'live' AND strpos(lower(i.title), qw.w) > 0)))",
    );
    // Visibility, the cap and paging are unchanged.
    expect(b).toContain("WHERE public.shop_visible_to(s.id, v_uid)");
    expect(b).toContain("LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60) OFFSET GREATEST(COALESCE(p_offset, 0), 0);");
    expect(b).not.toMatch(/\bI?LIKE\b/i);
  });

  it("one signature (the 6-argument form dropped), authenticated only, and the live-title index", () => {
    expect(MIG).toContain("DROP FUNCTION IF EXISTS public.shops_browse(numeric, numeric, text, text, integer, integer);");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.shops_browse(numeric, numeric, text, text, integer, integer, text) FROM PUBLIC, anon;");
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.shops_browse(numeric, numeric, text, text, integer, integer, text) TO authenticated, service_role;");
    expect(MIG).toContain("CREATE INDEX IF NOT EXISTS shop_items_live_title_idx ON public.shop_items (shop_id) INCLUDE (title) WHERE status = 'live';");
    // No later migration brings the old signature back.
    const later = readdirSync(MIG_DIR).filter((f) => f > FILE && f.endsWith(".sql"));
    for (const f of later) expect(readFileSync(resolve(MIG_DIR, f), "utf8"), f).not.toMatch(/shops_browse\(numeric, numeric, text, text, integer, integer\)/);
    const allow = readFileSync(resolve(__dirname, "../../scripts/ci/definer-exec-allowlist.json"), "utf8");
    expect(allow).toContain('"shops_browse(numeric, numeric, text, text, integer, integer, text)": "client"');
  });
});
