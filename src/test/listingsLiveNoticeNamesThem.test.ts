/**
 * F484 (whole-app audit 11-10, Worker 6, Suggestion): the rolled-up "Your listings are live" notice said only
 * "10 listings are live." Migration 20261111200834: it names the seller's newest live listings, at most three and
 * never more than the count ('10 listings are live, including "Lamp", "Rug" and "Chair". ...'); the count still leads.
 *
 * Reads the EFFECTIVE definition (newest CREATE, any dollar tag, comments blanked). Behaviour (real Postgres):
 * src/test/pglite/listingsLiveNoticeNamesThem.pglite.mjs (6 PASS; 4 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261111200834_listings_live_notice_names_them.sql |                  LIMIT LEAST(v_n, 3)) x; |                  LIMIT 3) x;
 * @mutate supabase/migrations/20261111200834_listings_live_notice_names_them.sql |                  WHERE i.seller_id = NEW.seller_id AND i.status = 'live' AND NOT COALESCE(i.seller_hidden, false) |                  WHERE i.status = 'live' AND NOT COALESCE(i.seller_hidden, false)
 * @mutate supabase/migrations/20261111200834_listings_live_notice_names_them.sql | THEN v_n \|\| ' listings are live' \|\| COALESCE(', including ' \|\| v_names, '') \|\| '. Buyers can see them now.' | THEN v_n \|\| ' listings are live. Buyers can see them now.'
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");

describe("the listings-live roll-up names them (F484)", () => {
  it("names this seller's newest live listings, no more than the count, after the count", () => {
    const b = blankSqlComments(defs.get("declutter_listing_submitted_notice")?.stmt ?? "").replace(/\s+/g, " ");
    expect(b.length).toBeGreaterThan(1500);
    expect(b).toContain("WHERE i.seller_id = NEW.seller_id AND i.status = 'live' AND NOT COALESCE(i.seller_hidden, false)");
    expect(b).toContain("LIMIT LEAST(v_n, 3)) x;");
    expect(b).toContain("THEN v_n || ' listings are live' || COALESCE(', including ' || v_names, '') || '. Buyers can see them now.'");
    expect(b).toContain("substring(v_prior_message FROM '^([0-9]+) listings ')");
  });
});
