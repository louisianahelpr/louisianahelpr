/**
 * Sell a bunch audit, finding 14: listing many items is one notice and one push, and every listing is still told.
 * Reads the EFFECTIVE definition. The behaviour is proved in src/test/pglite/declutterBunchOneNotice.pglite.mjs
 * (applied 3x, red on today's body and on 7 planted defects); this keeps the rules from being restated away.
 *
 * @mutate supabase/migrations/20261030174314_declutter_listings_one_summary_notice.sql |        AND n.read = false\n |        AND true\n
 * @mutate supabase/migrations/20261030174314_declutter_listings_one_summary_notice.sql |              created_at = now()\n |              message = message\n
 * @mutate supabase/migrations/20261030174314_declutter_listings_one_summary_notice.sql | AND n.link LIKE '/declutter/item/%') | AND n.link LIKE '/declutter%')
 * @mutate supabase/migrations/20261030174314_declutter_listings_one_summary_notice.sql |       v_n := COALESCE(substring(v_prior_message FROM '^([0-9]+) listings ')::integer, 1) + 1; |       v_n := 2;
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const BODY = blankSqlComments(DEFS.get("declutter_listing_submitted_notice")?.stmt ?? "").replace(/\s+/g, " ");

describe("a run of listings is one notice", () => {
  it("reads the definition (floor)", () => {
    expect(BODY.length).toBeGreaterThan(800);
  });

  it("only an unread notice of this trigger's own is rolled up", () => {
    expect(BODY).toContain("AND n.read = false");
    expect(BODY).toContain("n.user_id = NEW.seller_id");
    // The approval RPC's "Your listing is live" links to Selling, so it never matches.
    expect(BODY).toContain("n.title = 'Your listing is live' AND n.link LIKE '/declutter/item/%'");
  });

  it("the update carries the count and moves the window, and the first listing still inserts", () => {
    expect(BODY).toContain("v_n := COALESCE(substring(v_prior_message FROM '^([0-9]+) listings ')::integer, 1) + 1;");
    expect(BODY).toMatch(/UPDATE public\.notifications SET .*created_at = now\(\) WHERE id = v_prior/);
    expect(BODY).toContain("PERFORM public.declutter_notify(NEW.seller_id, 'declutter_listings', v_title,");
  });
});
