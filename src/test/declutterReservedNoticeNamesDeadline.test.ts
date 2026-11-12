/**
 * Whole-app audit 11-10 (Worker 6) F481, migration 20261110223800: the "Reserved for you: check out in 24 hours"
 * notice names the hold's deadline as a clock time instead of "within 24 hours" (24 hours from when?), and states
 * the strike after the facts ("If you miss it, the item goes back up for sale and that counts as a strike.") instead
 * of as a threat. The time is the line's own checkout_by (set from declutter_hold_length), written by
 * continue_day_label in America/Chicago, the house style every other dated notice uses.
 * Reads the NEWEST definition of declutter_take_item (effectiveDefs), comments blanked.
 *
 * @mutate supabase/migrations/20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql |   RETURNING id, checkout_by INTO v_line, v_by; |   RETURNING id INTO v_line; v_by := now();
 * @mutate supabase/migrations/20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql | Check out by %s to keep it: choose pickup or delivery | Check out within 24 hours: choose pickup or delivery
 * @mutate supabase/migrations/20261112010200_declutter_wanted_reserved_notice_keeps_seller_anonymous.sql | v_title, v_price, v_by_words) END, | v_title, v_price, 'soon') END,
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const take = blankSqlComments(defs.get("declutter_take_item")?.stmt ?? "");

describe("F481: the reserved notice names the checkout deadline", () => {
  it("reads the line's own checkout_by and writes it in the house date style, Central time", () => {
    expect(take.length).toBeGreaterThan(200);
    expect(take).toContain("RETURNING id, checkout_by INTO v_line, v_by;");
    expect(take).toContain(
      "v_by_words := public.continue_day_label((v_by AT TIME ZONE 'America/Chicago')::date, (v_by AT TIME ZONE 'America/Chicago')::time);",
    );
  });

  it("both buyer bodies say 'Check out by <time> to keep it' with the deadline, and the strike after the facts", () => {
    expect(take).toContain(
      `format('%s accepted your %s offer for "%s". Check out by %s to keep it: choose pickup or delivery, pick a day and time, and pay. Your card is not charged until you check out. If you miss it, the item goes back up for sale and that counts as a strike.',`,
    );
    expect(take).toContain("v_price, v_title, v_by_words)");
    expect(take).toContain(
      `format('"%s" is in your cart for %s. Check out by %s to keep it. Your card is not charged until you check out. If you miss it, the item goes back up for sale and that counts as a strike.',`,
    );
    expect(take).toContain("v_title, v_price, v_by_words) END,");
    expect(take).not.toContain("Check out within 24 hours");
    expect(take).not.toContain("you get a strike");
  });

  it("the title the readers key on, the seller's notice and the other branches are unchanged", () => {
    expect(take).toContain("'Reserved for you: check out in 24 hours'");
    expect(take).toContain("They have 24 hours to check out and pay. We''ll tell you when they pay.");
    expect(take).toContain("'Reserved: check out within 30 minutes'");
    expect(take).toContain("'It''s yours: pick a pickup time'");
    expect(blankSqlComments(defs.get("declutter_notice_type")?.stmt ?? "")).toContain("'Reserved for you: check out in 24 hours'");
  });
});
