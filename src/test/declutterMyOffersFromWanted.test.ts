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
 * @mutate supabase/migrations/20261030134231_declutter_my_offers_from_wanted.sql |          (o.wanted_id IS NOT NULL)\n |          false\n
 * @mutate supabase/migrations/20261030134231_declutter_my_offers_from_wanted.sql |          o.updated_at,\n         (o.wanted_id IS NOT NULL) |          o.updated_at,\n         (o.wanted_id IS NOT NULL), o.wanted_id
 * @mutate supabase/migrations/20261030134231_declutter_my_offers_from_wanted.sql | REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_my_offers() FROM PUBLIC;
 * @mutate supabase/migrations/20261030134231_declutter_my_offers_from_wanted.sql |          CASE WHEN o.seller_id = v_uid THEN p.floor_price_cents END, |          p.floor_price_cents,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const FILE = "20261030134231_declutter_my_offers_from_wanted.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("D4-3: declutter_my_offers says which offers answer a Wanted post", () => {
  it("reads the newest definition (this migration)", () => {
    expect(newestFunction("declutter_my_offers").file).toContain("20261030134231");
  });

  it("from_wanted is the last column, a yes/no from wanted_id; the Wanted id itself never leaves", () => {
    const body = flat(newestFunction("declutter_my_offers").body);
    expect(body).toContain("o.updated_at, (o.wanted_id IS NOT NULL) FROM public.declutter_offers o");
    const sql = flat(readFileSync(`supabase/migrations/${FILE}`, "utf8"));
    expect(sql).toContain("current_price_cents integer, floor_price_cents integer, updated_at timestamptz, from_wanted boolean)");
    // The select list never hands out the Wanted post id itself.
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
