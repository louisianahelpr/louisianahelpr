/**
 * Q2259 S8 (Terms row 24, Help "how to ship"): the Declutter shipping copy shows only where the declutter_shipping
 * switch is on. Help swaps "Shipping isn't offered." for the shipping sentence and adds three shipping answers after
 * "How do I get the item?"; the Terms swap "Shipping is not offered." and add a Shipping row. Elsewhere both pages keep
 * the "not offered" line, which is true there (checkout and Ship it are testers-only, server-checked).
 * The "arrives broken" claim matches spec 5.3: reported in the 2-day (48 h) window -> everything back after an admin
 * check; the spent label is the seller's debt. No return-label promise: the admin cannot request one yet (lead 11-03).
 *
 * @mutate src/pages/info/HelpCenter.tsx | const sections = shippingOn ? withDeclutterShipping(FAQ_SECTIONS) : FAQ_SECTIONS; | const sections = withDeclutterShipping(FAQ_SECTIONS);
 * @mutate src/pages/info/legal/TermsSection.tsx | {shippingOn ? TERMS_SHIPPING_GET_ITEM : "Shipping is not offered."} | {TERMS_SHIPPING_GET_ITEM}
 * @mutate src/pages/info/legal/TermsSection.tsx |       {shippingOn && (\n        <PolicyRowItem |       {true && (\n        <PolicyRowItem
 * @mutate src/pages/info/declutterShippingCopy.ts | report a problem on your order within those 2 days: we check, and you get everything back | report a problem on your order: you get everything back
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";
import {
  HELP_SHIPPING_GET_ITEM, HELP_SHIPPING_ITEMS, TERMS_SHIPPING_PARAGRAPHS, withDeclutterShipping,
} from "@/pages/info/declutterShippingCopy";
import { blankComments } from "./helpers/blankNonCode";

const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const declutter = (sections: typeof FAQ_SECTIONS) => sections.find((s) => s.topic === "Declutter")?.items ?? [];

describe("Declutter shipping copy (S8), only where shipping is on", () => {
  it("off: Help still says shipping isn't offered, with no shipping answers", () => {
    const items = declutter(FAQ_SECTIONS);
    expect(items.length).toBeGreaterThan(4);
    expect(items.find((i) => i.q === "How do I get the item?")?.a).toContain("Shipping isn't offered.");
    expect(items.some((i) => HELP_SHIPPING_ITEMS.some((s) => s.q === i.q))).toBe(false);
  });

  it("on: the sentence is swapped and the three answers follow How do I get the item?", () => {
    const items = declutter(withDeclutterShipping(FAQ_SECTIONS));
    const at = items.findIndex((i) => i.q === "How do I get the item?");
    expect(at).toBeGreaterThan(0);
    expect(items[at].a).toContain(HELP_SHIPPING_GET_ITEM);
    expect(items[at].a).not.toContain("Shipping isn't offered");
    expect(items.slice(at + 1, at + 4).map((i) => i.q)).toEqual(HELP_SHIPPING_ITEMS.map((i) => i.q));
    expect(items.length).toBe(declutter(FAQ_SECTIONS).length + 3);
    // Other topics are untouched.
    expect(withDeclutterShipping(FAQ_SECTIONS).filter((s) => s.topic !== "Declutter")).toEqual(FAQ_SECTIONS.filter((s) => s.topic !== "Declutter"));
  });

  it("the broken-parcel claim matches spec 5.3 in Help and in the Terms", () => {
    const broken = HELP_SHIPPING_ITEMS.find((i) => i.q === "What if my package doesn't come, or arrives broken?")?.a ?? "";
    expect(broken).toContain("report a problem on your order within those 2 days: we check, and you get everything back");
    expect(broken).toContain("seller's cost, never yours");
    const seller = HELP_SHIPPING_ITEMS.find((i) => i.q === "How do I ship something I sold?")?.a ?? "";
    expect(seller).toContain("the buyer gets everything back and the label comes out of your next payout");
    const terms = TERMS_SHIPPING_PARAGRAPHS.join(" ");
    expect(terms).toContain("report it in those 2 days, Louisiana Helpr checks it and you get everything back");
    expect(terms).toContain("the spent label comes out of the seller's next payouts");
  });

  it("no shipping copy promises a return label (the admin cannot request one yet)", () => {
    const all = [...HELP_SHIPPING_ITEMS.map((i) => i.a), ...TERMS_SHIPPING_PARAGRAPHS].join(" ");
    expect(all.length).toBeGreaterThan(500);
    expect(all.toLowerCase()).not.toContain("return label");
  });

  it("HelpCenter and the Terms read the switch and keep the not-offered line when it is off", () => {
    const help = src("src/pages/info/HelpCenter.tsx");
    expect(help).toContain('const shippingOn = useFeature("declutter_shipping");');
    expect(help).toContain("const sections = shippingOn ? withDeclutterShipping(FAQ_SECTIONS) : FAQ_SECTIONS;");
    expect(help).toContain("{sections.map((section) => (");
    expect(help).not.toContain("{FAQ_SECTIONS.filter(");
    const terms = src("src/pages/info/legal/TermsSection.tsx");
    expect(terms).toContain('const shippingOn = useFeature("declutter_shipping");');
    expect(terms).toContain('{shippingOn ? TERMS_SHIPPING_GET_ITEM : "Shipping is not offered."}');
    expect(terms.replace(/\s+/g, " ")).toContain('{shippingOn && ( <PolicyRowItem icon={Truck} title="Shipping"');
  });
});
