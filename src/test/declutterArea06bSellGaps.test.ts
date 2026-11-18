/**
 * Design audit area 06b (Declutter selling gaps, 11-18): the source-level fixes that have no rendered test elsewhere.
 * Each check reads the real component with comments blanked, so a comment that mentions the fix cannot pass it.
 *
 *  M2  "Selling now" titles wrap to two lines instead of being cut ("Kids b…").
 *  M5  Listing defaults' Save row sticks in view while there are unsaved changes.
 *  M9  The seller's own item page links to their public page and says "Buyers pay $X with the fee", not "incl. fee".
 *  L2  The seller's live listing has one share control (the card's Share row), and Manage listing is the filled button.
 *  L3  Selling shows "No offers yet" only while something priced is up.
 *  L4  Mark sold says open offers are "told it's gone", not "told nothing was charged".
 *  L7  Listing defaults: Keep it up's words are a label (the row toggles); the bundle row has no grey fill of its own.
 *  L8  The Sell chooser's More ways are 48px body-size rows, not 13px underlined links.
 *
 * @mutate src/components/declutter/SellingNowRow.tsx | className="text-ds-13 line-clamp-2 [overflow-wrap:anywhere]" data-selling-now-title="" | className="text-ds-13 truncate" data-selling-now-title=""
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | ${unsaved ? "sticky bottom-safe-nav | ${false ? "sticky bottom-safe-nav
 * @mutate src/components/declutter/DeclutterItemView.tsx | {t("dsl.item.publicPage")} |
 * @mutate src/components/declutter/DeclutterItemView.tsx | {it.current_price_cents > 0 && !isSeller && (\n                  <PriceInclFee | {it.current_price_cents > 0 && (\n                  <PriceInclFee
 * @mutate src/components/declutter/DeclutterItemView.tsx | {!(isSeller && it.status === "live") && ( | {true && (
 * @mutate src/components/declutter/DeclutterManageListing.tsx | <Button type="button" size="sm" className="rounded-full" data-manage-listing="" | <Button type="button" variant="outline" size="sm" className="rounded-full" data-manage-listing=""
 * @mutate src/components/declutter/DeclutterMineViews.tsx | quietWhenEmpty={!pricedLive} |
 * @mutate src/components/declutter/DeclutterOffersSection.tsx |   if ((only \|\| quietWhenEmpty) && mine.length === 0) return null; |   if (only && mine.length === 0) return null;
 * @mutate src/lib/i18n/enListingParts.ts | anyone with an open offer is told it's gone. | anyone with an open offer is told nothing was charged.
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | <label htmlFor={`${idPrefix}-keep-up-switch`} className="min-w-0 flex-1" data-keep-up-label=""> | <label className="min-w-0 flex-1" data-keep-up-label="">
 * @mutate src/components/declutter/BundleDiscountCard.tsx | <div className="space-y-2" role="group" | <div className="space-y-2 rounded-[14px] bg-[hsl(var(--muted)/0.55)] px-3 py-3" role="group"
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | const MORE_LINK = "flex min-h-12 w-full | const MORE_LINK = "inline-flex min-h-11 text-ds-13 underline
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";
import { enDeclutter } from "@/lib/i18n/enDeclutter";
import { esDeclutter } from "@/lib/i18n/esDeclutter";

const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));
const FILES = {
  sellingNow: "src/components/declutter/SellingNowRow.tsx",
  defaults: "src/components/declutter/DeclutterListingDefaults.tsx",
  item: "src/components/declutter/DeclutterItemView.tsx",
  manage: "src/components/declutter/DeclutterManageListing.tsx",
  mine: "src/components/declutter/DeclutterMineViews.tsx",
  offers: "src/components/declutter/DeclutterOffersSection.tsx",
  bundle: "src/components/declutter/BundleDiscountCard.tsx",
  chooser: "src/components/declutter/DeclutterSellChooser.tsx",
} as const;

describe("area 06b: Declutter selling gaps", () => {
  it("reads every file it checks (inventory floor)", () => {
    const sizes = Object.values(FILES).map((f) => code(f).length);
    expect(sizes.filter((n) => n > 500).length).toBeGreaterThan(Object.keys(FILES).length - 1);
  });

  it("M2: Selling now titles wrap to two lines, never truncate", () => {
    const tag = code(FILES.sellingNow).match(/<p className="[^"]*" data-selling-now-title=""/)?.[0] ?? "";
    expect(tag).toContain("line-clamp-2");
    expect(tag).not.toMatch(/\btruncate\b/);
  });

  it("M5: the listing defaults Save row sticks while there are unsaved changes", () => {
    expect(code(FILES.defaults)).toMatch(/\$\{unsaved \? "sticky bottom-safe-nav/);
  });

  it("M9: the seller's own item page links their public page and says who pays the fee", () => {
    const src = code(FILES.item);
    expect(src).toMatch(/\{isSeller && \(\s*<Link to=\{memberProfilePath\(it\.seller_id\)\}[^>]*>\s*\{t\("dsl\.item\.publicPage"\)\}/);
    expect(src).toContain('t("dsl.item.buyersPay", { amount: exactDollars(buyNowTotalCents(it.current_price_cents)) })');
    // The bare "incl. fee" is a buyer's line only.
    expect(src).toMatch(/\{it\.current_price_cents > 0 && !isSeller && \(\s*<PriceInclFee/);
    expect(enDeclutter["dsl.item.buyersPay"]).toBe("Buyers pay {amount} with the fee");
    expect(esDeclutter["dsl.item.buyersPay"]).toContain("{amount}");
    expect(enDeclutter["dsl.item.publicPage"]).toBe("See your public page");
  });

  it("L2: one share control on the seller's live listing; Manage listing is the filled button", () => {
    expect(code(FILES.item)).toMatch(/\{!\(isSeller && it\.status === "live"\) && \(\s*<Button[\s\S]{0,300}?onClick=\{\(\) => shareListing\(it\)\}/);
    const manage = code(FILES.manage).match(/<Button[^>]*data-manage-listing=""[^>]*>/)?.[0] ?? "";
    expect(manage).not.toBe("");
    expect(manage).not.toContain('variant="outline"');
  });

  it("L3: Selling's offers section is quiet when empty while nothing priced is up", () => {
    const mine = code(FILES.mine);
    expect(mine).toMatch(/const pricedLive = \(mine\.data \?\? \[\]\)\.some\(\(i\) => i\.status === "live" && i\.current_price_cents > 0\);/);
    expect(mine).toContain('<OffersSection side="seller" onlyMyTurn={only === "offers"} quietWhenEmpty={!pricedLive} />');
    expect(code(FILES.offers)).toContain("if ((only || quietWhenEmpty) && mine.length === 0) return null;");
  });

  it("L4: Mark sold says offers are told it's gone, in both languages", () => {
    expect(enListingParts["lp.m.soldWords"]).toMatch(/told it's gone\.$/);
    expect(enListingParts["lp.m.soldWords"]).not.toMatch(/nothing was charged/i);
    expect(esListingParts["lp.m.soldWords"]).not.toMatch(/no se cobró nada/);
  });

  it("L7: Keep it up's words toggle its switch; the bundle row has no grey fill", () => {
    const src = code(FILES.defaults);
    expect(src).toContain("<label htmlFor={`${idPrefix}-keep-up-switch`}");
    expect(src).toContain("<Switch id={`${idPrefix}-keep-up-switch`}");
    expect(code(FILES.bundle)).toMatch(/<div className="space-y-2" role="group"[^>]*data-bundle-card="">/);
  });

  it("L8: the More ways rows are 48px body-size rows, not 13px links", () => {
    const row = code(FILES.chooser).match(/const MORE_LINK = "([^"]*)"/)?.[1] ?? "";
    expect(row).toContain("min-h-12");
    expect(row).toContain("w-full");
    expect(row).toContain("text-ds-15");
    expect(row).not.toContain("underline");
  });
});
