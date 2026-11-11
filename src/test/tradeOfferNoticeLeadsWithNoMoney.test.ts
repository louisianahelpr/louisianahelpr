/**
 * F482 (whole-app audit 11-10, Worker 6, Suggestion; words half): "No money changes hands." sat last in the "New trade
 * offer" notice and email. Migration 20261111201159: declutter_offer_swap's notice leads with it. (Item photos in the
 * email need an email template change: DECISIONS-FOR-OWNER-1111.md, Builder 3.)
 *
 * Reads the EFFECTIVE definition (newest CREATE, any dollar tag, comments blanked). Behaviour (real Postgres):
 * src/test/pglite/tradeOfferNoticeLeadsWithNoMoney.pglite.mjs (5 PASS; 2 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261111201159_trade_offer_notice_leads_with_no_money.sql | format('No money changes hands. %s offered "%s" in trade for "%s". Accept or decline within 48 hours.', | format('%s offered "%s" in trade for "%s". Accept or decline within 48 hours. No money changes hands.',
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");

describe("the trade offer notice leads with no money (F482)", () => {
  it("declutter_offer_swap's notice starts 'No money changes hands.'", () => {
    const b = blankSqlComments(defs.get("declutter_offer_swap")?.stmt ?? "").replace(/\s+/g, " ");
    expect(b.length).toBeGreaterThan(1500);
    expect(b).toContain(`'New trade offer', format('No money changes hands. %s offered "%s" in trade for "%s". Accept or decline within 48 hours.',`);
  });
});
