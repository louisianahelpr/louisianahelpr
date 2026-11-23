/**
 * F259 (whole-app audit 2026-11-10): the Declutter "How do I sell?" answer said every unsold item's price drops 5%
 * each evening, as if nobody could change it. It then said drops were off until the seller turned them on, which went
 * stale when the owner made drops ON by default (10-30): a member with no saved Declutter settings gets
 * SELLER_DEFAULTS.drops (true, 5% a night; useSellerDefaultsPrefill). Audit S-H1 (11-23) caught that. So Help says
 * drops start on at 5%, and that the seller can pick a bigger step (up to the largest DROP_PCT_CHOICES) or turn them
 * off in Declutter settings.
 *
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | Price drops start on: an unsold item's price drops each evening by 5%, stopping above your lowest price. You can pick a bigger step (up to 20%) or turn drops off in Declutter settings. | Price drops are off unless you turn them on; then an unsold item's price drops each evening by the step you pick (5% to 20%), stopping above your lowest price.
 * @mutate src/lib/declutter/sellerDefaults.ts | keepUp: true, drops: true, dropPct: 5, | keepUp: true, drops: false, dropPct: 5,
 */
import { describe, expect, it } from "vitest";
import { FAQ_SECTIONS } from "./helpCenterContent";
import { DEFAULT_DROP_PCT, DROP_PCT_CHOICES } from "@/lib/declutter/priceDrop";
import { SELLER_DEFAULTS } from "@/lib/declutter/sellerDefaults";

const answers = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => ({ q: i.q, a: i.a })));

describe("Help describes Declutter price drops as they start for a new seller", () => {
  it("no answer says drops start off, or promises a fixed drop the seller cannot change", () => {
    expect(answers.length).toBeGreaterThan(20);
    const dropAnswers = answers.filter((x) => /price drops?|drops? \d+%/i.test(x.a));
    expect(dropAnswers.length).toBeGreaterThan(0);
    for (const x of dropAnswers) {
      expect(x.a, x.q).not.toMatch(/drops are off unless/i);
    }
  });

  it("the sell answer says drops start on at the default step and names the largest step and how to turn them off", () => {
    // The words hold only while a new seller really starts with drops on at the default step.
    expect(SELLER_DEFAULTS.drops).toBe(true);
    expect(SELLER_DEFAULTS.dropPct).toBe(DEFAULT_DROP_PCT);
    const sell = answers.find((x) => x.q === "How do I sell?");
    expect(sell).toBeTruthy();
    expect(sell!.a).toContain(`Price drops start on: an unsold item's price drops each evening by ${DEFAULT_DROP_PCT}%`);
    expect(sell!.a).toContain(`(up to ${DROP_PCT_CHOICES[DROP_PCT_CHOICES.length - 1]}%)`);
    expect(sell!.a).toContain("turn drops off in Declutter settings");
  });
});
