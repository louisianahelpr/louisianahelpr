/**
 * Audit 1d D4-3 (2026-10-29, ~/.lh-shots/app-audit-1028/1d-gaps/1d-wmatch-1440-p2-1440.png): a seller's answer to a
 * buyer's Wanted post is stored as a seller "counter" (declutter_offers.wanted_id), and Buying -> Your offers showed it
 * as "$12 their counter" with "Take back my offer", for an offer the buyer never made. declutter_my_offers now says
 * which rows answer a Wanted post (from_wanted, a yes/no only); the card says "Reply to your Wanted"
 * (declutterTradeViews.test.tsx pins the screen).
 *
 * Behaviour: src/test/pglite/declutterMyOffersFromWanted.pglite.mjs (13 PASS with 20261030134231 applied 3x over prod's
 * body; NEW_MIGRATION=skip -> 4 FAIL).
 *
 * BUY-29 (10-31, lead decision): the poster's own row also carries the still-open Wanted post's id (open_wanted_id,
 * 20261031095146), so the card can ask "Close your Wanted post?" after an accept. Never on the seller's row, never for
 * a closed post. Behaviour: src/test/pglite/declutterMyOffersOpenWantedId.pglite.mjs (14 PASS, 3x; skip -> 5 FAIL).
 *
 * @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |          (o.wanted_id IS NOT NULL),\n |          false,\n
 * @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |          (o.wanted_id IS NOT NULL),\n         w.id | (o.wanted_id IS NOT NULL),\n         o.wanted_id
 * @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql | ON w.id = o.wanted_id AND w.user_id = v_uid AND o.buyer_id = v_uid AND w.status = 'open' | ON w.id = o.wanted_id AND w.status = 'open'
 * @mutate supabase/migrations/20261031095146_declutter_my_offers_open_wanted_id.sql | REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC;
 * @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |          CASE WHEN o.seller_id = v_uid THEN p.floor_price_cents END, |          p.floor_price_cents,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const FILE = "20261031095146_declutter_my_offers_open_wanted_id.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("D4-3: declutter_my_offers says which offers answer a Wanted post", () => {
  it("reads the newest definition (BUY-29's migration)", () => {
    expect(newestFunction("declutter_my_offers").file).toContain("20261101175510");
  });

  it("from_wanted is a yes/no from wanted_id; the id leaves only as open_wanted_id, the poster's own open post", () => {
    const body = flat(newestFunction("declutter_my_offers").body);
    expect(body).toContain("o.updated_at, (o.wanted_id IS NOT NULL), w.id FROM public.declutter_offers o");
    expect(body).toContain("LEFT JOIN public.declutter_wanted w ON w.id = o.wanted_id AND w.user_id = v_uid AND o.buyer_id = v_uid AND w.status = 'open'");
    const sql = flat(readFileSync(`supabase/migrations/${FILE}`, "utf8"));
    expect(sql).toContain("current_price_cents integer, floor_price_cents integer, updated_at timestamptz, from_wanted boolean, open_wanted_id uuid)");
    // The select list never hands out the offer's raw wanted_id (only w.id, which the join limits to the poster).
    const select = body.slice(body.indexOf("RETURN QUERY SELECT") + "RETURN QUERY SELECT".length, body.indexOf(" FROM public.declutter_offers o"));
    expect(select.length).toBeGreaterThan(100);
    expect(select).not.toMatch(/,\s*o\.wanted_id\b/);
  });

  it("prod's rules kept: caller required, both sides only, the seller's floor to the seller only, 30-day window", () => {
    const body = flat(newestFunction("declutter_my_offers").body);
    expect(body).toContain("IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';");
    expect(body).toContain("CASE WHEN o.seller_id = v_uid THEN p.floor_price_cents END,");
    expect(body).toContain("WHERE (o.buyer_id = v_uid OR o.seller_id = v_uid) AND (o.status = 'open' OR o.updated_at > now() - interval '30 days')");
  });

  it("dropped and created again (a new OUT column), definer with a pinned search_path, grants restated by role name", () => {
    const sql = flat(readFileSync(`supabase/migrations/${FILE}`, "utf8"));
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.declutter_my_offers();");
    expect(sql).toContain("SECURITY DEFINER SET search_path TO 'public', 'pg_temp'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.declutter_my_offers() TO authenticated, service_role;");
  });
});
