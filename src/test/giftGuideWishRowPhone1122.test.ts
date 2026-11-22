/**
 * MY WISH LIST ON A PHONE: THE NAME GETS ITS ROOM (lead 2026-11-22, after the guides' phone heart move). A wish row's
 * "On Amazon · ~$4" line took the guides' top-right price column, so at 375 the name was squeezed to about four letters
 * ("Mrs. Mey..."; live screenshot ~/.lh-shots/guide-phonecard-1122/before-mylist-375.png). Below 768px the name now
 * takes the whole text column, the store and price sit on one line under it, and on My Wish List the heart sits at the
 * row's bottom-right like a guide row's (owner 11-22: "On the phone the heart goes in the bottom right below the
 * price"), the line stopping short of it. The computer keeps its card.
 *
 * Measured in Chromium on 2026-11-22 (local dev build of this branch, two saved Her picks): at 375 and 320 the row stays
 * 105px, the name runs two full lines ("Mrs. Meyer's Clean Day / Multi-Surface Cleaner,..."), the heart's box is at the
 * row's right edge and bottom (375: x 291, y 61); at 1440 the heart stays 6px in from the card's top-right.
 *
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | .gg-wish-list .gg-nm .gg-nm-meta{grid-column:1;grid-row:2; | .gg-wish-list .gg-nm .gg-nm-meta{grid-column:2;grid-row:1;
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | .gg-wish-list .gg-nm{grid-template-columns:minmax(0,1fr)} | .gg-wish-list .gg-nm{grid-template-columns:minmax(0,1fr) auto}
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | .gg-wish-mine .gg-heart-wish{top:auto;bottom:0;right:0;justify-content:flex-end} | .gg-wish-mine .gg-heart-wish{top:6px;right:6px}
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | .gg-wish-mine .gg-nm .gg-nm-meta{padding-right:48px} | .gg-wish-mine .gg-nm .gg-nm-meta{padding-right:0}
 */
import { describe, expect, it } from "vitest";
import { GIFT_WISH_CSS } from "@/pages/info/giftGuides/giftWishStyles";

const PHONE = GIFT_WISH_CSS.indexOf("@media (max-width:767px){\n.gg-wish-list .gg-nm{");
const PHONE_END = GIFT_WISH_CSS.indexOf("\n}\n", PHONE);
const rule = (selector: string, from = 0) => {
  const at = GIFT_WISH_CSS.indexOf(`${selector}{`, from);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = GIFT_WISH_CSS.slice(at + selector.length + 1, GIFT_WISH_CSS.indexOf("}", at));
  return { at, decl: Object.fromEntries(body.split(";").filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; })) };
};
const inPhone = (at: number) => at > PHONE && at < PHONE_END;
const TAP = 44;

describe("My Wish List rows on a phone: the name takes the text column, store and price under it, heart bottom-right", () => {
  it("the name's column is the whole text column and the store/price line is under it, left-aligned (phone only)", () => {
    expect(PHONE, "the fix lives in the phone breakpoint").toBeGreaterThan(0);
    const cols = rule(".gg-wish-list .gg-nm", PHONE);
    expect(inPhone(cols.at)).toBe(true);
    expect(cols.decl["grid-template-columns"]).toBe("minmax(0,1fr)");
    const meta = rule(".gg-wish-list .gg-nm .gg-nm-meta", PHONE);
    expect(inPhone(meta.at)).toBe(true);
    expect(meta.decl).toMatchObject({ "grid-column": "1", "grid-row": "2", "justify-content": "flex-start", "flex-wrap": "wrap" });
    // Nothing outside the phone block moves the line: the computer's card is unchanged.
    expect(GIFT_WISH_CSS.match(/\.gg-wish-list \.gg-nm( \.gg-nm-meta)?\{/g)).toHaveLength(2);
  });

  it("on My Wish List the heart sits at the row's bottom-right (icon at the box's right edge) and the line stops short of it", () => {
    const heart = rule(".gg-wish-mine .gg-heart-wish", PHONE);
    expect(inPhone(heart.at)).toBe(true);
    expect(heart.decl).toEqual({ top: "auto", bottom: "0", right: "0", "justify-content": "flex-end" });
    const room = rule(".gg-wish-mine .gg-nm .gg-nm-meta", PHONE);
    expect(inPhone(room.at)).toBe(true);
    expect(Number.parseInt(room.decl["padding-right"], 10)).toBeGreaterThanOrEqual(TAP);
    // The old 52px right gutter for a top-right heart is gone from the phone (the name would lose that room again).
    expect(GIFT_WISH_CSS).not.toContain(".gg-wish-mine>.gg-item{padding-right:52px}");
    // The computer keeps the heart 6px in from the card's top-right.
    expect(rule(".gg-wish-mine .gg-heart-wish").decl).toMatchObject({ position: "absolute", top: "6px", right: "6px" });
  });
});
