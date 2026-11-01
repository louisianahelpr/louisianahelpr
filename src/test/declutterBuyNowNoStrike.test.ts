/**
 * Buy now goes straight to checkout, with no strike for backing out before paying (audit DB-5, 2026-10-30; owner
 * decision the same day). The class: every place a Buy now line (declutter_cart_items.source = 'buy') could still earn
 * or threaten a strike, read from the NEWEST definitions: the deadline sweep's missed-checkout branch and both of its
 * reminders, the take notice, and the cart read that tells the screens which lines are Buy now. An accepted offer
 * (source 'offer') keeps its strike. The behaviour runs in src/test/pglite/declutterBuyNowNoStrike.pglite.mjs
 * (migration applied 3x; red with NEW_MIGRATION=skip); the screens in declutterTradeViews.test.tsx.
 *
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |       ELSIF v_line.source = 'buy' THEN |       ELSIF false THEN
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |     ELSIF r.source = 'buy' THEN\n      -- DB-5: a Buy now line has no strike to threaten either.\n      PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours', |     ELSIF false THEN\n      -- DB-5: a Buy now line has no strike to threaten either.\n      PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |     ELSIF r.source = 'buy' THEN\n      -- DB-5: a Buy now line has no strike to threaten either.\n      PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to check out', |     ELSIF false THEN\n      -- DB-5: a Buy now line has no strike to threaten either.\n      PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to check out',
 * @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql |   ELSIF p_source = 'buy' THEN |   ELSIF false THEN
 * @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |          c.source  -- DB-5 |          NULL::text  -- DB-5
 * @mutate src/components/declutter/DeclutterReserveSheet.tsx | If you don't, it goes back up for sale. No strike.` | If you don't, you get a strike.`
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

/** The text from `start` up to the next line that begins a sibling branch (ELSIF / ELSE at the same indent). */
function branchAt(body: string, start: number, indent: string): string {
  const rest = body.slice(start + 1);
  const next = rest.search(new RegExp(`\\n${indent}(?:ELSIF|ELSE)\\b`));
  return body.slice(start, next < 0 ? undefined : start + 1 + next);
}

describe("Buy now gives no strike for not paying (DB-5)", () => {
  const sweep = blankSqlComments(newestFunction("declutter_deadline_sweep").body);

  it("the missed-checkout branch for a Buy now line closes it, puts the item back up, and gives no strike", () => {
    const start = sweep.indexOf("ELSIF v_line.source = 'buy' THEN");
    expect(start).toBeGreaterThan(0);
    const branch = branchAt(sweep, start, "      ");
    expect(branch.length).toBeGreaterThan(300);
    expect(branch).toContain("SET status = 'missed'");
    expect(branch).toContain("SET status = 'live'");
    expect(branch).toMatch(/no strike/);
    expect(branch).not.toContain("declutter_give_strike");
    // It comes before the branch that strikes the buyer, so a Buy now line never reaches it; an offer still does.
    const strike = sweep.indexOf("'missed_checkout', v_line.item_id");
    expect(strike).toBeGreaterThan(start);
  });

  it("both reminders word a Buy now line without a strike, and an accepted offer keeps its warning", () => {
    const buys = [...sweep.matchAll(/ELSIF r\.source = 'buy' THEN([\s\S]*?)\n {4}ELSE\n([\s\S]*?)END IF;/g)];
    expect(buys.length).toBe(2);
    for (const [, buyText, offerText] of buys) {
      expect(buyText.length).toBeGreaterThan(100);
      expect(buyText).not.toMatch(/strike/i);
      expect(buyText).toMatch(/goes back up for sale/);
      expect(offerText).toMatch(/you get a strike/);
    }
    // The reminders read the line's source.
    expect(sweep.match(/RETURNING c\.buyer_id, c\.price_cents, c\.source,/g)?.length).toBe(2);
  });

  it("the take notice tells a Buy now buyer there is no strike; an accepted offer's still warns", () => {
    const take = blankSqlComments(newestFunction("declutter_take_item").body);
    const at = take.indexOf("ELSIF p_source = 'buy' THEN");
    expect(at).toBeGreaterThan(0);
    const buy = branchAt(take, at, "  ");
    expect(buy.length).toBeGreaterThan(200);
    expect(buy).not.toMatch(/strike/i);
    expect(buy).toMatch(/goes back up for sale/);
    expect(take.slice(at + buy.length)).toMatch(/you get a strike/);
  });

  it("the cart read returns each line's source, and the screens word a Buy now hold without a strike", () => {
    const cart = newestFunction("declutter_my_cart");
    expect(cart.body).toMatch(/\bc\.source\b/);
    // Its row type (the body above holds only what sits between the dollar quotes) ends with source.
    const sql = blankSqlComments(readFileSync(`supabase/migrations/${cart.file}`, "utf8"));
    const heads = [...sql.matchAll(/FUNCTION public\.declutter_my_cart\(\)\s+RETURNS TABLE\s*\(([^)]*)\)/gi)];
    expect(heads.length).toBeGreaterThan(0);
    expect(heads[heads.length - 1][1]).toMatch(/\bsource text\s*$/);
    const files = ["src/components/declutter/DeclutterReserveSheet.tsx", "src/components/declutter/DeclutterYourOffer.tsx"];
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).toContain("If you don't, it goes back up for sale. No strike.`");
    }
    // Buy now opens the checkout itself: the reserve sheet (with its strike warning) is gone.
    const panel = blankComments(readFileSync("src/components/declutter/DeclutterOfferPanel.tsx", "utf8"));
    expect(panel).not.toMatch(/ReserveSheet|setReserve/);
    expect(panel).toContain("navigate(checkoutLinkFor(item.seller_id))");
  });
});
