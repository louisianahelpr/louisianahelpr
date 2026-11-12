/**
 * F356 follow-up (owner pop-ups 11-11 ~5:00 PM, migration 20261112003050): the seller's offer notices name the buyer as
 * first name + last initial (member_display_name, "Ann S."), matching the seller's offer card; a thread answering a
 * Wanted post (wanted_id set) stays anonymous; a buyer with no name keeps the old words; buyer-facing notices are
 * unchanged.
 *
 * Reads the EFFECTIVE definitions (helpers/effectiveFunctionDefs). Backend proof on a real database:
 * src/test/pglite/declutterOfferNoticesNameTheBuyer.pglite.mjs (3x; 6 FAIL without the migration).
 */
// @mutate supabase/migrations/20261112010100_declutter_names_hidden_across_block_or_ban.sql | IF o.wanted_id IS NULL AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id) THEN\n    SELECT public.member_display_name | IF NOT public.declutter_names_hidden(o.buyer_id, o.seller_id) THEN\n    SELECT public.member_display_name
// @mutate supabase/migrations/20261112003050_declutter_offer_notices_name_the_buyer.sql | SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = v_uid; | SELECT bp.full_name INTO v_buyer FROM public.profiles bp WHERE bp.user_id = v_uid;
// @mutate supabase/migrations/20261112010100_declutter_names_hidden_across_block_or_ban.sql |       CASE WHEN v_side = 'buyer' AND v_buyer IS NOT NULL\n        THEN format('%s sent a | CASE WHEN v_buyer IS NOT NULL\n        THEN format('%s sent a
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const make = flat("declutter_make_offer");
const respond = flat("declutter_respond_offer");

describe("F356 follow-up: the seller's offer notices name the buyer", () => {
  it("reads the newest definitions (floor)", () => {
    expect(make.length).toBeGreaterThan(3000);
    expect(respond.length).toBeGreaterThan(3000);
    expect(defs.get("declutter_make_offer")?.file).toMatch(/20261112003050_declutter_offer_notices_name_the_buyer\.sql$/);
    expect(defs.get("declutter_respond_offer")?.file).toMatch(/20261112010100_declutter_names_hidden_across_block_or_ban\.sql$/);
  });

  it("the name is member_display_name only, and never on a Wanted reply", () => {
    expect(make).toContain("SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = v_uid;");
    expect(respond).toContain("IF o.wanted_id IS NULL AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id) THEN SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = o.buyer_id; END IF;");
    // No raw full_name reaches a notice: every full_name read sits inside member_display_name.
    for (const body of [make, respond]) {
      expect(body.match(/full_name/g)?.length).toBe(body.match(/member_display_name\(bp\.full_name, NULL\)/g)?.length);
    }
  });

  it("each seller notice about a buyer's move names them, with the old words as the fallback", () => {
    expect(make).toContain(`THEN format('%s offered $%s on "%s". Accept, decline or send a different price within 48 hours.', v_buyer,`);
    expect(make).toContain(`ELSE format('You got a $%s offer on "%s". Accept, decline or send a different price within 48 hours.',`);
    expect(make).toContain(`THEN format('%s offered $%s on "%s". You answered automatically with your lowest price, $%s.', v_buyer,`);
    expect(make).toContain(`THEN format('%s''s $%s offer on "%s" was accepted automatically (at or above your lowest price).', v_buyer,`);
    expect(respond).toContain(`CASE WHEN v_buyer IS NOT NULL THEN format('%s took back their offer on "%s".', v_buyer, v_item.title)`);
    expect(respond).toContain(`format('%s said no to your $%s price on "%s".%s', COALESCE(v_buyer, 'The buyer'),`);
    // A counter names the buyer only when the BUYER sent it (the seller's counter goes to the buyer, unchanged).
    expect(respond).toContain(`CASE WHEN v_side = 'buyer' AND v_buyer IS NOT NULL THEN format('%s sent a $%s counteroffer on "%s".`);
    expect(respond).toContain(`THEN format('%s''s $%s offer on "%s" was accepted automatically (at or above your lowest price).', v_buyer,`);
    expect(respond).toContain(`ELSE format('Your offer on "%s" was declined. Nothing was charged.', v_item.title) END`);
  });
});
