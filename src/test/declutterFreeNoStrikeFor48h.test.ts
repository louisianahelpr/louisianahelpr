/**
 * A free item never gives a strike just for not choosing a pickup in 48 hours (audit DA-12, 2026-10-30; owner
 * 2026-10-29, the Free change). The newest public.declutter_deadline_sweep sends a free line whose 48 hours ran out
 * back up with no strike for anyone, and its 24 h and 2 h reminders do not threaten one. A paid line is unchanged.
 * The behaviour runs in src/test/pglite/declutterFreeNoStrikeFor48h.pglite.mjs (migration applied 3x; red with
 * NEW_MIGRATION=skip); this guard keeps the newest definition saying it.
 *
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |       ELSIF v_line.price_cents = 0 THEN |       ELSIF false THEN
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |     IF r.price_cents = 0 THEN\n      -- DA-12: a free item has no strike to threaten.\n      PERFORM public.declutter_notify(r.buyer_id, 'declutter_sales', 'Choose a pickup within 24 hours', |     IF false THEN\n      -- DA-12: a free item has no strike to threaten.\n      PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Choose a pickup within 24 hours',
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |     IF r.price_cents = 0 THEN\n      -- DA-12: a free item has no strike to threaten.\n      PERFORM public.declutter_notify(r.buyer_id, 'declutter_sales', '2 hours left to choose a pickup', |     IF false THEN\n      -- DA-12: a free item has no strike to threaten.\n      PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to choose a pickup',
 * @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql | Choose how you''ll pick it up within 48 hours or it goes back up. Nothing is charged. | Choose how you''ll pick it up within 48 hours or you get a strike and it goes back up. Nothing is charged.
 * @mutate src/components/declutter/DeclutterReserveSheet.tsx | If you don't, it goes back up. No strike.` | If you don't, you get a strike and it goes back up.`
 * @mutate src/components/declutter/DeclutterYourOffer.tsx | If you don't, it goes back up. No strike.` | If you don't, you get a strike and it goes back up.`
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

describe("free items give no strike for the 48 hours (DA-12)", () => {
  const body = blankSqlComments(newestFunction("declutter_deadline_sweep").body);

  it("the missed-checkout branch for a free line closes it, puts the item back up, and gives no strike", () => {
    const start = body.indexOf("ELSIF v_line.price_cents = 0 THEN");
    expect(start).toBeGreaterThan(0);
    const branch = body.slice(start, body.indexOf("ELSE", start + 40));
    expect(branch.length).toBeGreaterThan(200);
    expect(branch).toContain("SET status = 'missed'");
    expect(branch).toContain("SET status = 'live'");
    expect(branch).not.toContain("declutter_give_strike");
    // It comes before the paid branch that strikes, so a free line never reaches it.
    expect(start).toBeLessThan(body.indexOf("'missed_checkout', v_line.item_id"));
  });

  it("both reminders word a free line without a strike, and a paid line keeps its warning", () => {
    const free = [...body.matchAll(/IF r\.price_cents = 0 THEN([\s\S]*?)\n {4}ELSE\n([\s\S]*?)END IF;/g)];
    expect(free.length).toBe(2);
    for (const [, freeText, paidText] of free) {
      expect(freeText).not.toMatch(/strike/i);
      expect(freeText).toMatch(/goes back up/);
      expect(paidText).toMatch(/strike/);
    }
  });

  it("the claim notice and the two Buying lines tell a free claimer there is no strike; paid keeps its warning", () => {
    const take = blankSqlComments(newestFunction("declutter_take_item").body);
    const free = take.slice(take.indexOf("IF p_price = 0 THEN"), take.indexOf("ELSE", take.indexOf("IF p_price = 0 THEN")));
    expect(free.length).toBeGreaterThan(100);
    expect(free).not.toMatch(/strike/i);
    expect(take.slice(take.indexOf("Reserved for you: check out"))).toMatch(/you get a strike/);
    const files = ["src/components/declutter/DeclutterReserveSheet.tsx", "src/components/declutter/DeclutterYourOffer.tsx"];
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).toContain("If you don't, it goes back up. No strike.`");
      expect(src, f).toMatch(/Check out by \$\{by\}\. If you don't, you get a strike/);
    }
  });
});
