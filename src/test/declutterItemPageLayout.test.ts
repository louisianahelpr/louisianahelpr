/**
 * The Declutter item page's order (owner mockups 11-01, Mockup 1 computer / Mockup 2 phone; replaces
 * LEAD-ITEM-PAGE-LAYOUT of 2026-10-31): the price and place lines, then the Make an offer / Buy now card with the
 * delivery line inside it, then the seller card (with "N more items" folded in) RIGHT under the buttons, then
 * "About this item", then ONE pickup block, then Questions, then Report at the bottom. The pickup block never repeats
 * "Pickup in <town>" (ItemPickupBlock says the cities once).
 *
 * @mutate src/components/declutter/DeclutterItemView.tsx |           {!isSeller && user && <DeclutterSellerCard sellerId={it.seller_id} extra={bundle && canAct ? <BundleLine summary={bundle} /> : null} />} |           {!isSeller && user && <DeclutterQuestions itemId={itemId} sellerId={it.seller_id} isSeller={isSeller} canAsk={false} preview={preview} free={free} />}
 * @mutate src/components/declutter/ItemPickupBlock.tsx | {how.join(" or ")} · {orList(cities)} | {how.join(" or ")} · Pickup in {orList(cities)}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync("src/components/declutter/DeclutterItemView.tsx", "utf8"));
const at = (needle: string) => {
  const i = src.indexOf(needle);
  expect(i, `${needle} not found in DeclutterItemView.tsx`).toBeGreaterThan(-1);
  return i;
};

describe("the Declutter item page's order (owner 2026-10-31)", () => {
  it("reads the page source", () => {
    expect(src.length).toBeGreaterThan(5000);
  });

  it("price lines, then Make an offer / Buy now (delivery line inside), then the seller, About, Pickup, Questions, Report", () => {
    const delivered = at("data-item-delivered");
    const actions = at(") : actions}");
    const seller = at("<DeclutterSellerCard");
    const guestSeller = at("<DeclutterGuestSeller");
    const details = at('id="declutter-details"');
    const pickup = at("<ItemPickupBlock");
    const questions = at("<DeclutterQuestions");
    const report = at("<DeclutterReportListing");
    expect(delivered).toBeLessThan(actions);
    expect(src).toContain("footer={deliveredLine}");
    expect(actions).toBeLessThan(Math.min(seller, guestSeller));
    expect(Math.max(seller, guestSeller)).toBeLessThan(details);
    expect(details).toBeLessThan(pickup);
    expect(pickup).toBeLessThan(questions);
    expect(questions).toBeLessThan(report);
    expect(src.lastIndexOf("<DeclutterQuestions")).toBe(questions);
  });

  it("the pickup block names the cities once, never \"Pickup in <town>\"", () => {
    const block = blankComments(readFileSync("src/components/declutter/ItemPickupBlock.tsx", "utf8"));
    expect(block).toContain("{how.join(\" or \")} · {orList(cities)}");
    expect(block).not.toMatch(/Pickup in /);
    expect(src).not.toMatch(/Pickup in /);
  });
});
