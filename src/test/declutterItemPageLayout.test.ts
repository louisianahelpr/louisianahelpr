/**
 * LEAD-ITEM-PAGE-LAYOUT (owner 2026-10-31, screenshots ~/.lh-shots/owner-shots/item-page-1031-a/-b.png): on the
 * Declutter item page the Buy now / Make an offer box sits right under the price, title, place and delivery lines;
 * the seller card (and the "more from this seller" note) comes BELOW Questions; the "Pickup in <town>" line shows
 * only when no pickup places are listed under it. (The two lines under the buttons and the place labels:
 * declutterTradeViews.test.tsx and placeHours.test.tsx.) The sticky bottom bar is unchanged.
 *
 * @mutate src/components/declutter/DeclutterItemView.tsx | {!placesListed && ( | {true && (
 * @mutate src/components/declutter/DeclutterItemView.tsx |           {!isSeller && user && <DeclutterSellerCard sellerId={it.seller_id} />} |           {!isSeller && user && <DeclutterQuestions itemId={itemId} sellerId={it.seller_id} isSeller={isSeller} canAsk={false} preview={preview} free={free} />}
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

  it("price lines, then Buy now / Make an offer, then Details, Pickup, Questions, then the seller", () => {
    const delivered = at("data-item-delivered");
    const actions = at(") : actions}");
    const details = at('id="declutter-details"');
    const pickup = at('id="declutter-pickup"');
    const questions = at("<DeclutterQuestions");
    const seller = at("<DeclutterSellerCard");
    const guestSeller = at("<DeclutterGuestSeller");
    const moving = at("<DeclutterMovingSaleNote");
    expect(delivered).toBeLessThan(actions);
    expect(actions).toBeLessThan(details);
    expect(details).toBeLessThan(pickup);
    expect(pickup).toBeLessThan(questions);
    expect(Math.min(seller, guestSeller, moving)).toBeGreaterThan(questions);
    expect(src.lastIndexOf("<DeclutterQuestions")).toBe(questions);
  });

  it('"Pickup in <town>" shows only when no pickup places are listed', () => {
    expect(src).toContain("{!placesListed && (");
    expect(at("{!placesListed && (")).toBeLessThan(at("<ItemHandoverTimes"));
  });
});
