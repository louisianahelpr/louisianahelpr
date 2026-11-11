/**
 * F259 (whole-app audit 2026-11-10): the Declutter "How do I sell?" answer said every unsold item's price drops 5%
 * each evening. Price drops are opt-in (owner 2026-10-28; declutter_items.drop_pct defaults to 0 and the sell form
 * starts with drops off, src/test/declutterPriceDropsOptIn.test.ts), the step is the seller's pick, and the item page
 * already shows its own drop line only when that item's drops are on (DeclutterItemView's PriceDropBanner). So Help
 * must say drops are off until the seller turns them on, and name the steps the seller can pick.
 *
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | Price drops are off unless you turn them on; then an unsold item's price drops each evening by the step you pick (5% to 20%), stopping above your lowest price. | Each evening an unsold item's price drops 5%, stopping above your lowest price.
 * @mutate src/components/declutter/sellForm.ts |   drops: false, |   drops: true,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAQ_SECTIONS } from "./helpCenterContent";
import { DROP_PCT_CHOICES } from "@/lib/declutter/priceDrop";

const answers = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => ({ q: i.q, a: i.a })));

describe("Help describes Declutter price drops as the seller's choice", () => {
  it("no answer promises that every item drops each evening", () => {
    expect(answers.length).toBeGreaterThan(20);
    const dropAnswers = answers.filter((x) => /price drops?|drops? \d+%/i.test(x.a));
    expect(dropAnswers.length).toBeGreaterThan(0);
    for (const x of dropAnswers) {
      expect(x.a, x.q).not.toMatch(/each evening an unsold item's price drops \d+%/i);
    }
  });

  it("the sell answer says drops start off and names the seller's steps", () => {
    const sell = answers.find((x) => x.q === "How do I sell?");
    expect(sell).toBeTruthy();
    expect(sell!.a).toContain("Price drops are off unless you turn them on");
    expect(sell!.a).toContain(`(${DROP_PCT_CHOICES[0]}% to ${DROP_PCT_CHOICES[DROP_PCT_CHOICES.length - 1]}%)`);
    // The words hold only while the sell form really starts with drops off.
    const form = readFileSync(join(process.cwd(), "src/components/declutter/sellForm.ts"), "utf8");
    expect(form).toMatch(/\bdrops:\s*false,/);
  });
});
